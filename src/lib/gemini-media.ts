import "server-only";
import { ownerGemini } from "./integrations";
import { sleep } from "./utils";

/**
 * Pictures and video clips made on the app's own Gemini key (Admin → App settings → Integrations → Gemini):
 *  - Pictures: Nano Banana (Gemini image models). Up to 4 reference pictures keep a character looking the same.
 *  - Clips: Gemini Omni Flash (Veo 3.1 as the fallback while Google still serves it), image-to-video, so each clip
 *    starts from the scene's picture.
 * Google bills these on the key's Cloud project; the app charges credits for them (see CREDIT_COST).
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Cheapest first: Nano Banana 2.1 is $0.0504 per 2K picture; 3.1 Flash Image is the fallback if 2.1 isn't on the key. */
const IMAGE_MODELS = () => unique([process.env.GEMINI_IMAGE_MODEL, "gemini-nano-banana-2.1", "gemini-3.1-flash-image"]);
/** Veo 3.1 Fast ($0.10/s at 720p) is the default; the full model costs 4× as much for a small quality gain. */
const VEO_MODELS = () => unique([process.env.VEO_MODEL, "veo-3.1-fast-generate-preview", "veo-3.1-generate-preview"]);

/** Gemini Omni Flash replaced the Veo 3.1 previews (shut down 2026-10-22); about $0.10 a second at 720p, paid tier only. */
const OMNI_MODELS = () => unique([process.env.OMNI_MODEL, "gemini-omni-1.1-flash"]);

const unique = (xs: (string | undefined)[]) => [...new Set(xs.map((x) => x?.trim()).filter((x): x is string => !!x))];

export class MediaGenError extends Error {
  /** "config": the owner has to fix the key or billing; "blocked": Google's safety filter declined this prompt. */
  kind?: "config" | "blocked";
  constructor(message: string, kind?: "config" | "blocked") {
    super(message);
    this.kind = kind;
  }
}

export interface RefImage {
  mimeType: string;
  base64: string;
}

export type Aspect = "9:16" | "16:9" | "1:1";

export async function mediaKey(): Promise<string | null> {
  return (await ownerGemini())?.key ?? null;
}

async function requireKey() {
  const key = await mediaKey();
  if (!key) throw new MediaGenError("AI pictures and Veo clips need the app's Gemini key. The admin adds it in Admin → App settings → Integrations → Gemini.", "config");
  return key;
}

/** Plain-language reason for a Google error that the owner has to fix, or null when retrying may help. */
export function googleProblem(status: number, body: string): string | null {
  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid/i.test(body)) {
    return "Google rejected the Gemini key, or this key's project can't use this model. Check the key in Admin → Integrations → Gemini.";
  }
  if (/billing|FAILED_PRECONDITION|free tier|not available in your country|paid tier/i.test(body)) {
    return "This Google model needs billing turned on for the Gemini key's Google Cloud project (Google AI Studio → Billing).";
  }
  if (status === 429 && /quota|RESOURCE_EXHAUSTED/i.test(body) && /per day|daily|limit: 0/i.test(body)) {
    return "The Gemini key has used its daily allowance for this model. Raise the quota in Google AI Studio, or try again tomorrow.";
  }
  return null;
}

/**
 * Finds a generated picture in either Gemini response shape: the Interactions API (`output_image`, or a
 * `{type:"image", data}` block in `steps`) or generateContent (`candidates[].content.parts[].inlineData`).
 */
