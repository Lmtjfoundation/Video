import "server-only";
import { geminiImage, mediaKey, MediaGenError, type Aspect, type RefImage } from "./gemini-media";
import { engineFirst, ownEngineAwake, ownEngineReady, ownImage } from "./own-video";
import { fluxImage, replicateReady } from "./replicate-video";

/**
 * Every AI picture in the app goes through here. Ghost Post's own engine (Qwen-Image on the owner's GPU) makes it
 * when that GPU is already running, or when there's no Gemini key. Otherwise Gemini makes it: about 5¢ a picture,
 * where starting a GPU billed by the hour for one picture costs far more than the picture earns. When Gemini can't
 * (no key, or a key or billing problem the owner has to fix), FLUX.2 on Replicate makes it instead, so videos get real
 * pictures rather than stock footage.
 */
export async function makeImage(o: { prompt: string; refs?: RefImage[]; aspect: Aspect; size?: "1K" | "2K" }): Promise<{ bytes: Buffer; mimeType: string }> {
  const cap = o.refs?.length ? "edit-pictures" : "pictures";
  const backup = !!(await mediaKey()) || (await replicateReady());
  if ((await ownEngineAwake(cap)) || (await engineFirst(cap)) || (!backup && (await ownEngineReady(cap)))) {
    try {
      const bytes = await ownImage({ prompt: o.prompt, refs: (o.refs ?? []).slice(0, 3).map((r) => ({ bytes: Buffer.from(r.base64, "base64"), mime: r.mimeType })), aspect: o.aspect });
      return { bytes, mimeType: "image/png" };
    } catch (e) {
      if (!backup || (e instanceof MediaGenError && e.kind === "blocked")) throw e;
      console.warn(`[pictures] Ghost Post's engine couldn't make this picture (${(e as Error).message.slice(0, 160)}); using the backup.`);
    }
  }
  if (!(await mediaKey())) {
    if (await replicateReady()) return fluxImage(o);
    return geminiImage(o); // explains which key to add
  }
  try {
    return await geminiImage(o);
  } catch (e) {
    if (!(e instanceof MediaGenError && e.kind === "config") || !(await replicateReady())) throw e;
    console.warn(`[pictures] Gemini can't make pictures (${e.message.slice(0, 160)}); using Flux on Replicate.`);
    return fluxImage(o);
  }
}

/** Whether the app can make AI pictures right now, and with what. */
export async function picturesReady(): Promise<"own" | "gemini" | "flux" | null> {
  if (await ownEngineReady()) return "own";
  if (await mediaKey()) return "gemini";
  return (await replicateReady()) ? "flux" : null;
}
