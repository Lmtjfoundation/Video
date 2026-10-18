import "server-only";
import { db } from "./db";
import { claude } from "./llm";
import { readFile, storeFile } from "./media";
import { kvGet, kvSet } from "./repo";
import { geminiImage, type RefImage } from "./gemini-media";
import type { Character, MediaItem } from "./types";
import { nowIso, uid } from "./utils";

/**
 * Characters library: reusable cast members for movies and explainers. Each one has a portrait made with
 * Gemini (from the person's photo, or from a description) that is sent as the reference picture in every scene,
 * so the character looks the same throughout a video. Stored as one list per account.
 */
const ROW = "characters";
export const MAX_CHARACTERS = 40;

/** Art styles offered in the app. Free text is accepted too. */
export const CHARACTER_LOOKS = [
  "Pixar-style 3D animation, soft cinematic lighting",
  "Anime, clean line art, vivid colors",
  "Comic book, bold ink and halftone shading",
  "Storybook watercolor illustration",
  "Claymation stop-motion",
  "Cinematic photorealistic film still",
] as const;

export async function listCharacters(): Promise<Character[]> {
  return (await kvGet<Character[]>(ROW)) ?? [];
}

async function saveAll(list: Character[]) {
  await kvSet(ROW, list);
}

export async function getCharacters(ids: string[]): Promise<Character[]> {
  const all = await listCharacters();
  return ids.map((id) => all.find((c) => c.id === id)).filter((c): c is Character => !!c);
}

export async function deleteCharacter(id: string) {
  await saveAll((await listCharacters()).filter((c) => c.id !== id));
}

/** The portrait as a reference picture for Gemini and Veo. */
export async function characterRef(c: Character): Promise<RefImage | null> {
  const m = await db().get<MediaItem>("media", c.imageMediaId);
  if (!m) return null;
  return { mimeType: m.type, base64: (await readFile(m)).toString("base64") };
}

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

/** Describes the person or subject in a photo (appearance only) so prompts can keep them consistent. */
async function describePhoto(photo: RefImage): Promise<string> {
  const mediaType = PHOTO_TYPES.find((t) => t === photo.mimeType);
  if (!mediaType) return "";
  try {
    const text = await claude({
      system: "You describe how a character looks so an illustrator can draw them the same way every time. Appearance only: no guesses about identity, ethnicity labels, age numbers or personality.",
      user: "Describe the main person (or animal or object) in this photo in 2–3 sentences: build, face shape, hair, skin tone, eye color, clothing, colors and any distinctive features.",
      images: [{ mediaType, base64: photo.base64 }],
      maxTokens: 300,
      temperature: 0.3,
    });
    return text.trim().slice(0, 700);
  } catch {
    return ""; // the portrait still works from the photo alone
  }
}

export interface NewCharacter {
  name: string;
  description?: string;
  look: string;
  /** Media library id of a photo to base the character on. */
  photoId?: string;
}

export async function createCharacter(userId: string, input: NewCharacter): Promise<Character> {
  const name = input.name.trim().slice(0, 40);
  const look = input.look.trim().slice(0, 160) || CHARACTER_LOOKS[0];
  let description = (input.description ?? "").trim().slice(0, 900);
  if (!name) throw new Error("Give the character a name.");
  const list = await listCharacters();
  if (list.length >= MAX_CHARACTERS) throw new Error(`You can keep up to ${MAX_CHARACTERS} characters. Delete one to make room.`);
  if (list.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new Error(`You already have a character named ${name}.`);

  let photo: RefImage | null = null;
  if (input.photoId) {
    const m = await db().get<MediaItem>("media", input.photoId);
    if (!m || m.kind !== "image") throw new Error("That photo wasn't found in your Media Library.");
    photo = { mimeType: m.type, base64: (await readFile(m)).toString("base64") };
  }
  if (!photo && !description) throw new Error("Add a photo or describe how the character looks.");
  if (photo && !description) description = await describePhoto(photo);

  const prompt = [
    `Character design portrait of "${name}" in this art style: ${look}.`,
    photo
      ? "Base the character on the main subject of the attached photo: keep their face shape, hair, skin tone, build and clothing recognisable, translated into the art style."
      : "",
    description ? `Appearance: ${description}` : "",
    "Full body, standing in a relaxed three-quarter pose, facing the viewer, plain soft neutral studio background, even lighting, the whole figure in frame.",
    "No text, no logos, no watermark, one character only.",
  ]
    .filter(Boolean)
    .join("\n");
  const img = await geminiImage({ prompt, refs: photo ? [photo] : [], aspect: "9:16", size: "2K" });
  const type = img.mimeType === "image/jpeg" ? "image/jpeg" : img.mimeType === "image/webp" ? "image/webp" : "image/png";
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "character";
  const item = await storeFile(userId, { name: `character-${slug}.${type.split("/")[1]}`, type, bytes: img.bytes });

  const c: Character = { id: uid("chr"), name, description, look, imageMediaId: item.id, sourceMediaId: input.photoId, createdAt: nowIso() };
  // Re-read: another request may have changed the list while the picture was being made.
  await saveAll([c, ...(await listCharacters())]);
  return c;
}
