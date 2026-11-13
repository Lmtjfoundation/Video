import "server-only";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { runCmd } from "./render";
import type { TimedLine } from "./audio-scenes";

/**
 * Free speech-to-text that runs on Vueio's own server: OpenAI's Whisper (base, open weights, MIT) through
 * transformers.js, the same library the free voice uses. About 150 MB, downloaded once on first use and cached on the
 * data volume. Roughly 8× faster than real time on two CPU cores; any language Whisper knows.
 */
type Asr = (audio: Float32Array, o: Record<string, unknown>) => Promise<{ text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }>;
let model: Promise<Asr> | null = null;

async function load(): Promise<Asr> {
  const { env, pipeline } = await import("@huggingface/transformers");
  env.cacheDir = path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "models");
  return (await pipeline("automatic-speech-recognition", process.env.WHISPER_MODEL || "onnx-community/whisper-base", { dtype: "q8", device: "cpu" })) as unknown as Asr;
}

/** Azure OpenAI's Whisper takes files up to 25 MB; the audio is sent as small mono MP3, so that's about 100 minutes. */
const AZURE_MAX_BYTES = 24 * 1024 * 1024;

/** The Whisper deployment on the owner's Azure AI resource, or null when Azure isn't set up or it's switched off. */
export async function azureTranscriber(): Promise<{ url: string; headers: Record<string, string> } | null> {
  const { pick, azureOnly } = await import("./integrations");
  const set = await pick("azureAiTranscribeDeployment", "AZURE_AI_TRANSCRIBE_DEPLOYMENT");
  if (set === "off" || (!set && !(await azureOnly()))) return null;
  const { foundryAuth } = await import("./azure-identity");
  const auth = await foundryAuth();
  if (!auth) return null;
  return { url: `${auth.base}/openai/deployments/${encodeURIComponent(set || "whisper")}/audio/transcriptions?api-version=2024-06-01`, headers: auth.headers };
}

/** Timed lines from Azure's Whisper (verbose JSON segments). Null when the file is too big for one request. */
export async function transcribeOnAzure(file: string, az: { url: string; headers: Record<string, string> }, dir: string): Promise<TimedLine[] | null> {
  const mp3 = path.join(dir, "audio.mp3");
  await runCmd("ffmpeg", ["-hide_banner", "-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", mp3], 5 * 60_000);
  const bytes = await fs.readFile(mp3);
  if (bytes.length > AZURE_MAX_BYTES) return null;
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }), "audio.mp3");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  const res = await fetch(az.url, { method: "POST", headers: az.headers, body: form, signal: AbortSignal.timeout(10 * 60_000) });
  if (!res.ok) throw new Error(`Azure Whisper answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const j = (await res.json()) as { text?: string; segments?: { start: number; end: number; text: string }[] };
  if (j.segments?.length) return j.segments.map((s) => ({ start: s.start, end: s.end, text: s.text }));
  return j.text?.trim() ? [{ start: 0, end: null, text: j.text }] : [];
}

/**
 * The words in an audio (or video) file, as timed lines. Azure OpenAI's Whisper (large, far more accurate) when the
 * owner's Azure AI resource is set up for it; the free on-server Whisper otherwise, or if Azure can't answer.
 */
export async function transcribe(file: string): Promise<TimedLine[]> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ghost-post-asr-"));
  try {
    const az = await azureTranscriber().catch(() => null);
    if (az) {
      try {
        const lines = await transcribeOnAzure(file, az, dir);
        if (lines) return lines;
      } catch (e) {
        console.warn(`[transcribe] Azure Whisper: ${(e as Error).message.slice(0, 200)}; using the on-server Whisper.`);
      }
    }
    // Whisper takes 16 kHz mono floats.
    const raw = path.join(dir, "audio.f32");
    await runCmd("ffmpeg", ["-hide_banner", "-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", raw], 5 * 60_000);
    const buf = await fs.readFile(raw);
    const audio = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
    model ??= load().catch((e) => {
      model = null; // try again next time (e.g. the download was interrupted)
      throw e;
    });
    const asr = await model;
    const r = await asr(audio, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 });
    return (r.chunks ?? []).map((c) => ({ start: c.timestamp[0] ?? 0, end: c.timestamp[1], text: c.text }));
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