export function findImage(json: unknown): RefImage | null {
  const seen = new Set<unknown>();
  let found: RefImage | null = null;
  const visit = (o: unknown) => {
    if (!o || typeof o !== "object" || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) return o.forEach(visit);
    const r = o as Record<string, unknown>;
    const inline = (r.inlineData ?? r.inline_data) as Record<string, unknown> | undefined;
    if (inline && typeof inline.data === "string" && inline.data.length > 200) {
      const mime = String(inline.mimeType ?? inline.mime_type ?? "image/png");
      if (mime.startsWith("image/")) found = { mimeType: mime, base64: inline.data };
    }
    if (typeof r.data === "string" && r.data.length > 200) {
      const mime = String(r.mime_type ?? r.mimeType ?? "");
      if (r.type === "image" || mime.startsWith("image/")) found = { mimeType: mime.startsWith("image/") ? mime : "image/png", base64: r.data };
    }
    // Later blocks win: the last picture in the answer is the finished one.
    Object.values(r).forEach(visit);
  };
  visit(json);
  return found;
}

/** Any text the model sent back instead of a picture (usually why it declined). */
function findText(json: unknown): string {
  const out: string[] = [];
  const visit = (o: unknown) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(visit);
    const r = o as Record<string, unknown>;
    if (typeof r.text === "string") out.push(r.text);
    if (typeof r.finishReason === "string" && r.finishReason !== "STOP") out.push(`(${r.finishReason})`);
    if (typeof r.blockReason === "string") out.push(`(blocked: ${r.blockReason})`);
    Object.values(r).forEach(visit);
  };
  visit(json);
  return out.join(" ").replace(/\s+/g, " ").trim().slice(0, 240);
}

