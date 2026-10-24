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
export const ownEngineReady = async () => !!(await videoEngine());

async function call<T>(path: string, init: RequestInit = {}, raw = false): Promise<T> {
  const e = await videoEngine();
  if (!e) throw new MediaGenError("Ghost Post's video engine isn't connected. The admin adds its address and token in Admin → App settings → Integrations → Ghost Post Video Engine.", "config");
  let res: Response;
  try {
    res = await fetch(`${e.url}${path}`, { ...init, headers: { Authorization: `Bearer ${e.token}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120_000) });
  } catch (err) {
    throw new MediaGenError(`Ghost Post's video engine didn't answer at ${e.url} (${(err as Error).message}). Check the GPU server is running.`);
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
    const i = await call<{ ready: boolean; error?: string | null; model: string; device: string; vram_gb: number; queue: number }>("/v1/info");
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
