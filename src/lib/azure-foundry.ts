import "server-only";
import { MediaGenError, type Aspect, type RefImage } from "./gemini-media";
import { pick } from "./integrations";

/**
 * Pictures on Azure's GPUs through Azure AI Foundry: FLUX.1 Kontext pro, deployed in the owner's Azure AI resource.
 * Microsoft runs the GPUs and bills each picture to the owner's Azure subscription (and its credits), so no GPU VM or
 * GPU quota is needed. Kontext makes a picture from a description, or edits from a reference picture so a cast member
 * keeps their face. Several references are joined side by side into one, which Kontext reads as "the person on the
 * left … the person on the right".
 */
export const foundryEndpoint = () => pick("azureAiEndpoint", "AZURE_AI_ENDPOINT");
export const foundryKey = () => pick("azureAiKey", "AZURE_AI_KEY");
/** FLUX.2 pro (the newest model: several reference faces at once). Azure routes it by its deployment name "flux.2-pro". */
export const flux2Enabled = async () => (await pick("azureAiFlux2", "AZURE_AI_FLUX2")) !== "off";
const FLUX2_SIZE: Record<Aspect, [number, number]> = { "9:16": [768, 1344], "16:9": [1344, 768], "1:1": [1024, 1024] };

/** FLUX.2 pro on the owner's Azure AI resource. Null when it isn't deployed there (Kontext makes the picture then). */
async function flux2Image(base: string, key: string, o: { prompt: string; refs?: RefImage[]; aspect: Aspect }): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const [width, height] = FLUX2_SIZE[o.aspect] ?? FLUX2_SIZE["9:16"];
  const refs = (o.refs ?? []).slice(0, 8);
  const body: Record<string, unknown> = { model: "FLUX.2-pro", prompt: refs.length ? `${o.prompt}\n${refs.length > 1 ? `Keep each person's exact face from the reference images, in order (image 1, image 2${refs.length > 2 ? ", …" : ""}).` : "Keep the exact face of the person in the reference image."}` : o.prompt, width, height };
  refs.forEach((r, i) => (body[i === 0 ? "input_image" : `input_image_${i + 1}`] = r.base64));
  const res = await fetch(`${base}/providers/blackforestlabs/v1/flux-2-pro?api-version=preview`, { method: "POST", headers: { "api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) });
  const text = await res.text();
  if (res.status === 404 && /DeploymentNotFound|does not exist/i.test(text)) return null;
  if (!res.ok) fail(res.status, text);
  const b64 = (JSON.parse(text) as { data?: { b64_json?: string }[] }).data?.[0]?.b64_json;
  if (!b64) throw new Error("Azure AI returned no picture.");
  const bytes = Buffer.from(b64, "base64");
  return { bytes, mimeType: bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : "image/png" };
}

export const foundryDeployment = async () => (await pick("azureAiImageDeployment", "AZURE_AI_IMAGE_DEPLOYMENT")) || "flux-kontext";

const API = "2025-04-01-preview";
const SIZE: Record<Aspect, string> = { "9:16": "768x1344", "16:9": "1344x768", "1:1": "1024x1024" };

export async function foundryReady() {
  return !!((await foundryEndpoint()) && (await foundryKey()));
}

/** The resource's base address, whatever form the owner pasted (…services.ai.azure.com, …openai.azure.com, with or without a path). */
export function foundryBase(endpoint: string) {
  const u = new URL(endpoint.trim());
  return `${u.protocol}//${u.host}`;
}

async function joinRefs(refs: RefImage[]): Promise<{ bytes: Buffer; mime: string }> {
  if (refs.length === 1) return { bytes: Buffer.from(refs[0].base64, "base64"), mime: refs[0].mimeType };
  const sharp = (await import("sharp")).default;
  const h = 1024;
  const parts = await Promise.all(refs.slice(0, 3).map(async (r) => {
    const img = sharp(Buffer.from(r.base64, "base64")).resize({ height: h });
    const buf = await img.png().toBuffer();
    const { width = h } = await sharp(buf).metadata();
    return { buf, width };
  }));
  const width = parts.reduce((n, p) => n + p.width, 0);
  let left = 0;
  const composite = parts.map((p) => { const o = { input: p.buf, left, top: 0 }; left += p.width; return o; });
  const bytes = await sharp({ create: { width, height: h, channels: 3, background: "#000" } }).composite(composite).png().toBuffer();
  return { bytes, mime: "image/png" };
}

function fail(status: number, body: string): never {
  const msg = body.slice(0, 300);
  if (status === 401 || status === 403 || status === 404) throw new MediaGenError(`Azure AI couldn't make the picture (${status}): check the endpoint, key and deployment name in Admin. ${msg}`, "config");
  if (status === 400 && /content|safety|policy|moderat/i.test(body)) throw new MediaGenError("Azure's safety filter declined this picture. Try different wording.", "blocked");
  throw new Error(`Azure AI picture failed (${status}): ${msg}`);
}

export async function foundryImage(o: { prompt: string; refs?: RefImage[]; aspect: Aspect }): Promise<{ bytes: Buffer; mimeType: string }> {
  const [endpoint, key, dep] = [await foundryEndpoint(), await foundryKey(), await foundryDeployment()];
  if (!endpoint || !key) throw new MediaGenError("Azure AI isn't set up: add its endpoint and key in Admin → Integrations.", "config");
  // The newest model first; Kontext (one stitched reference) when FLUX.2 pro isn't deployed or can't make it.
  if (await flux2Enabled()) {
    try {
      const made = await flux2Image(foundryBase(endpoint), key, o);
      if (made) return made;
    } catch (e) {
      if (e instanceof MediaGenError && e.kind === "blocked") throw e;
      console.warn(`[pictures] FLUX.2 pro on Azure couldn't make it (${(e as Error).message.slice(0, 160)}); using Kontext.`);
    }
  }
  const base = `${foundryBase(endpoint)}/openai/deployments/${encodeURIComponent(dep)}`;
  const size = SIZE[o.aspect] ?? SIZE["9:16"];
  let res: Response;
  if (o.refs?.length) {
    const ref = await joinRefs(o.refs);
    const prompt = o.refs.length > 1 ? `${o.prompt}\nThe reference shows ${o.refs.length} people side by side, left to right; keep each person's exact face.` : `${o.prompt}\nKeep the exact face of the person in the reference.`;
    const form = new FormData();
    form.set("prompt", prompt);
    form.set("size", size);
    form.set("image", new Blob([new Uint8Array(ref.bytes)], { type: ref.mime }), "ref.png");
    res = await fetch(`${base}/images/edits?api-version=${API}`, { method: "POST", headers: { "api-key": key }, body: form, signal: AbortSignal.timeout(300_000) });
  } else {
    res = await fetch(`${base}/images/generations?api-version=${API}`, {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: o.prompt, size }),
      signal: AbortSignal.timeout(300_000),
    });
  }
  const text = await res.text();
  if (!res.ok) fail(res.status, text);
  const b64 = (JSON.parse(text) as { data?: { b64_json?: string }[] }).data?.[0]?.b64_json;
  if (!b64) throw new Error("Azure AI returned no picture.");
  return { bytes: Buffer.from(b64, "base64"), mimeType: "image/png" };
}
