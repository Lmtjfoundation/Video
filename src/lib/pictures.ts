import "server-only";
import { geminiImage, mediaKey, type Aspect, type RefImage } from "./gemini-media";
import { ownEngineAwake, ownEngineReady, ownImage } from "./own-video";

/**
 * Every AI picture in the app goes through here. Ghost Post's own engine (Qwen-Image on the owner's GPU) makes it
 * when that GPU is already running, or when there's no Gemini key. Otherwise Gemini makes it: about 5¢ a picture,
 * where starting a GPU billed by the hour for one picture costs far more than the picture earns.
 */
export async function makeImage(o: { prompt: string; refs?: RefImage[]; aspect: Aspect; size?: "1K" | "2K" }): Promise<{ bytes: Buffer; mimeType: string }> {
  const cap = o.refs?.length ? "edit-pictures" : "pictures";
  if ((await ownEngineAwake(cap)) || (!(await mediaKey()) && (await ownEngineReady(cap)))) {
    const bytes = await ownImage({ prompt: o.prompt, refs: (o.refs ?? []).slice(0, 3).map((r) => ({ bytes: Buffer.from(r.base64, "base64"), mime: r.mimeType })), aspect: o.aspect });
    return { bytes, mimeType: "image/png" };
  }
  return geminiImage(o);
}

/** Whether the app can make AI pictures right now, and with what. */
export async function picturesReady(): Promise<"own" | "gemini" | null> {
  if (await ownEngineReady()) return "own";
  return (await mediaKey()) ? "gemini" : null;
}