async function post(url: string, key: string, body: unknown) {
  return fetch(url, { method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/** One picture request, Interactions API first and generateContent as the fallback. Returns null when the model is unknown (404). */
async function imageRequest(key: string, model: string, prompt: string, refs: RefImage[], aspect: Aspect, size: "1K" | "2K"): Promise<RefImage | null> {
  const attempts: (() => Promise<Response>)[] = [
    () =>
      post(`${BASE}/interactions`, key, {
        model,
        input: [{ type: "text", text: prompt }, ...refs.map((r) => ({ type: "image", mime_type: r.mimeType, data: r.base64 }))],
        response_format: { type: "image", aspect_ratio: aspect, image_size: size },
      }),
    () =>
      post(`${BASE}/models/${model}:generateContent`, key, {
        contents: [{ role: "user", parts: [...refs.map((r) => ({ inline_data: { mime_type: r.mimeType, data: r.base64 } })), { text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: aspect, imageSize: size } },
      }),
  ];
  let lastErr = "";
  let lastStatus = 0;
  for (const [i, send] of attempts.entries()) {
    for (let tries = 0; tries < 3; tries++) {
      let res: Response;
      try {
        res = await send();
      } catch (e) {
        lastErr = `network error: ${(e as Error).message}`;
        await sleep(1500 * 2 ** tries);
        continue;
      }
      const text = await res.text();
      if (res.ok) {
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* handled below */
        }
        const img = findImage(json);
        if (img) return img;
        const why = findText(json);
        throw new MediaGenError(`The picture model didn't return a picture${why ? `: ${why}` : ""}. Reword the scene and try again.`, "blocked");
      }
      lastErr = `${res.status} ${text.replace(/\s+/g, " ").slice(0, 300)}`;
      lastStatus = res.status;
      const problem = googleProblem(res.status, text);
      if (problem) throw new MediaGenError(problem, "config");
      if (res.status === 404) {
        break; // this API or model isn't available on the key: try the other API, then the next model
      }
      if (res.status === 400 && i === 0) break; // the Interactions API didn't accept the request: try generateContent
      if (res.status === 400 && /safety|blocked|prohibited|policy/i.test(text)) {
        throw new MediaGenError("Google's safety filter declined this picture. Reword the scene (or use a different photo) and try again.", "blocked");
      }
      if (res.status === 429 || res.status >= 500) {
        await sleep(Math.min(20_000, 2000 * 2 ** tries));
        continue;
      }
      throw new MediaGenError(`Gemini couldn't make the picture (${lastErr.slice(0, 200)}).`);
    }
  }
  if (lastStatus === 404) return null; // the model isn't on this key: the caller tries the next one
  throw new MediaGenError(`Gemini couldn't make the picture (${lastErr.slice(0, 200)}).`);
}

/** Makes one picture. `refs` (up to 4) are character portraits or photos the picture must stay faithful to. */
export async function geminiImage(o: { prompt: string; refs?: RefImage[]; aspect: Aspect; size?: "1K" | "2K" }): Promise<{ bytes: Buffer; mimeType: string }> {
  const key = await requireKey();
  for (const model of IMAGE_MODELS()) {
    const img = await imageRequest(key, model, o.prompt, (o.refs ?? []).slice(0, 4), o.aspect, o.size ?? "2K");
    if (img) return { bytes: Buffer.from(img.base64, "base64"), mimeType: img.mimeType };
  }
  throw new MediaGenError(`None of the Gemini picture models (${IMAGE_MODELS().join(", ")}) are available on this key. Set GEMINI_IMAGE_MODEL to one listed on ai.google.dev → Models.`, "config");
}

interface VeoOperation {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[]; raiMediaFilteredReasons?: string[] } };
}

/** Finds the generated video in an Interactions response (`steps[].content[]` with `type: "video"`). */
export function findVideo(json: unknown): { data?: string; uri?: string } | null {
  const seen = new Set<unknown>();
  let found: { data?: string; uri?: string } | null = null;
  const visit = (o: unknown) => {
    if (found || !o || typeof o !== "object" || seen.has(o)) return;
    seen.add(o);
    const r = o as Record<string, unknown>;
    if (r.type === "video" && (typeof r.data === "string" || typeof r.uri === "string")) {
      found = { data: typeof r.data === "string" ? r.data : undefined, uri: typeof r.uri === "string" ? r.uri : undefined };
      return;
    }
    for (const v of Object.values(r)) visit(v);
  };
  visit(json);
  return found;
}

/**
 * Animates a picture into a clip of about `seconds` (3–10) with Gemini Omni Flash at 720p; the model makes its own
 * sound. One synchronous Interactions call; returns null when no Omni model is on this key (the caller falls back).
 */
async function omniClip(key: string, o: { prompt: string; start: RefImage; aspect: "9:16" | "16:9"; seconds: number; timeoutMs?: number }): Promise<Buffer | null> {
  for (const model of OMNI_MODELS()) {
    let res: Response;
    try {
      res = await fetch(`${BASE}/interactions`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          input: [
            { type: "image", mime_type: o.start.mimeType, data: o.start.base64 },
            { type: "text", text: `One continuous shot of about ${o.seconds} seconds that starts exactly on this picture. ${o.prompt}` },
          ],
          response_format: { type: "video", aspect_ratio: o.aspect, resolution: "720p" },
          generation_config: { video_config: { task: "image_to_video" } },
          background: false,
          store: false,
          stream: false,
        }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 10 * 60_000),
      });
    } catch (e) {
      throw new MediaGenError(`Gemini Omni didn't answer (${(e as Error).message}).`);
    }
    const text = await res.text();
    if (res.status === 404) continue;
    if (!res.ok) {
      const problem = googleProblem(res.status, text);
      if (problem) throw new MediaGenError(problem, "config");
      if (/safety|blocked|policy/i.test(text)) throw new MediaGenError("Google's safety filter declined this clip. Reword the shot.", "blocked");
      throw new MediaGenError(`Gemini Omni couldn't make the clip (${res.status} ${text.replace(/\s+/g, " ").slice(0, 200)}).`);
    }
    const json = JSON.parse(text) as { status?: string; error?: { message?: string } };
    if (json.error?.message) throw new MediaGenError(`Gemini Omni couldn't make the clip: ${json.error.message.slice(0, 200)}`);
    const video = findVideo(json);
    if (video?.data) return Buffer.from(video.data, "base64");
    if (video?.uri) {
      const id = video.uri.match(/files\/([^/?:]+)/)?.[1];
      const dl = await fetch(id ? `${BASE}/files/${id}:download?alt=media` : video.uri, { headers: { "x-goog-api-key": key }, redirect: "follow" });
      if (!dl.ok) throw new MediaGenError(`Downloading the Gemini Omni clip failed (${dl.status}).`);
      return Buffer.from(await dl.arrayBuffer());
    }
    throw new MediaGenError(`Google's safety filter declined this clip${json.status && json.status !== "completed" ? ` (${json.status})` : ""}. Reword the shot.`, "blocked");
  }
  return null;
}

