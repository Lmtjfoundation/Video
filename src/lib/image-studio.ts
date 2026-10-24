import "server-only";
import { db } from "./db";
import { readFile, storeFile } from "./media";
import { makeImage } from "./pictures";
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
