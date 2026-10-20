import "server-only";
import { replicateKey } from "./integrations";
import { MediaGenError, type RefImage } from "./gemini-media";
import { sleep } from "./utils";

/**
 * Video engines on Replicate for animating Movie Studio scenes, next to Veo:
 * - Seedance 2.5 (ByteDance): the richest motion; $0.2312 a second at 720p from an image (Oct 2026).
 * - Wan 2.2 (Alibaba, open weights, Apache 2.0): Ghost Post's low-cost engine; about 5-second clips for at most
 *   $0.145 each at 720p (Oct 2026).
 * The scene's AI picture is uploaded with Replicate's files API and used as the first frame. Model audio is off:
 * the render adds the voiceover, music and captions. Replicate bills the token's account.
 */
const API = "https://api.replicate.com/v1";
const MODEL = "bytedance/seedance-2.5";
const WAN_MODEL = "wan-video/wan-2.2-i2v-fast";

export const replicateReady = async () => !!(await replicateKey());

function replicateProblem(status: number, body: string): string | null {
  if (status === 401 || status === 403) return "Replicate rejected the API token. Check it in Admin → App settings → Integrations → Replicate.";
  if (status === 402 || /billing|insufficient|payment/i.test(body)) return "Replicate needs billing set up on the token's account (replicate.com → Account → Billing).";
  return null;
}

async function call(path: string, key: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) {
    const problem = replicateProblem(res.status, text);
    throw new MediaGenError(problem ?? `Replicate failed (${res.status}): ${text.slice(0, 200)}`, problem ? "config" : undefined);
  }
  return JSON.parse(text || "{}") as Record<string, unknown>;
}

/** Uploads a file (picture, clip or audio) to Replicate so the model can fetch it; returns its link. */
export async function uploadToReplicate(key: string, bytes: Buffer, mime: string, name: string): Promise<string> {
  const form = new FormData();
  form.append("content", new Blob([new Uint8Array(bytes)], { type: mime }), name);
  const f = await call("/files", key, { method: "POST", body: form });
  const url = (f.urls as { get?: string } | undefined)?.get;
  if (!url) throw new MediaGenError("Replicate didn't return a link for an uploaded file.");
  return url;
}

/** Uploads the starting picture so the model can fetch it. */
const uploadStart = (key: string, img: RefImage) => uploadToReplicate(key, Buffer.from(img.base64, "base64"), img.mimeType, `start.${img.mimeType.split("/")[1] || "png"}`);

type Prediction = { id?: string; status?: string; output?: unknown; error?: unknown; urls?: { get?: string } };

export type ClipRequest = { prompt: string; start: RefImage; aspect: "9:16" | "16:9"; seconds: number; timeoutMs?: number };

/** One Seedance 2.5 scene, starting from the scene's picture, as long as the scene needs. Returns the MP4. */
export const seedanceClip = (o: ClipRequest) =>
  run("Seedance", MODEL, o.timeoutMs, async (key) => ({ image: await uploadStart(key, o.start) }), (image) => ({ prompt: o.prompt.slice(0, 4000), image, duration: Math.max(1, Math.min(30, Math.round(o.seconds))), resolution: "720p", aspect_ratio: o.aspect, generate_audio: false, watermark: false }));

/** One Wan 2.2 scene: about 5 seconds (81 frames at 16 fps), the shape Wan is trained for; the render holds the last frame if the voice runs longer. */
export const wanClip = (o: ClipRequest) => run("Wan", WAN_MODEL, o.timeoutMs, async (key) => ({ image: await uploadStart(key, o.start) }), (image) => ({ prompt: o.prompt.slice(0, 2000), image, resolution: "720p", num_frames: 81, frames_per_second: 16, go_fast: true }));

/** A file handed to Seedance as a reference. */
export type RefFile = { bytes: Buffer; mime: string; name: string };

