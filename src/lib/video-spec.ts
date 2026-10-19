import type { AnimationEngine, Platform, VideoPlan, VideoScene } from "./types";
import { CREDIT_COST } from "./plans";

type LengthTier = "short" | "mid" | "long";

/** Video post options shared by the UI and the generator. `long` = 16:9 landscape; everything else is 9:16. */
export const VIDEO_LENGTHS: Record<VideoPlan["length"], { label: string; words: string; scenes: string; long: boolean; tier: LengthTier }> = {
  s30: { label: "Short · 25–35 seconds", words: "65–90 words", scenes: "8–11", long: false, tier: "short" },
  s60: { label: "Short · 45–58 seconds", words: "120–150 words", scenes: "12–16", long: false, tier: "short" },
  s90: { label: "61–90 seconds (TikTok only pays over 1 minute)", words: "170–230 words", scenes: "16–22", long: false, tier: "short" },
  m3: { label: "3 minutes · vertical (TikTok, Reels, Shorts)", words: "430–480 words", scenes: "36–48", long: false, tier: "mid" },
  m10: { label: "10 minutes · vertical (TikTok, Facebook, YouTube)", words: "1,350–1,500 words", scenes: "45–65", long: false, tier: "long" },
  long: { label: "Long-form · 8–10 minutes · 16:9 (YouTube, Facebook)", words: "1,200–1,500 words", scenes: "40–60", long: true, tier: "long" },
};

/**
 * Which lengths each platform accepts. X caps standard accounts at 2 min 20 s; Instagram Reels at 3 minutes;
 * 10-minute vertical video is for TikTok, Facebook and YouTube; 16:9 long-form for YouTube and Facebook.
 */
export function lengthAllowed(length: VideoPlan["length"], platform: Platform) {
  if (length === "long") return platform === "youtube" || platform === "facebook";
  if (length === "m10") return platform === "tiktok" || platform === "facebook" || platform === "youtube";
  if (length === "m3") return platform !== "x";
  return true;
}

/** Credits for writing a video plan or rendering it, by length. */
export function videoCredits(length: VideoPlan["length"] | undefined, action: "plan" | "render") {
  const tier = VIDEO_LENGTHS[length ?? "s60"]?.tier ?? "short";
  if (action === "plan") return tier === "long" ? CREDIT_COST.videoLong : tier === "mid" ? CREDIT_COST.videoMid : CREDIT_COST.videoShort;
  return tier === "long" ? CREDIT_COST.renderLong : tier === "mid" ? CREDIT_COST.renderMid : CREDIT_COST.renderShort;
}

/** Scenes the renderer turns into video (blank scenes are skipped), with their index in `plan.scenes`. */
export function renderableScenes(plan: Pick<VideoPlan, "scenes">) {
  return plan.scenes.map((scene, index) => ({ scene, index })).filter(({ scene }) => scene.narration.trim() || scene.onScreen.trim());
}

/** Planned length of a scene: narration read at a natural pace (about 2.6 words a second), never under 1.8 s. */
export const sceneSeconds = (scene: Pick<VideoScene, "narration">) => Math.max(1.8, scene.narration.split(/\s+/).filter(Boolean).length / 2.6);

/** Veo makes 4, 6 or 8 second clips: the shortest that covers the scene (the last frame holds if the voice runs longer). */
export const veoSeconds = (scene: Pick<VideoScene, "narration">): 4 | 6 | 8 => {
  const s = sceneSeconds(scene);
  return s <= 4 ? 4 : s <= 6 ? 6 : 8;
};

/** Credits per second of an animated scene, by engine. */
export const animationSecondCredits = (engine?: AnimationEngine) => (engine === "seedance" ? CREDIT_COST.seedanceSecond : CREDIT_COST.veoSecond);

/** Credits for the AI pictures and Veo clips of a plan with `ai` visuals (0 for stock-footage videos). */
export function aiVisualCredits(plan: Pick<VideoPlan, "scenes" | "ai">) {
  if (!plan.ai) return 0;
  const veo = new Set(plan.ai.veoScenes);
  const perSecond = animationSecondCredits(plan.ai.engine);
  return renderableScenes(plan).reduce(
    (sum, { scene, index }) => sum + CREDIT_COST.aiImage + (veo.has(index) ? veoSeconds(scene) * perSecond : 0),
    0,
  );
}

