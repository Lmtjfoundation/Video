import "server-only";
import { claudeJson } from "./llm";
import { EFFECTS, GRADES, MOVES, sceneFrom, type Grade, type MoviePlan, type MovieScene } from "./movie-maker";

/**
 * Video Lab: an idea becomes a filmed video without a GPU. The AI writes a shot list (picture, narration, camera move
 * and effects per shot); Movie Maker's engine then paints each picture (Azure's GPUs or the app's picture maker), moves
 * the camera through it with depth, adds the effects, the grade, the voice and the music, and cuts it together.
 */
export const LAB_LENGTHS = { s15: 15, s30: 30, s60: 60, s90: 90 } as const;
export type LabLength = keyof typeof LAB_LENGTHS;
export const LAB_STYLES = {
  cinematic: { label: "Cinematic film", grade: "teal_orange", look: "photorealistic cinematic film still, 35mm, shallow depth of field, dramatic light" },
  noir: { label: "Crime noir", grade: "cadmium_purple", look: "photorealistic neo-noir film still, neon and shadow, rain-slick streets, 35mm" },
  documentary: { label: "Documentary", grade: "warm", look: "photorealistic documentary photograph, natural light, real places and people" },
  horror: { label: "Horror", grade: "cadmium_purple", look: "photorealistic horror film still, deep shadow, cold light, unsettling" },
  ad: { label: "Bright ad", grade: "warm", look: "bright clean commercial photography, crisp light, vivid color" },
  classic: { label: "Black & white", grade: "noir", look: "black and white film photograph, high contrast, film grain" },
} as const satisfies Record<string, { label: string; grade: Grade; look: string }>;
export type LabStyle = keyof typeof LAB_STYLES;

export interface LabInput {
  idea: string;
  length: LabLength;
  style: LabStyle;
  /** Names of the cast whose faces the pictures keep (from Characters). */
  cast?: string[];
}

const SHOT_SECONDS = 5;

/** The shot list for an idea: about one shot every 5 seconds, each with narration, a picture, a move and effects. */
export async function labPlan(o: LabInput, write: typeof claudeJson = claudeJson): Promise<MoviePlan> {
  const total = LAB_LENGTHS[o.length] ?? 30;
  const shots = Math.max(3, Math.round(total / SHOT_SECONDS));
  const style = LAB_STYLES[o.style] ?? LAB_STYLES.cinematic;
  const cast = (o.cast ?? []).filter(Boolean).slice(0, 3);
  const r = await write<{ title?: string; caption?: string; scenes?: Partial<MovieScene>[] }>({
    system: "You are a film director and editor. You plan short videos shot by shot. Answer with JSON only.",
    user: [
      `Plan a ${total}-second video in exactly ${shots} shots of about ${SHOT_SECONDS} seconds each.`,
      `Idea: ${o.idea.trim().slice(0, 2000)}`,
      `Look: ${style.label}.`,
      cast.length ? `Cast (name them in the shots they appear in): ${cast.join(", ")}.` : "",
      "Each shot: narration (what the voice says over it, 8-14 words, or empty for a silent beat), visual (one vivid picture to paint: who, where, light, framing; no text in the picture), onScreen (0-4 words of title text, usually empty), move (one of: " +
        MOVES.join(", ") +
        "), effects (0-2 of: " +
        EFFECTS.join(", ") +
        "), seconds (3-7).",
      "Hook in the first shot, build, and land a strong last line. Vary framing and moves.",
      'JSON: {"title": "...", "caption": "a social caption with 3 hashtags", "scenes": [{"narration": "", "visual": "", "onScreen": "", "move": "", "effects": [], "seconds": 5}]}',
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: 4000,
    temperature: 0.8,
  });
  const scenes = (r.scenes ?? []).slice(0, Math.max(shots + 2, 3)).map((s, i) => sceneFrom(s, i));
  if (!scenes.length) throw new Error("The AI didn't write any shots. Try describing the video in a bit more detail.");
  return { title: String(r.title ?? "").slice(0, 120) || o.idea.slice(0, 60), look: style.look, voice: "", music: "", caption: String(r.caption ?? "").slice(0, 2000), scenes };
}

export const labGrade = (style: LabStyle): Grade => {
  const g = (LAB_STYLES[style] ?? LAB_STYLES.cinematic).grade;
  return (GRADES as readonly string[]).includes(g) ? (g as Grade) : "teal_orange";
};
