import "server-only";
import { videoEngineToken, videoEngineUrl } from "./integrations";
import { MediaGenError } from "./gemini-media";
import { sleep } from "./utils";

/**
 * Ghost Post Video Engine: the app's own video model (Wan 2.2 I2V-A14B by default, or TI2V-5B; open weights) running
 * on the owner's GPU server from engine/ in this repo. No per-clip fee: the owner pays only for the GPU while it runs.
 * One clip is about 5 seconds of 720p, from a first frame (or the prompt alone).
 */
export const ENGINE_CLIP_SECONDS = 5;

export async function videoEngine() {
  const [url, token] = await Promise.all([videoEngineUrl(), videoEngineToken()]);
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

/** What an engine can do (its /v1/info "capabilities"). An engine from before capabilities existed can do everything. */
export type EngineCapability = "pictures" | "edit-pictures" | "clips" | "video-edits" | "writing" | "upscale" | "remove-bg" | "music" | "sfx" | "speech" | "voice-change" | "isolate" | "lipsync" | "voice-design";
export const FULL_ENGINE: EngineCapability[] = ["pictures", "edit-pictures", "clips", "video-edits", "writing", "upscale", "remove-bg", "music", "sfx", "speech", "voice-change", "isolate", "lipsync", "voice-design"];
const CAPS_ROW = "engine-capabilities";
let capsCache: { url: string; caps: EngineCapability[]; at: number } | null = null;

/**
 * The connected engine's capabilities: asked of the engine at most every 5 minutes, and remembered (so a machine
 * that's switched off for the night still counts as able to do its tools; the job then wakes it). Null when the
 * engine has never answered.
 */
export async function engineCapabilities(): Promise<EngineCapability[] | null> {
  const e = await videoEngine();
  if (!e) return null;
  if (capsCache?.url === e.url && Date.now() - capsCache.at < 5 * 60_000) return capsCache.caps;
  const { gdb } = await import("./db");
  try {
    const res = await fetch(`${e.url}/v1/info`, { headers: { Authorization: `Bearer ${e.token}` }, signal: AbortSignal.timeout(8_000), cache: "no-store" });
    if (res.ok) {
      const info = (await res.json()) as { capabilities?: EngineCapability[] };
      const caps = Array.isArray(info.capabilities) ? info.capabilities : FULL_ENGINE;
      capsCache = { url: e.url, caps, at: Date.now() };
      await gdb().upsert("kv", { id: CAPS_ROW, value: { url: e.url, caps } }).catch(() => {});
      return caps;
    }
  } catch {
    /* switched off or unreachable: use what it said last time */
  }
  const saved = (await gdb().get<{ id: string; value: { url: string; caps: EngineCapability[] } }>("kv", CAPS_ROW).catch(() => null))?.value;
  return saved?.url === e.url ? saved.caps : null;
}
/** Tests only. */
export function resetEngineCapabilities() {
  capsCache = null;
}

/**
 * Whether the engine is connected and can do `cap`. Without `cap`: whether a full (GPU) engine is connected, which
 * is what every tool but upscale, background removal and voice isolation needs. An engine that has never answered
 * is given the benefit of the doubt (the job reports what goes wrong).
 */
export async function ownEngineReady(cap: EngineCapability = "pictures"): Promise<boolean> {
  if (!(await videoEngine())) return false;
  const caps = await engineCapabilities();
  return caps === null || caps.includes(cap);
}

async function call<T>(path: string, init: RequestInit = {}, raw = false): Promise<T> {
  const e = await videoEngine();
  if (!e) throw new MediaGenError("Ghost Post's video engine isn't connected. The admin adds its address and token in Admin → App settings → Integrations → Ghost Post Video Engine.", "config");
  let res: Response;
  const send = () => fetch(`${e.url}${path}`, { ...init, headers: { Authorization: `Bearer ${e.token}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120_000) });
  try {
    res = await send();
  } catch (err) {
    // The machine may be switched off for the night: start it (when wake on use is set up) and try once more.
    const { wakeConfigured, wakeEngine } = await import("./vm-wake");
    if (!(await wakeConfigured())) throw new MediaGenError(`Ghost Post's video engine didn't answer at ${e.url} (${(err as Error).message}). Check the GPU server is running.`);
    try {
      await wakeEngine(e.url);
      res = await send();
    } catch (again) {
      throw new MediaGenError(`Ghost Post's engine couldn't be woken: ${(again as Error).message}`);
    }
  }
  if (res.status === 401) throw new MediaGenError("The video engine rejected the token. Paste the ENGINE_TOKEN the engine was started with.", "config");
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      detail = String((JSON.parse(text) as { detail?: unknown }).detail ?? text);
    } catch {
      /* plain text */
    }
    throw new MediaGenError(`The video engine said: ${detail.slice(0, 300)}`);
  }
  return (raw ? Buffer.from(await res.arrayBuffer()) : await res.json()) as T;
}

export type OwnClipRequest = {
  prompt: string;
  /** First frame (a cast portrait, a location or the last frame of the clip before). Without it: text to video. */
  start?: { bytes: Buffer; mime: string };
  aspect: string;
  seconds: number;
  timeoutMs?: number;
};

/** Makes one clip on the engine and returns the MP4. */
export async function ownClip(o: OwnClipRequest): Promise<Buffer> {
  const job = await call<{ id: string }>("/v1/videos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: o.prompt.slice(0, 4000),
      image: o.start ? `data:${o.start.mime};base64,${o.start.bytes.toString("base64")}` : undefined,
      aspect: o.aspect,
      seconds: Math.max(1, Math.min(ENGINE_CLIP_SECONDS, o.seconds)),
    }),
  });
  const deadline = Date.now() + (o.timeoutMs ?? 25 * 60_000);
  for (;;) {
    const s = await call<{ status: string; error?: string | null }>(`/v1/videos/${job.id}`);
    if (s.status === "succeeded") return call<Buffer>(`/v1/videos/${job.id}/file`, {}, true);
    if (s.status === "failed") throw new MediaGenError(`The video engine couldn't make this clip: ${(s.error ?? "no reason given").slice(0, 300)}`);
    if (Date.now() > deadline) throw new MediaGenError("The video engine took too long on this clip. A bigger GPU makes clips faster.");
    await sleep(5000);
  }
}

/**
 * Makes one picture on the engine (Qwen-Image), or, with reference pictures, an edit that keeps their people and
 * places (Qwen-Image-Edit): up to three cast portraits or photos. Returns the PNG.
 */
export async function ownImage(o: { prompt: string; refs?: { bytes: Buffer; mime: string }[]; aspect: string; timeoutMs?: number }): Promise<Buffer> {
  const job = await call<{ id: string }>("/v1/images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: o.prompt.slice(0, 4000),
      images: (o.refs ?? []).slice(0, 3).map((r) => `data:${r.mime};base64,${r.bytes.toString("base64")}`),
      aspect: o.aspect,
    }),
  });
  const deadline = Date.now() + (o.timeoutMs ?? 10 * 60_000);
  for (;;) {
    const s = await call<{ status: string; error?: string | null }>(`/v1/images/${job.id}`);
    if (s.status === "succeeded") return call<Buffer>(`/v1/images/${job.id}/file`, {}, true);
    if (s.status === "failed") throw new MediaGenError(`The engine couldn't make this picture: ${(s.error ?? "no reason given").slice(0, 300)}`);
    if (Date.now() > deadline) throw new MediaGenError("The engine took too long on this picture. The first picture after a restart also loads the picture model (a few minutes).");
    await sleep(3000);
  }
}

