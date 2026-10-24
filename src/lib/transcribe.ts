import "server-only";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { runCmd } from "./render";
import type { TimedLine } from "./audio-scenes";

/**
 * Free speech-to-text that runs on Ghost Post's own server: OpenAI's Whisper (base, open weights, MIT) through
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

/** The words in an audio (or video) file, as timed lines. */
export async function transcribe(file: string): Promise<TimedLine[]> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ghost-post-asr-"));
  try {
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
