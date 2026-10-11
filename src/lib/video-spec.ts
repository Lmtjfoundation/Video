import type { Platform, VideoPlan } from "./types";

/** Video post options shared by the UI and the generator. */
export const VIDEO_LENGTHS: Record<VideoPlan["length"], { label: string; words: string; scenes: string; long: boolean }> = {
  s30: { label: "Short · 25–35 seconds", words: "65–90 words", scenes: "8–11", long: false },
  s60: { label: "Short · 45–58 seconds", words: "120–150 words", scenes: "12–16", long: false },
  s90: { label: "61–90 seconds (TikTok only pays over 1 minute)", words: "170–230 words", scenes: "16–22", long: false },
  long: { label: "Long-form · 8–10 minutes (YouTube)", words: "1,200–1,500 words", scenes: "40–60", long: true },
};

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