export type OwnAudioRequest = {
  kind: "music" | "sfx";
  prompt: string;
  /** Music only: sung lyrics (with instrumental false). */
  lyrics?: string;
  instrumental?: boolean;
  seconds: number;
  bpm?: number;
  key?: string;
  timeoutMs?: number;
};

/**
 * Makes music (ACE-Step 1.5) or a sound effect (MOSS-SoundEffect v2) on the engine's audio side. Returns the 48 kHz WAV
 * and, for music, the tempo and key it was made in.
 */
export async function ownAudio(o: OwnAudioRequest): Promise<{ wav: Buffer; bpm?: number; key?: string }> {
  const job = await call<{ id: string }>("/v1/audio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: o.kind,
      prompt: o.prompt.slice(0, 500),
      lyrics: (o.lyrics ?? "").slice(0, 4000),
      instrumental: o.instrumental ?? true,
      seconds: o.seconds,
      bpm: o.bpm || undefined,
      key: o.key || undefined,
    }),
  });
  const deadline = Date.now() + (o.timeoutMs ?? 15 * 60_000);
  for (;;) {
    const s = await call<{ status: string; error?: string | null; bpm?: number | null; key?: string | null }>(`/v1/audio/${job.id}`);
    if (s.status === "succeeded") {
      const wav = await call<Buffer>(`/v1/audio/${job.id}/file`, {}, true);
      return { wav, bpm: s.bpm ?? undefined, key: s.key ?? undefined };
    }
    if (s.status === "failed") throw new MediaGenError(`The engine couldn't make this ${o.kind === "music" ? "track" : "sound"}: ${(s.error ?? "no reason given").slice(0, 300)}`);
    if (Date.now() > deadline) throw new MediaGenError("The engine took too long. The first track after a restart also loads the music model (a few minutes).");
    await sleep(3000);
  }
}

