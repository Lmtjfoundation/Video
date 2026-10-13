import "server-only";
import { claudeJson } from "./llm";
import { NICHES, QUALITY_BAR } from "./niches";
import { PLATFORM_SPECS } from "./platforms/specs";
import { finalizePost, pickPillars } from "./generate";
import { listPosts } from "./repo";
import { VIDEO_LENGTHS, VIDEO_STYLES, VIDEO_TARGET } from "./video-spec";
import type { Platform, Post, Settings, VideoPlan, VideoScene } from "./types";
import { nowIso, uid } from "./utils";

const STYLE_RULES: Record<VideoPlan["style"], string> = {
  true: 'TRUE STORY: documented facts only. No invented quotes, names, numbers or dialogue. Uncertain details are narrated as "reports differ".',
  funny: "FUNNY HISTORY: a real, documented event that was genuinely absurd. The facts are the joke — deadpan delivery, a beat of silence before each punchline. No invented jokes, quotes or numbers, no memes, never mock victims.",
  explainer: "EXPLAINER: accurate mechanism, one surprising 'aha' per scene, concrete examples clearly marked as examples.",
  countdown: "COUNTDOWN: 5 items, each a specific documented fact; save the strongest for #1; one sentence of payoff per item.",
  fiction: 'FICTION: an original story, labeled "Fiction" in the caption; never presented as real; no real private people.',
};

export interface RawVideo {
  titles?: string[];
  hook?: string;
  caption?: string;
  hashtags?: string[];
  cta?: string;
  thumbnail?: { text?: string; prompt?: string };
  voice?: string;
  music?: string;
  scenes?: Partial<VideoScene>[];
  loopLine?: string;
  factCheck?: string[];
  moneyAngle?: string;
}

export interface VideoOptions {
  platform: Platform;
  count: number;
  niche: string;
  style: VideoPlan["style"];
  length: VideoPlan["length"];
  topic?: string;
  mediaIds?: string[];
}

export async function generateVideoPosts(o: VideoOptions, settings: Settings): Promise<Post[]> {
  const fmt = VIDEO_LENGTHS[o.length];
  const n = NICHES.find((x) => x.id === o.niche);
  const recent = (await listPosts()).filter((p) => p.platform === o.platform).slice(0, 25).map((p) => `- ${p.hook}`);
  const spec = PLATFORM_SPECS[o.platform];
  const user = `Write ${o.count} distinct, production-ready video${o.count > 1 ? "s" : ""} — the best-performing quality possible, not a draft.
PLATFORM: ${VIDEO_TARGET[o.platform]}.
NICHE: ${n ? `${n.name} (measured YouTube median RPM $${n.rpm}; formats that work: ${n.formats})` : "highest-earning fit for the topic"}.
STYLE: ${VIDEO_STYLES[o.style]}. ${STYLE_RULES[o.style]}
LENGTH: ${fmt.label}; narration totals ${fmt.words} across ${fmt.scenes} scenes${fmt.long ? "; re-hook every 30–60 seconds and build to a payoff" : fmt.tier === "mid" ? "; vertical 9:16; a new visual every 3–5 seconds; re-hook every 30–45 seconds with a new question or reveal, and save the biggest payoff for the last 20 seconds" : "; a new visual every 2–4 seconds"}.
${o.topic ? `TOPIC: ${o.topic}` : "TOPIC: choose the most attention-grabbing, high-earning, documented story for this niche."}
${QUALITY_BAR}
PRODUCTION CRAFT:
- 0–2 s: spoken hook + matching visual hook + on-screen text. No intro, no "in this video", no greeting, no logo.
- Every scene: what is said, what is on screen (≤6 words, punchy), exactly what is shown (a stock-footage search phrase or a detailed cinematic AI image/video prompt — no real person's likeness, no logos), the camera move or edit, and a sound effect where it adds punch.
- Pattern interrupt about every 3 seconds (cut, zoom, speed ramp, text pop, sound hit). Open a curiosity loop early and pay it off at the end.
- Voice: natural, confident narrator; give pace and where to pause. Music: genre, energy and where it drops out.
- Short videos end on a line that loops cleanly back into the hook. Never "like and subscribe" filler; one specific CTA.
- Caption: written for ${spec.name}; ${o.platform === "x" ? "under 200 characters" : o.platform === "youtube" ? "a YouTube description of 2–3 lines" : "hook first line, 1–3 short lines"}; 3–5 relevant hashtags without "#".
${settings.brandVoiceNotes ? `CREATOR NOTES: ${settings.brandVoiceNotes}\n` : ""}DO NOT repeat these recent hooks:
${recent.length ? recent.join("\n") : "- (none yet)"}
Reply with ONLY JSON:
{"videos":[{"titles":["3 options, strongest first, under 70 characters"],"hook":"first spoken line","caption":"…","hashtags":["…"],"cta":"…","thumbnail":{"text":"2–4 words","prompt":"…"},"voice":"…","music":"…","scenes":[{"time":"0:00–0:02","narration":"…","onScreen":"…","visual":"…","motion":"…","sfx":""}],"loopLine":"…","factCheck":["every factual claim to verify"],"moneyAngle":"how this video earns"}]}`;

  const res = await claudeJson<{ videos?: RawVideo[] }>({
    system: "You are a top faceless-video producer and scriptwriter. You only use documented facts, you never pad, and every line earns its place.",
    user,
    maxTokens: (fmt.long ? 9000 : fmt.tier === "mid" ? 6500 : 3500) * o.count,
    temperature: 0.7,
  });
  const list = (res.videos ?? []).filter((v) => Array.isArray(v?.scenes) && v.scenes!.length).slice(0, o.count);
  if (!list.length) throw new Error("The video plan came back empty. Try again.");
  return list.map((v) => videoPost(v, o, settings));
}

