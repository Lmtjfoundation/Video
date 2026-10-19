import "server-only";
import { claudeJson } from "./llm";
import { videoPost, type RawVideo } from "./video";
import { PLATFORM_SPECS } from "./platforms/specs";
import { MAX_VEO_SCENES, MOVIE_SHAPE, VIDEO_TARGET, renderableScenes, type MovieLength } from "./video-spec";
import type { AnimationEngine, Character, Platform, Post, Settings, VideoPlan } from "./types";

/**
 * Movies and explainer videos with AI visuals: Claude writes the script with one shot description per scene and
 * who is in it; at render time every scene is pictured with Gemini (using the characters' portraits so they stay
 * the same) and the strongest scenes are animated with Veo.
 */


export interface MovieInput {
  kind: "movie" | "explainer";
  /** Movie: the premise. Explainer: the text to explain (or an explanation already written). */
  brief: string;
  characters: Character[];
  look: string;
  platform: Platform;
  length: MovieLength;
  /** How many scenes are animated (0 = pictures with camera moves only). */
  veoScenes: number;
  /** Which model animates them. Missing = Veo. */
  engine?: AnimationEngine;
}

interface RawMovie extends RawVideo {
  /** Scene numbers (1-based) where real motion matters most, strongest first. */
  keyScenes?: number[];
}

/** Picks which scenes Veo animates: the writer's key scenes first, then evenly spaced ones, never the same twice. */
export function pickVeoScenes(plan: Pick<VideoPlan, "scenes">, keyScenes: number[] | undefined, n: number): number[] {
  const usable = renderableScenes(plan).map((s) => s.index);
  const want = Math.max(0, Math.min(n, MAX_VEO_SCENES, usable.length));
  const out: number[] = [];
  for (const k of keyScenes ?? []) {
    const idx = Math.round(Number(k)) - 1;
    if (out.length < want && usable.includes(idx) && !out.includes(idx)) out.push(idx);
  }
  const spread = Array.from({ length: want }, (_, k) => usable[Math.floor(((k + 0.5) * usable.length) / want)]);
  for (const idx of [...spread, ...usable]) if (out.length < want && !out.includes(idx)) out.push(idx);
  return out.sort((a, b) => a - b);
}

export async function writeMovie(o: MovieInput, settings: Settings): Promise<Post> {
  const shape = MOVIE_SHAPE[o.length];
  const spec = PLATFORM_SPECS[o.platform];
  const cast = o.characters.length
    ? o.characters.map((c) => `- ${c.name}: ${c.description || "(see their portrait)"}`).join("\n")
    : "- (no recurring characters: keep scenes about places, objects and anonymous figures)";
  const job =
    o.kind === "movie"
      ? `Write an original short film. PREMISE: ${o.brief}
STYLE: FICTION — an original story, labeled "Fiction" in the caption; never presented as real; no real private people or public figures.
Give it a real story shape: a hook in the first 2 seconds, a goal, rising stakes, a turn, and a satisfying payoff. Narration can mix a narrator with short lines of dialogue (write dialogue as Name: "line").`
      : `Write an explainer video that teaches this clearly to a general audience. Stay faithful to the source: no facts that aren't in it or widely documented; anything uncertain is said plainly.
SOURCE:
"""
${o.brief.slice(0, 12_000)}
"""
STYLE: EXPLAINER — one idea per scene, a concrete example or analogy for each hard idea (clearly marked as an example), and a one-line recap at the end. ${o.characters.length ? "The characters present it: one asks the questions a viewer would, another answers." : ""}`;

  const user = `${job}
PLATFORM: ${VIDEO_TARGET[o.platform]}.
LENGTH: narration totals ${shape.words} across ${shape.scenes} scenes (each scene about 4–8 seconds of narration).
CAST (use these names exactly; they look the same in every scene because their portraits are attached at render time):
${cast}
ART STYLE for every picture: ${o.look}.
EVERY SCENE:
- "narration": what is said (spoken naturally, no stage directions).
- "onScreen": at most 6 punchy words, or "" when the picture should speak for itself.
- "visual": ONE detailed shot description for an AI picture, written like a film storyboard: shot size and angle, who is in frame and what they are doing, their expression, the setting, time of day, lighting and color mood. Describe characters by action and expression only (their portraits fix their looks). No text, signs, logos or real people in the picture.
- "motion": the movement if this scene is animated (e.g. "slow push-in as she turns toward the door").
- "cast": names of the characters visible in the shot ([] if none).
Then "keyScenes": the scene numbers (1-based) where real motion matters most, strongest first.
Caption: written for ${spec.name}; hook first line, 1–3 short lines; 3–5 relevant hashtags without "#".
${settings.brandVoiceNotes ? `CREATOR NOTES: ${settings.brandVoiceNotes}\n` : ""}Reply with ONLY JSON:
{"titles":["3 options, strongest first, under 70 characters"],"hook":"first spoken line","caption":"…","hashtags":["…"],"cta":"…","thumbnail":{"text":"2–4 words","prompt":"…"},"voice":"…","music":"…","scenes":[{"time":"0:00–0:05","narration":"…","onScreen":"…","visual":"…","motion":"…","sfx":"","cast":["…"]}],"keyScenes":[3,7],"loopLine":"…","factCheck":["every factual claim to verify (empty for pure fiction)"],"moneyAngle":"how this video earns"}`;

  const raw = await claudeJson<RawMovie>({
    system:
      o.kind === "movie"
        ? "You are an award-winning short-film writer and storyboard artist. Every scene moves the story, every shot is specific and visual, and nothing is padded."
        : "You are a brilliant teacher and explainer-video producer. You make hard ideas simple without making them wrong, and every scene earns its place.",
    user,
    maxTokens: o.length === "m3" ? 9000 : 5000,
    temperature: o.kind === "movie" ? 0.85 : 0.6,
  });
  if (!Array.isArray(raw?.scenes) || !raw.scenes.length) throw new Error("The script came back empty. Try again.");
  raw.scenes = raw.scenes.slice(0, shape.max);

  const post = videoPost(raw, { platform: o.platform, niche: o.kind === "movie" ? "Short film" : "Explainer", style: o.kind === "movie" ? "fiction" : "explainer", length: o.length, topic: o.brief.slice(0, 140) }, settings);
  const plan = post.video!;
  const names = new Map(o.characters.map((c) => [c.name.toLowerCase(), c.name]));
  plan.scenes = plan.scenes.map((s, i) => ({
    ...s,
    cast: (raw.scenes?.[i]?.cast ?? []).map((n) => names.get(String(n).trim().toLowerCase())).filter((n): n is string => !!n),
  }));
  plan.ai = { characterIds: o.characters.map((c) => c.id), look: o.look, veoScenes: [], ...(o.engine && o.engine !== "veo" ? { engine: o.engine } : {}) };
  plan.ai.veoScenes = pickVeoScenes(plan, raw.keyScenes, o.veoScenes);
  return post;
}