/** Waits for a side-service job (speech, lip sync) and returns its file. */
async function sideJob(path: string, body: unknown, what: string, timeoutMs: number): Promise<{ file: Buffer; meta: Record<string, unknown> }> {
  const job = await call<{ id: string }>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = await call<{ status: string; error?: string | null } & Record<string, unknown>>(`${path}/${job.id}`);
    if (s.status === "succeeded") return { file: await call<Buffer>(`${path}/${job.id}/file`, {}, true), meta: s };
    if (s.status === "failed") throw new MediaGenError(`The engine couldn't ${what}: ${(s.error ?? "no reason given").slice(0, 300)}`);
    if (Date.now() > deadline) throw new MediaGenError(`The engine took too long to ${what}.`);
    await sleep(3000);
  }
}
const b64 = (b: Buffer) => b.toString("base64");

/**
 * Speech on the engine (Chatterbox Multilingual): `text` in one of 23 languages, in the voice of `voice` (a 5–20 s
 * recording) when given. Returns a WAV. Up to about 1,200 characters per call; callers split longer text.
 */
export async function ownSpeech(o: { text: string; language: string; voice?: Buffer; exaggeration?: number; cfg?: number }): Promise<Buffer> {
  const r = await sideJob("/v1/speech", { mode: "tts", text: o.text.slice(0, 1200), language: o.language, voice: o.voice ? b64(o.voice) : undefined, exaggeration: o.exaggeration ?? 0.5, cfg: o.cfg ?? 0.5 }, "speak this", 10 * 60_000);
  return r.file;
}

/** Voice-to-voice (Chatterbox VC): the same performance in another voice. Returns a WAV. */
export async function ownVoiceConvert(o: { source: Buffer; voice: Buffer }): Promise<Buffer> {
  return (await sideJob("/v1/speech", { mode: "convert", source: b64(o.source), voice: b64(o.voice) }, "change this voice", 15 * 60_000)).file;
}

/** A picture tool on the engine: upscale (Real-ESRGAN, up to 4096 px) or cut out the subject (BiRefNet, transparent PNG). */
export async function ownImageTool(o: { op: "upscale" | "remove-bg"; image: Buffer; mime: string; scale?: 2 | 4 }): Promise<Buffer> {
  const what = o.op === "upscale" ? "upscale this picture" : "cut out this picture";
  return (await sideJob("/v1/images", { op: o.op, images: [`data:${o.mime};base64,${b64(o.image)}`], scale: o.scale ?? 4, aspect: "1:1" }, what, 15 * 60_000)).file;
}