/** Everything a render costs: voice, assembly and captions by length, plus any AI pictures and Veo clips. */
export const renderCredits = (plan: Pick<VideoPlan, "length" | "scenes" | "ai"> | undefined) =>
  videoCredits(plan?.length, "render") + (plan ? aiVisualCredits(plan) : 0);

/* Movies and explainers with AI visuals (Movie Studio). */
export const MOVIE_LENGTHS = ["s30", "s60", "s90", "m3"] as const;
export type MovieLength = (typeof MOVIE_LENGTHS)[number];

/** Fewer, longer scenes than a stock-footage video: each scene is a picture (and maybe a Veo clip) that costs credits. */
export const MOVIE_SHAPE: Record<MovieLength, { label: string; words: string; scenes: string; min: number; max: number }> = {
  s30: { label: "About 30 seconds", words: "65–90 words", scenes: "6–8", min: 6, max: 8 },
  s60: { label: "About 1 minute", words: "120–150 words", scenes: "9–12", min: 9, max: 12 },
  s90: { label: "About 90 seconds", words: "170–230 words", scenes: "12–16", min: 12, max: 16 },
  m3: { label: "About 3 minutes", words: "430–480 words", scenes: "24–30", min: 24, max: 30 },
};
export const MAX_VEO_SCENES = 8;

/**
 * Credits range for a movie before it's written (the exact render price shows on the post once the script exists):
 * the script, plus a picture per scene and the Veo clips at 6 seconds each on average.
 */
export function movieEstimate(length: MovieLength, veoScenes: number, engine?: AnimationEngine) {
  const s = MOVIE_SHAPE[length];
  const veo = Math.min(veoScenes, MAX_VEO_SCENES, s.max);
  const fixed = videoCredits(length, "plan") + videoCredits(length, "render");
  const at = (scenes: number, sec: number) => fixed + scenes * CREDIT_COST.aiImage + veo * sec * animationSecondCredits(engine);
  return { low: at(s.min, 4), high: at(s.max, 8) };
}

export const VIDEO_STYLES: Record<VideoPlan["style"], string> = {
  true: "True story",
  funny: "Funny history (real events, deadpan)",
  explainer: "How it works / explainer",
  countdown: "Countdown list (every item documented)",
  fiction: "Short fiction (labeled as fiction)",
};

export const VIDEO_TARGET: Record<Platform, string> = {
  x: "X video, vertical 9:16; caption under 200 characters",
  facebook: "Facebook Reel, vertical 9:16",
  linkedin: "LinkedIn native video, vertical 9:16, professional angle",
  instagram: "Instagram Reel, vertical 9:16",
  youtube: "YouTube Short, vertical 9:16 (long-form: 16:9)",
  tiktok: "TikTok, vertical 9:16",
  webhook: "Any app via webhook: text and links; attach finished video files in the receiving app",
};

/** Plain-text production plan for copy/export. */
export function videoPlanText(plan: VideoPlan, platformName: string, caption: string): string {
  return [
    `VIDEO PLAN — ${platformName} · ${VIDEO_LENGTHS[plan.length]?.label ?? ""} · ${VIDEO_STYLES[plan.style] ?? ""}`,
    "",
    "TITLE OPTIONS:",
    ...plan.titles.map((t, i) => `${i + 1}. ${t}`),
    "",
    `THUMBNAIL: "${plan.thumbnail?.text ?? ""}" — ${plan.thumbnail?.prompt ?? ""}`,
    `VOICE: ${plan.voice}`,
    `MUSIC & SOUND: ${plan.music}`,
    "",
    "SCENES:",
    ...plan.scenes.map((s, i) => `${i + 1}. [${s.time}] ${s.narration}\n   On screen: ${s.onScreen || "—"}\n   Visual: ${s.visual}\n   Edit: ${s.motion || "—"}${s.sfx ? `  ·  SFX: ${s.sfx}` : ""}`),
    "",
    plan.loopLine ? `LOOP LINE: ${plan.loopLine}\n` : "",
    "FULL NARRATION:",
    plan.scenes.map((s) => s.narration).join(" "),
    "",
    "CAPTION:",
    caption,
    "",
    plan.factCheck.length ? `VERIFY BEFORE POSTING:\n${plan.factCheck.map((x) => `- ${x}`).join("\n")}` : "",
  ].join("\n");
}

