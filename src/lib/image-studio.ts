import "server-only";
import { db } from "./db";
import { readFile, storeFile } from "./media";
import { makeImage } from "./pictures";
import { angleInstruction, imageTool, type ImageToolId } from "./image-tools";
import { ownImageTool } from "./own-video";
import { CREDIT_COST } from "./plans";
import { runCmd } from "./render";
import { characterRef, getCharacters, isRealisticLook, REALISM_DIRECTION } from "./characters";
import type { Aspect, RefImage } from "./gemini-media";
import type { MediaItem } from "./types";

/**
 * Image Studio: make a picture from a description, change a picture by describing the change, or put up to three of
 * your characters into a new scene with their faces kept. Every result is saved to the Media Library.
 */
export type ImageMode = "create" | "edit" | "scene";
export const IMAGE_MODES: ImageMode[] = ["create", "edit", "scene"];
export const STUDIO_PREFIX = "studio-";

export interface ImageStudioInput {
  mode: ImageMode;
  prompt: string;
  look?: string;
  aspect: Aspect;
  /** edit: the picture to change. scene: an optional location picture. */
  mediaId?: string;
  /** scene: the characters in it (up to three). */
  characterIds?: string[];
}

async function picture(mediaId: string): Promise<RefImage> {
  const m = await db().get<MediaItem>("media", mediaId);
  if (!m || m.kind !== "image") throw new Error("That picture wasn't found in your Media Library.");
  return { mimeType: m.type, base64: (await readFile(m)).toString("base64") };
}

/** The words the model gets, and the pictures it gets with them, for each mode. */
export async function studioRequest(o: ImageStudioInput): Promise<{ prompt: string; refs: RefImage[] }> {
  const what = o.prompt.trim().slice(0, 1500);
  if (!what) throw new Error("Describe the picture.");
  const style = o.look?.trim() ? `Art style: ${o.look.trim().slice(0, 200)}.` : "";
  const real = o.look && isRealisticLook(o.look) ? REALISM_DIRECTION : "";
  const clean = "No text, letters, logos or watermarks unless asked for.";
  if (o.mode === "edit") {
    if (!o.mediaId) throw new Error("Choose the picture to change.");
    return { prompt: [`Edit picture 1: ${what}`, "Keep everything that isn't mentioned exactly as it is: the same people, faces, framing and lighting.", style].filter(Boolean).join("\n"), refs: [await picture(o.mediaId)] };
  }
  if (o.mode === "scene") {
    const cast = (await getCharacters((o.characterIds ?? []).slice(0, 3))).slice(0, 3);
    if (!cast.length) throw new Error("Choose at least one character for the scene.");
    const refs: RefImage[] = [];
    const names: string[] = [];
    for (const c of cast) {
      const r = await characterRef(c);
      if (!r) continue;
      refs.push(r);
      names.push(`${c.name} is the person in picture ${refs.length} (${c.description.slice(0, 200)})`);
    }
    if (!refs.length) throw new Error("Those characters' portraits are missing from the Media Library.");
    if (o.mediaId && refs.length < 3) {
      refs.push(await picture(o.mediaId));
      names.push(`the setting is the place in picture ${refs.length}`);
    }
    return {
      prompt: [`A new film frame: ${what}`, `${names.join("; ")}.`, "Keep each person's face, hair, skin tone, build and outfit exactly as in their picture.", style, real, clean].filter(Boolean).join("\n"),
      refs,
    };
  }
  return { prompt: [what, style, real, clean].filter(Boolean).join("\n"), refs: [] };
}

export async function makeStudioImage(userId: string, o: ImageStudioInput): Promise<MediaItem> {
  const { prompt, refs } = await studioRequest(o);
  const img = await makeImage({ prompt, refs, aspect: o.aspect, size: "2K" });
  const type = img.mimeType === "image/jpeg" ? "image/jpeg" : img.mimeType === "image/webp" ? "image/webp" : "image/png";
  const slug = o.prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "picture";
  return storeFile(userId, { name: `${STUDIO_PREFIX}${o.mode}-${slug}.${type.split("/")[1]}`, type, bytes: img.bytes });
}

export interface ImageToolInput {
  tool: ImageToolId;
  mediaId: string;
  prompt?: string;
  /** expand: the new shape; others keep the picture's own shape. */
  aspect?: Aspect;
  /** swap: the character who takes the person's place. */
  characterId?: string;
  angle?: { rotate: number; tilt: number; lens: "wide" | "normal" | "close" };
  scale?: 2 | 4;
}

export const imageToolCredits = (tool: ImageToolId) => {
  const t = imageTool(tool);
  if (!t) throw new Error("Unknown tool.");
  return t.cost === "upscale" ? CREDIT_COST.upscale : t.cost === "removeBg" ? CREDIT_COST.removeBg : CREDIT_COST.aiImage;
};

/** The shape closest to a picture's own (the edit model makes 9:16, 16:9 or 1:1). */
async function shapeOf(m: MediaItem): Promise<Aspect> {
  const os = await import("os");
  const path = await import("path");
  const fs = await import("fs/promises");
  const f = path.join(os.tmpdir(), `ghost-post-shape-${m.id}`);
  await fs.writeFile(f, await readFile(m));
  try {
    const [w, h] = (await runCmd("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", f], 30_000)).trim().split(",").map(Number);
    const r = w / h;
    return r > 1.25 ? "16:9" : r < 0.8 ? "9:16" : "1:1";
  } finally {
    await fs.rm(f, { force: true });
  }
}

