import "server-only";
import { claudeJson } from "./llm";
import { EFFECTS, GRADES, MOVES, sceneFrom, type Grade, type MoviePlan, type MovieScene } from "./movie-maker";

/**
 * Video Lab: an idea becomes a filmed video without a GPU. The AI writes a shot list (picture, narration, camera move
 * and effects per shot); Movie Maker's engine then paints each picture (Azure's GPUs or the app's picture maker), moves
 * the camera through it with depth, adds the effects, the grade, the voice and the music, and cuts it together.
 */
/** Short videos are written for review first; long ones (5 min to 1 h 30 min) are written and filmed chapter by chapter. */
export const LAB_LENGTHS = { s15: 15, s30: 30, s60: 60, s90: 90, m5: 300, m10: 600, m20: 1200, m30: 1800, m45: 2700, m60: 3600, m90: 5400 } as const;
export const isLong = (l: LabLength) => LAB_LENGTHS[l] > 90;
/** About one chapter every 5 minutes, each in shots of about 12 seconds. */
export const CHAPTER_SECONDS = 300;
export const LONG_SHOT_SECONDS = 12;
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

const SHORT_SHOT_SECONDS = 5;

/** The shot list for an idea: about one shot every 5 seconds, each with narration, a picture, a move and effects. */
export async function labPlan(o: LabInput & { seconds?: number; shotSeconds?: number; context?: string }, write: typeof claudeJson = claudeJson): Promise<MoviePlan> {
  const total = o.seconds ?? LAB_LENGTHS[o.length] ?? 30;
  const SHOT_SECONDS = o.shotSeconds ?? SHORT_SHOT_SECONDS;
  const shots = Math.max(3, Math.round(total / SHOT_SECONDS));
  const style = LAB_STYLES[o.style] ?? LAB_STYLES.cinematic;
  const cast = (o.cast ?? []).filter(Boolean).slice(0, 3);
  const r = await write<{ title?: string; caption?: string; scenes?: Partial<MovieScene>[] }>({
    system: "You are a film director and editor. You plan short videos shot by shot. Answer with JSON only.",
    user: [
      `Plan a ${total}-second video in exactly ${shots} shots of about ${SHOT_SECONDS} seconds each.`,
      `Idea: ${o.idea.trim().slice(0, 2000)}`,
      o.context ? o.context.slice(0, 3000) : "",
      `Look: ${style.label}.`,
      cast.length ? `Cast (name them in the shots they appear in): ${cast.join(", ")}.` : "",
      "Each shot: narration (what the voice says over it, 8-14 words, or empty for a silent beat), visual (one vivid picture to paint: who, where, light, framing; no text in the picture), onScreen (0-4 words of title text, usually empty), move (one of: " +
        MOVES.join(", ") +
        "), effects (0-2 of: " +
        EFFECTS.join(", ") +
        "), seconds (${Math.max(3, SHOT_SECONDS - 3)}-${Math.min(20, SHOT_SECONDS + 4)}).",
      "Hook in the first shot, build, and land a strong last line. Vary framing and moves.",
      'JSON: {"title": "...", "caption": "a social caption with 3 hashtags", "scenes": [{"narration": "", "visual": "", "onScreen": "", "move": "", "effects": [], "seconds": 5}]}',
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: Math.min(16000, 1500 + shots * 220),
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

export interface LongOutline {
  title: string;
  caption: string;
  chapters: { title: string; summary: string }[];
}

/** The chapters of a long video: one every ~5 minutes, with a title and what happens in it. */
export async function labOutline(o: LabInput, write: typeof claudeJson = claudeJson): Promise<LongOutline> {
  const total = LAB_LENGTHS[o.length];
  const count = Math.max(1, Math.ceil(total / CHAPTER_SECONDS));
  const r = await write<{ title?: string; caption?: string; chapters?: { title?: string; summary?: string }[] }>({
    system: "You are a showrunner. You outline long videos into chapters. Answer with JSON only.",
    user: [
      `Outline a ${Math.round(total / 60)}-minute video in exactly ${count} chapters of about ${Math.round(CHAPTER_SECONDS / 60)} minutes each.`,
      `Idea: ${o.idea.trim().slice(0, 2000)}`,
      `Look: ${(LAB_STYLES[o.style] ?? LAB_STYLES.cinematic).label}.`,
      o.cast?.length ? `Cast: ${o.cast.join(", ")}.` : "",
      "Each chapter: a short title and a 3-5 sentence summary of what happens, so the story builds chapter to chapter with a strong ending.",
      'JSON: {"title": "...", "caption": "a social caption with 3 hashtags", "chapters": [{"title": "", "summary": ""}]}',
    ].filter(Boolean).join("\n"),
    maxTokens: Math.min(12000, 1200 + count * 350),
    temperature: 0.8,
  });
  const chapters = (r.chapters ?? []).slice(0, count).map((c, i) => ({ title: String(c.title ?? `Chapter ${i + 1}`).slice(0, 80), summary: String(c.summary ?? "").slice(0, 1500) })).filter((c) => c.summary);
  if (!chapters.length) throw new Error("The AI didn't outline any chapters. Try describing the video in a bit more detail.");
  return { title: String(r.title ?? "").slice(0, 120) || o.idea.slice(0, 60), caption: String(r.caption ?? "").slice(0, 2000), chapters };
}

/** One chapter's shots, written with the whole outline in view so the story stays continuous. */
export function chapterPlan(o: LabInput, outline: LongOutline, i: number, write: typeof claudeJson = claudeJson) {
  const ch = outline.chapters[i];
  const before = outline.chapters.slice(Math.max(0, i - 2), i).map((c, k) => `Chapter ${i - Math.min(i, 2) + k + 1} (${c.title}): ${c.summary}`).join("\n");
  const after = outline.chapters[i + 1] ? `Next chapter (${outline.chapters[i + 1].title}): ${outline.chapters[i + 1].summary}` : "This is the final chapter: land the ending.";
  const context = [`This is chapter ${i + 1} of ${outline.chapters.length} of "${outline.title}": ${ch.title}. ${ch.summary}`, before ? `Story so far:\n${before}` : "", after].filter(Boolean).join("\n");
  return labPlan({ ...o, seconds: CHAPTER_SECONDS, shotSeconds: LONG_SHOT_SECONDS, context }, write);
}

export interface LongJobInput extends LabInput {
  characterIds: string[];
  voice: boolean;
  musicMediaId?: string;
  credits: number;
}

/** Credits for a long video, taken at the start (given back if it fails): every picture, plus the voice. */
export function longCredits(length: LabLength, voice: boolean, cost: { aiImage: number; speech: number }) {
  const shots = Math.round(LAB_LENGTHS[length] / LONG_SHOT_SECONDS);
  // About 12 spoken words (~75 characters) a shot.
  return shots * cost.aiImage + (voice ? Math.ceil((shots * 75) / 1000) * cost.speech : 0);
}