/** One clip: Gemini Omni Flash, or Veo 3.1 when Omni isn't on the key. */
export async function geminiClip(o: { prompt: string; start: RefImage; aspect: "9:16" | "16:9"; seconds: 4 | 6 | 8; timeoutMs?: number }): Promise<Buffer> {
  const key = await requireKey();
  return (await omniClip(key, o)) ?? veoClip(o);
}

/**
 * Animates a picture into a 4, 6 or 8 second clip with Veo 3.1 (720p). Starts a long-running job, checks it every
 * 10 seconds, and downloads the MP4 (Google keeps it for 2 days). Takes about 1–3 minutes.
 */
export async function veoClip(o: { prompt: string; start: RefImage; aspect: "9:16" | "16:9"; seconds: 4 | 6 | 8; timeoutMs?: number }): Promise<Buffer> {
  const key = await requireKey();
  let op: VeoOperation | null = null;
  let lastErr = "";
  for (const model of VEO_MODELS()) {
    for (const asNumber of [false, true]) {
      const res = await post(`${BASE}/models/${model}:predictLongRunning`, key, {
        instances: [{ prompt: o.prompt, image: { inlineData: { mimeType: o.start.mimeType, data: o.start.base64 } } }],
        parameters: { aspectRatio: o.aspect, durationSeconds: asNumber ? o.seconds : String(o.seconds), resolution: "720p", personGeneration: "allow_adult" },
      });
      const text = await res.text();
      if (res.ok) {
        op = JSON.parse(text) as VeoOperation;
        break;
      }
      lastErr = `${res.status} ${text.replace(/\s+/g, " ").slice(0, 300)}`;
      const problem = googleProblem(res.status, text);
      if (problem) throw new MediaGenError(problem, "config");
      // Some API versions want the duration as a number, not a string.
      if (res.status === 400 && /durationSeconds/i.test(text) && !asNumber) continue;
      if (res.status === 404) break;
      throw new MediaGenError(`Veo couldn't start the clip (${lastErr.slice(0, 200)}).`);
    }
    if (op) break;
  }
  if (!op?.name) throw new MediaGenError(`No Veo model is available on this key (${lastErr.slice(0, 160)}). Set VEO_MODEL to one listed on ai.google.dev → Models.`, "config");

  const deadline = Date.now() + (o.timeoutMs ?? 8 * 60_000);
  while (!op.done) {
    if (Date.now() > deadline) throw new MediaGenError("Veo took too long to make this clip.");
    await sleep(10_000);
    const res: Response = await fetch(`${BASE}/${op.name}`, { headers: { "x-goog-api-key": key } });
    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) continue;
      throw new MediaGenError(`Veo status check failed (${res.status}).`);
    }
    op = { name: op.name, ...((await res.json()) as VeoOperation) };
  }
  if (op.error?.message) throw new MediaGenError(`Veo couldn't make the clip: ${op.error.message.slice(0, 200)}`);
  const out = op.response?.generateVideoResponse;
  const uri = out?.generatedSamples?.[0]?.video?.uri;
  if (!uri) {
    const why = out?.raiMediaFilteredReasons?.join(" ");
    throw new MediaGenError(`Google's safety filter declined this clip${why ? `: ${why.slice(0, 200)}` : ""}.`, "blocked");
  }
  const dl = await fetch(uri, { headers: { "x-goog-api-key": key }, redirect: "follow" });
  if (!dl.ok) throw new MediaGenError(`Downloading the Veo clip failed (${dl.status}).`);
  return Buffer.from(await dl.arrayBuffer());
}