const KEEP = "Keep everything that isn't mentioned exactly as it is: the same people, faces, clothes, framing and colors.";

/** The edit model's instruction for each tool (and the pictures it gets). Exported for tests. */
export async function toolRequest(o: ImageToolInput, pic: RefImage): Promise<{ prompt: string; refs: RefImage[] }> {
  const say = (o.prompt ?? "").trim().slice(0, 600);
  const need = (what: string) => {
    if (!say) throw new Error(what);
    return say;
  };
  switch (o.tool) {
    case "erase":
      return { prompt: `Remove ${need("Say what to remove.")} from picture 1 and fill the space naturally, matching the surroundings, as if it was never there. ${KEEP}`, refs: [pic] };
    case "expand":
      return { prompt: `Zoom out from picture 1: show more of the scene around it in a ${o.aspect ?? "16:9"} frame, continuing it naturally past every edge${say ? ` (${say})` : ""}. The original picture stays unchanged in the middle, at a smaller size.`, refs: [pic] };
    case "background":
      return { prompt: `Keep the main subject of picture 1 exactly as it is (face, hair, body, clothes, pose) and replace the background with: ${need("Describe the new background.")}. Match the light on the subject to the new background, with natural edges and shadows.`, refs: [pic] };
    case "restyle":
      return { prompt: `Redraw picture 1 in this style: ${need("Describe the new style.")}. Keep the composition, the people, their poses and expressions.`, refs: [pic] };
    case "relight":
      return { prompt: `Relight picture 1: ${need("Describe the new light.")}. Change only the lighting, shadows and the color of the light; keep the people, faces, place and framing the same.`, refs: [pic] };
    case "angle":
      return { prompt: `Show the same moment as picture 1 from a different camera position: ${angleInstruction(o.angle ?? { rotate: 30, tilt: 0, lens: "normal" })}. Keep the same people, faces, clothes, place and lighting.`, refs: [pic] };
    case "unblur":
      return { prompt: "Restore picture 1: remove the blur, noise, compression artefacts, scratches and fading; sharpen fine detail like eyes, hair and text. It must stay exactly the same picture.", refs: [pic] };
    case "retouch":
      return { prompt: "Retouch the faces in picture 1 like a professional photo retoucher: smooth the skin naturally, even out the tone, soften blemishes, shine and under-eye shadows, keep real skin texture. Keep each person's identity and everything else unchanged.", refs: [pic] };
    case "headshot":
      return { prompt: `A professional headshot of the person in picture 1${say ? `: ${say}` : ", soft grey studio backdrop, smart casual clothes"}. Head and shoulders, looking at the camera, sharp eyes, flattering soft light, shallow depth of field. Keep their face, features, skin tone and hair exactly.`, refs: [pic] };
    case "swap": {
      const [c] = await getCharacters(o.characterId ? [o.characterId] : []);
      if (!c) throw new Error("Choose the character to put in the picture.");
      const ref = await characterRef(c);
      if (!ref) throw new Error("That character's portrait is missing from the Media Library.");
      return { prompt: `Replace the person in picture 1 with ${c.name}, the person in picture 2: their face, hair, skin tone and build, in exactly the pose, framing, clothes and lighting of picture 1. Everything else in picture 1 stays the same.`, refs: [pic, ref] };
    }
    default:
      throw new Error("That tool doesn't use the edit model.");
  }
}

/** Runs one picture tool on a Media Library picture; the result is saved next to it. */
export async function makeToolImage(userId: string, o: ImageToolInput): Promise<MediaItem> {
  const t = imageTool(o.tool);
  if (!t) throw new Error("Unknown tool.");
  const m = await db().get<MediaItem>("media", o.mediaId);
  if (!m || m.kind !== "image") throw new Error("Choose a picture from your Media Library.");
  const base = m.name.replace(/\.[a-z0-9]+$/i, "").replace(/^studio-[a-z-]+?-/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "picture";
  if (t.cost !== "image") {
    const op = o.tool === "upscale" ? "upscale" : "remove-bg";
    const bytes = await ownImageTool({ op, image: await readFile(m), mime: m.type, scale: o.scale === 2 ? 2 : 4 });
    return storeFile(userId, { name: `${STUDIO_PREFIX}${o.tool}-${base}.png`, type: "image/png", bytes }, { uncapped: true });
  }
  const { prompt, refs } = await toolRequest(o, await picture(m.id));
  const aspect = o.tool === "expand" && o.aspect ? o.aspect : await shapeOf(m);
  const img = await makeImage({ prompt, refs, aspect, size: "2K" });
  const type = img.mimeType === "image/jpeg" ? "image/jpeg" : img.mimeType === "image/webp" ? "image/webp" : "image/png";
  return storeFile(userId, { name: `${STUDIO_PREFIX}${o.tool}-${base}.${type.split("/")[1]}`, type, bytes: img.bytes });
}