/** A finished example plan (used when Claude can't be reached). Every fact is documented. */
export const EXAMPLE_VIDEO = {
  titles: ["Australia Declared War on Emus — and Lost", "The Great Emu War of 1932", "The War Australia Lost to Birds"],
  hook: "In 1932, Australia declared war on birds.",
  caption: "In 1932, Australia sent soldiers with machine guns to fight emus. It did not go to plan.",
  hashtags: ["history", "funnyhistory", "emuwar", "australia", "didyouknow"],
  cta: "Follow for history's most ridiculous true stories.",
  thumbnail: { text: "AUSTRALIA 0 · EMUS 1", prompt: "Defiant emu staring down a vintage 1930s machine gun in a golden wheat field, bold high-contrast cinematic lighting, vertical 9:16, empty space at the top for text" },
  voice: "Deadpan documentary narrator, about 160 words per minute; a half-second pause before every punchline (\"The birds won.\").",
  music: "Serious, low orchestral military march that cuts to silence on each punchline; one light comedic sting on the final line.",
  scenes: [
    { time: "0:00–0:03", narration: "In 1932, Australia declared war on birds.", onScreen: "AUSTRALIA vs. EMUS", visual: "AI image: 1930s newspaper-style illustration of soldiers facing a crowd of emus, sepia tones", motion: "Fast push-in", sfx: "Single war-drum hit" },
    { time: "0:03–0:05", narration: "The birds won.", onScreen: "THE BIRDS WON", visual: "Stock: \"emu close up looking at camera\"", motion: "Hard cut, hold still", sfx: "Music cuts to silence" },
    { time: "0:05–0:11", narration: "After World War One, Australia gave ex-soldiers farmland in Western Australia to grow wheat.", onScreen: "Veterans → wheat farmers", visual: "Stock: \"vintage wheat farm 1930s\" (archival look)", motion: "Slow pan right", sfx: "" },
    { time: "0:11–0:16", narration: "Then around twenty thousand emus arrived — and started eating it.", onScreen: "≈20,000 EMUS", visual: "Stock: \"emu flock running across field\"", motion: "Zoom out to reveal the flock", sfx: "Low stampede rumble" },
    { time: "0:16–0:21", narration: "The farmers asked for help. The government sent soldiers. With machine guns.", onScreen: "+ 2 MACHINE GUNS", visual: "AI image: 1930s Australian soldiers with a Lewis gun on a truck beside a wheat field, sepia, no real person's likeness", motion: "Slow push-in, text pops on \"machine guns\"", sfx: "Metal cha-chunk" },
    { time: "0:21–0:27", narration: "The plan was simple. The emus did not cooperate.", onScreen: "THE PLAN: SIMPLE", visual: "Stock: \"emu running fast\"", motion: "Speed ramp", sfx: "Whoosh" },
    { time: "0:27–0:33", narration: "The moment the shooting started, they split into small groups — and emus can run around fifty kilometers an hour.", onScreen: "≈50 KM/H", visual: "Stock: \"emus scatter running\"", motion: "Whip pan between groups", sfx: "Quick footsteps" },
    { time: "0:33–0:38", narration: "During one ambush, a gun jammed after only a few birds were hit.", onScreen: "*JAMMED*", visual: "AI image: close-up of a jammed vintage machine gun, dramatic side light", motion: "Push-in, freeze frame", sfx: "Dull metal clunk" },
    { time: "0:38–0:45", narration: "After about a month, the soldiers were pulled out. Reports of how many emus died differ — and the farmers were still losing crops.", onScreen: "REPORTS DIFFER", visual: "AI image: empty wheat field at sunset with emu silhouettes on the horizon", motion: "Slow zoom out", sfx: "Music fades out" },
    { time: "0:45–0:50", narration: "So yes. In 1932, Australia went to war with birds…", onScreen: "AUSTRALIA 0 · EMUS 1", visual: "Stock: \"emu close up looking at camera\"", motion: "Slow push-in, cut on the last word", sfx: "Light comedic sting" },
  ],
  loopLine: "\"So yes. In 1932, Australia went to war with birds…\" loops straight into \"…The birds won.\"",
  factCheck: ["Dates: 2 November – 10 December 1932, Campion district, Western Australia", "Roughly 20,000 emus (contemporary estimate)", "Two Lewis guns and about 10,000 rounds under Major G. P. W. Meredith", "A gun jammed during an ambush", "Kill counts are disputed — keep \"reports differ\""],
  moneyAngle: "Education & Science carries the highest measured RPM; absurd true history gets rewatched and shared, and the loop ending boosts Shorts retention.",
};