export type VideoEditTask = "restyle" | "relight" | "motion" | "background" | "inpaint";
/** A video edit on the engine (Wan 2.1 VACE): up to about 5 seconds of `video` changed as `task` says. MP4. */
export async function ownVideoEdit(o: { task: VideoEditTask; video: Buffer; prompt: string; image?: { bytes: Buffer; mime: string }; box?: [number, number, number, number]; aspect: string; seconds?: number }): Promise<Buffer> {
  const body = { task: o.task, video: b64(o.video), prompt: o.prompt.slice(0, 4000), image: o.image ? `data:${o.image.mime};base64,${b64(o.image.bytes)}` : undefined, box: o.box, aspect: o.aspect, seconds: Math.min(5, o.seconds ?? 5) };
  return (await sideJob("/v1/video-edits", body, "edit this clip", 45 * 60_000)).file;
}

/** Voice isolator (Demucs htdemucs): the voice alone, or everything but the voice (music, noise, effects). WAV. */
export async function ownIsolate(o: { source: Buffer; stem: "vocals" | "background" }): Promise<Buffer> {
  return (await sideJob("/v1/speech", { mode: "isolate", source: b64(o.source), stem: o.stem }, "separate this recording", 30 * 60_000)).file;
}

/** Voice design (Parler-TTS Mini v1): `text` read in a new voice described in words. WAV. */
export async function ownDesignVoice(o: { text: string; description: string; seed?: number }): Promise<Buffer> {
  return (await sideJob("/v1/voice-design", { text: o.text.slice(0, 600), description: o.description.slice(0, 600), seed: o.seed }, "design this voice", 10 * 60_000)).file;
}

/** Lip sync (MuseTalk 1.5): the face in `video` mouths `audio`; a shorter video loops. Returns an MP4 with the audio. */
export async function ownLipsync(o: { video: Buffer; audio: Buffer }): Promise<Buffer> {
  return (await sideJob("/v1/lipsync", { video: b64(o.video), audio: b64(o.audio) }, "lip-sync this video", 60 * 60_000)).file;
}

/** Until when the engine's writing is skipped after it said writing is off or failed to load (0 = try it). */
let writingOffUntil = 0;
export const engineWritingSkipped = () => Date.now() < writingOffUntil;
/** Tests only. */
export function resetEngineWriting() {
  writingOffUntil = 0;
}

/** Writes with the engine's own text model (Qwen3-8B). Throws MediaGenError when the engine can't write right now. */
export async function ownWrite(o: { system: string; user: string; maxTokens: number; temperature: number }): Promise<string> {
  try {
    const r = await call<{ text: string }>("/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system: o.system.slice(0, 20_000), user: o.user.slice(0, 60_000), max_tokens: Math.min(16_000, o.maxTokens), temperature: o.temperature }),
    });
    if (!r.text?.trim()) throw new MediaGenError("The engine's writing model returned nothing.");
    return r.text;
  } catch (e) {
    // Writing switched off, or the model can't load: stop asking for a while so every request isn't slowed down.
    if (e instanceof MediaGenError && /switched off|couldn't load|OutOfMemory|CUDA/i.test(e.message)) writingOffUntil = Date.now() + 10 * 60_000;
    throw e;
  }
}

/** Admin → Integrations → Test. */
export async function testOwnEngine(): Promise<{ ok: boolean; message: string }> {
  try {
    const i = await call<{ ready: boolean; error?: string | null; model: string; device: string; vram_gb: number; queue: number; profile?: string }>("/v1/info");
    resetEngineCapabilities();
    if (i.profile === "tools") return { ok: true, message: "Connected to a machine without a GPU: upscaling, background removal and voice isolation work. Pictures, clips and voices need a GPU engine." };
    if (i.error) return { ok: false, message: `The engine is running but its model failed to load: ${i.error}` };
    return {
      ok: true,
      message: i.ready
        ? `Connected: ${i.model} on ${i.device} (${i.vram_gb} GB). ${i.queue ? `${i.queue} clip(s) queued.` : "Ready to film."}`
        : `Connected to ${i.device}; the model is still loading (the first start downloads about 30 GB). Try again in a few minutes.`,
    };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