export function videoPost(v: RawVideo, o: Pick<VideoOptions, "platform" | "niche" | "style" | "length" | "topic" | "mediaIds">, settings: Settings): Post {
  const spec = PLATFORM_SPECS[o.platform];
  const scenes: VideoScene[] = (v.scenes ?? []).map((s) => ({
    time: String(s.time ?? ""), narration: String(s.narration ?? ""), onScreen: String(s.onScreen ?? ""),
    visual: String(s.visual ?? ""), motion: String(s.motion ?? ""), sfx: String(s.sfx ?? ""),
  }));
  const video: VideoPlan = {
    niche: o.niche, style: o.style, length: o.length, topic: o.topic,
    titles: (v.titles ?? []).map(String).slice(0, 3), thumbnail: v.thumbnail ?? {}, voice: String(v.voice ?? ""),
    music: String(v.music ?? ""), scenes, loopLine: String(v.loopLine ?? ""), factCheck: (v.factCheck ?? []).map(String),
  };
  const t = nowIso();
  const post: Post = {
    id: uid("post"),
    platform: o.platform,
    pillar: pickPillars(1, settings.pillarMix, Date.now() % 997)[0],
    format: "video_script",
    kind: "video",
    video,
    topic: o.topic,
    hook: (video.titles[0] ?? v.hook ?? "").trim(),
    body: String(v.caption ?? "").trim(),
    parts: scenes.map((s) => `[${s.time}] ${s.narration}`),
    hashtags: (v.hashtags ?? []).map(String).slice(0, spec.maxHashtags),
    cta: v.cta?.trim() || undefined,
    offerId: null,
    moneyAngle: v.moneyAngle?.trim(),
    mediaIds: o.mediaIds,
    status: "draft",
    moneyScore: 0,
    revenue: { low: 0, high: 0, basis: "" },
    scoreNotes: [],
    safetyFlags: [],
    attempts: 0,
    createdAt: t,
    updatedAt: t,
  };
  return finalizePost(post, settings);
}
