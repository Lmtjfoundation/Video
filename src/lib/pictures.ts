import "server-only";
import { geminiImage, mediaKey, type Aspect, type RefImage } from "./gemini-media";
import { ownEngineReady, ownImage } from "./own-video";

/**
 * Every AI picture in the app goes through here. Ghost Post's own engine comes first (Qwen-Image on the owner's GPU:
 * no other company's credits are used); Gemini is used only when the engine isn't connected.
 */
export async function makeImage(o: { prompt: string; refs?: RefImage[]; aspect: Aspect; size?: "1K" | "2K" }): Promise<{ bytes: Buffer; mimeType: string }> {
  if (await ownEngineReady()) {
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