export type SeedanceRequest = {
  prompt: string;
  /** Up to 30, cited in the prompt as [Image1]…; for identity, wardrobe, locations and style. */
  images?: RefFile[];
  /** Up to 10 (30 seconds in all), cited as [Video1]…; to continue, edit or copy motion. */
  videos?: RefFile[];
  /** Up to 10 (30 seconds in all), cited as [Audio1]…; voice lines to lip-sync, music to cut to. Needs a picture or clip too. */
  audios?: RefFile[];
  /** 1–30 seconds, or -1 to let the model choose (required when editing a clip). */
  seconds: number;
  /** 9:16, 16:9, 21:9, 1:1… or "adaptive" (required to extend or edit a clip). */
  aspect: string;
  /** Seedance's own sound: dialogue in double quotes, effects and music. */
  audio: boolean;
  timeoutMs?: number;
};

/**
 * Seedance 2.5 with its full reference set, the way the film engine uses it: a multi-shot production brief, the cast
 * and locations as reference pictures, the previous segment as a reference clip to continue from (or the clip to
 * edit), and voice lines to lip-sync. Returns the MP4.
 */
export const seedanceFilm = (r: SeedanceRequest) =>
  run("Seedance", MODEL, r.timeoutMs ?? 12 * 60_000, async (key) => {
    const up = (list: RefFile[] | undefined, max: number) => Promise.all((list ?? []).slice(0, max).map((f) => uploadToReplicate(key, f.bytes, f.mime, f.name)));
    const [reference_images, reference_videos, reference_audios] = await Promise.all([up(r.images, 30), up(r.videos, 10), up(r.audios, 10)]);
    return { reference_images, reference_videos, reference_audios: reference_images.length || reference_videos.length ? reference_audios : [] };
  }, (_, refs) => ({
    prompt: r.prompt.slice(0, 4000),
    ...refs,
    duration: r.seconds === -1 ? -1 : Math.max(1, Math.min(30, Math.round(r.seconds))),
    resolution: "720p",
    aspect_ratio: r.aspect,
    generate_audio: r.audio,
    watermark: false,
  }));

async function run<R extends Record<string, unknown>>(
  name: string,
  model: string,
  timeoutMs: number | undefined,
  prepare: (key: string) => Promise<R>,
  input: (image: string, refs: R) => Record<string, unknown>,
): Promise<Buffer> {
  const key = await replicateKey();
  if (!key) throw new MediaGenError(`${name} clips need a Replicate API token. The admin adds it in Admin → App settings → Integrations → Replicate.`, "config");
  const refs = await prepare(key);
  let p = (await call(`/models/${model}/predictions`, key, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "wait=60" },
    body: JSON.stringify({ input: input(String(refs.image ?? ""), refs) }),
  })) as Prediction;
  const deadline = Date.now() + (timeoutMs ?? 8 * 60_000);
  while (p.status !== "succeeded") {
    if (p.status === "failed" || p.status === "canceled") {
      const why = String(p.error ?? "no reason given");
      throw new MediaGenError(/sensitive|safety|flagged|policy/i.test(why) ? `${name}'s safety filter declined this scene.` : `${name} couldn't make this scene: ${why.slice(0, 200)}`, /sensitive|safety|flagged|policy/i.test(why) ? "blocked" : undefined);
    }
    if (Date.now() > deadline) throw new MediaGenError(`${name} took too long on this scene.`);
    await sleep(5000);
    if (!p.id) throw new MediaGenError("Replicate didn't return a prediction id.");
    p = (await call(`/predictions/${p.id}`, key)) as Prediction;
  }
  const url = Array.isArray(p.output) ? String(p.output[0] ?? "") : String(p.output ?? "");
  if (!/^https:\/\//.test(url)) throw new MediaGenError(`${name} finished without a video link.`);
  const res = await fetch(url);
  if (!res.ok) throw new MediaGenError(`Couldn't download the ${name} clip (HTTP ${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/** Admin → Integrations → Test: checks the token without making a video. */
export async function testReplicate(): Promise<{ ok: boolean; message: string }> {
  const key = await replicateKey();
  if (!key) return { ok: false, message: "No Replicate API token saved yet." };
  try {
    const a = await call("/account", key);
    await call(`/models/${MODEL}`, key);
    await call(`/models/${WAN_MODEL}`, key);
    return { ok: true, message: `Replicate works (account ${String(a.username ?? "")}); Seedance 2.5 and Wan 2.2 are available.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
