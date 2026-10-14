import "server-only";
import { claudeJson, type ImageInput } from "./llm";
import { PERSONALITY_LOCK, PILLAR_BRIEF } from "./personality";
import { NICHES, QUALITY_BAR, STORY_FORMATS, STORY_TYPES, TT_US_RPM, nicheTable } from "./niches";
import { PLATFORM_SPECS } from "./platforms/specs";
import { db } from "./db";
import { readFile } from "./media";
import { finalizePost } from "./generate";
import type { MediaItem, NicheReport, Pillar, Platform, Post, Settings, Story } from "./types";
import { FORMATS, PILLARS } from "./types";
import { nowIso, uid } from "./utils";

/* ───────────── Niche research ───────────── */

export async function researchNiches(input: NicheReport["input"], recentTitles: string[]): Promise<NicheReport> {
  const user = `You are a revenue-focused niche strategist for FACELESS story-driven channels (narration + visuals, no on-camera creator).
Use ONLY the RPM figures in this sourced table; never invent revenue numbers. Where you reason beyond the table (competition, audience demand), say it's your judgment.
SOURCED NICHE DATA (YouTube long-form RPM per 1,000 views, creator's share; TikTok Creator Rewards ≈ $${TT_US_RPM}/1,000 qualified US views × niche multiplier, videos over 1 minute only):
${nicheTable()}

CREATOR INPUT
- Interests / knowledge: ${input.interests || "(none given — pick the strongest overall)"}
- Main platform: ${input.platform}
- Time per week: ${input.hours}
- Goal: ${input.goal}
${recentTitles.length ? `- Already produced: ${recentTitles.slice(0, 8).join("; ")}` : ""}

${input.interests ? "" : "NO INTERESTS GIVEN: rank the highest-earning niches overall (highest measured RPM first, among niches that work faceless).\n"}${QUALITY_BAR}

TASK: Rank the 4 best niche + sub-niche choices for this creator by expected revenue × feasibility for faceless story content. Include a "funny history" style sub-niche or idea set when it fits the data. Prefer specific sub-niches (e.g. "aviation disaster investigations", not "transport"). For each, give 6 story ideas that would genuinely hold attention: specific, curiosity-driven, and honest (true stories must be real, documented events; fiction must be labeled fiction). Include a monetization stack beyond ads (affiliate categories, sponsor types, digital products) and real risks (policy, accuracy, saturation).
Reply with ONLY JSON:
{"summary":"2-3 sentences","niches":[{"name":"sub-niche name","dataNiche":"exact niche name from the table","whyItEarns":"…","rpmBasis":"quote the table figures used","competition":"low|medium|high (judgment)","facelessFormat":"…","audience":"…","storyIdeas":[{"title":"specific event + year","hook":"first 3 seconds — the most surprising true fact","type":"true|funny|explainer|fiction"}],"monetization":["…"],"risks":["…"],"first30Days":["…","…","…"]}]}`;
  const r = await claudeJson<{ summary?: string; niches?: NicheReport["niches"] }>({ system: PERSONALITY_LOCK, user, maxTokens: 6000, temperature: 0.6 });
  if (!Array.isArray(r.niches) || !r.niches.length) throw new Error("The research came back empty. Try again.");
  const rep: NicheReport = { id: uid("rep"), createdAt: nowIso(), input, summary: String(r.summary ?? ""), niches: r.niches.slice(0, 5) };
  await db().upsert("reports", rep);
  return rep;
}

/* ───────────── Story scripts ───────────── */

export interface StoryInput {
  niche: string;
  customNiche?: string;
  topic?: string;
  type: Story["type"];
  format: Story["format"];
  tone: string;
  voice: string;
  /** Text of the user's uploaded notes / research / transcripts */
  sources?: { name: string; text: string }[];
  /** Media-library image ids to use as visual references */
  mediaIds?: string[];
}

const TYPE_RULES: Record<Story["type"], string> = {
  true: "TRUE STORY: use only well-documented facts. No invented quotes, names, numbers or dialogue. If a detail is uncertain, say so in the narration ('reports differ…'). List every factual claim a creator should verify in factCheck.",
  funny: "FUNNY HISTORY: a real, documented event that was genuinely absurd. The humor comes from the facts, told deadpan with sharp timing — no invented jokes, quotes, names or numbers, no memes, no mocking victims. Same accuracy rules as a true story; list every claim to verify in factCheck.",
  explainer: "EXPLAINER: mechanisms must be accurate; illustrate with clearly hypothetical examples; list claims to verify in factCheck.",
  fiction: 'FICTION: an original made-up story. Set "label" to "Fiction" and say it\'s fiction in the description. Never present it as real, never use real private people, no real brands defamed.',
};

async function loadImages(ids: string[] = []): Promise<{ images: ImageInput[]; names: string[] }> {
  const images: ImageInput[] = [];
  const names: string[] = [];
  for (const id of ids.slice(0, 3)) {
    const m = await db().get<MediaItem>("media", id);
    if (!m || m.kind !== "image" || m.size > 5 * 1024 * 1024) continue;
    const bytes = await readFile(m).catch(() => null);
    if (!bytes) continue;
    images.push({ mediaType: m.type as ImageInput["mediaType"], base64: bytes.toString("base64") });
    names.push(m.name);
  }
  return { images, names };
}

export async function writeStory(input: StoryInput, opts: { model?: string } = {}): Promise<Story> {
  const fmt = STORY_FORMATS[input.format];
  const niche = NICHES.find((n) => n.id === input.niche);
  const texts = (input.sources ?? []).map((x) => `--- ${x.name} ---\n${x.text}`).join("\n\n").slice(0, 24_000);
  const { images, names } = await loadImages(input.mediaIds);

  const user = `Write a FACELESS ${fmt.label} story script (narration over visuals; no on-camera person).
NICHE: ${niche ? `${niche.name} (YouTube median RPM $${niche.rpm}; strong formats: ${niche.formats})` : input.customNiche || "general"}
TOPIC / IDEA: ${input.topic || "Choose the most gripping, high-retention idea for this niche."}
TONE: ${input.tone}. NARRATOR: ${input.voice}.
${QUALITY_BAR}
${TYPE_RULES[input.type]}
LENGTH: narration totals ${fmt.words} across ${fmt.scenes} scenes. ${fmt.note}
RETENTION CRAFT: open a curiosity loop in the first 3 seconds and pay it off at the end; concrete details over adjectives; one surprise per scene; no filler intros ("in this video…"), no "smash that like button".
VISUALS: for each scene give a stock-footage search phrase or an AI image prompt (no real people's likeness), plus on-screen text (max 6 words). Remind the creator to label realistic AI visuals where platforms require it.
${texts ? `USER-PROVIDED SOURCE MATERIAL — prefer facts from here; for true stories don't add facts beyond it and general well-established knowledge:\n${texts}` : ""}
${images.length ? "The attached image(s) are the creator's visual references; describe how to use them in the scenes." : ""}
MONETIZATION: suggest where an affiliate or sponsor mention fits naturally (or "none" if it would hurt trust).
Reply with ONLY JSON:
{"label":"","titles":[{"title":"…","why":"why it gets clicks"}],"hook":"…","scenes":[{"time":"0:00","narration":"…","onScreen":"…","visual":"…","audio":"music/sfx cue"}],"ending":"…","cta":"…","description":"…","tags":["…"],"thumbnailText":["…"],"pinnedComment":"…","factCheck":["…"],"monetization":"…","runtimeSec":55}`;

  const out = await claudeJson<Story["out"]>({
    system: PERSONALITY_LOCK,
    user,
    images,
    model: opts.model,
    maxTokens: input.format === "long" ? 9000 : 3500,
    temperature: 0.8,
  });
  if (!Array.isArray(out.scenes) || !out.scenes.length) throw new Error("The script came back incomplete. Try again.");
  const story: Story = {
    id: uid("story"),
    createdAt: nowIso(),
    niche: niche?.name ?? input.customNiche ?? "General",
    format: input.format,
    type: input.type,
    topic: input.topic ?? "",
    sources: [...(input.sources ?? []).map((x) => x.name), ...names],
    out,
  };
  await db().upsert("stories", story);
  return story;
}

export const storyNarration = (st: Story) => st.out.scenes.map((s) => s.narration).filter(Boolean).join("\n\n");

export function storyText(st: Story) {
  const o = st.out;
  return [
    `# ${o.titles?.[0]?.title ?? st.topic}`,
    o.label ? `(${o.label})` : "",
    "",
    `Niche: ${st.niche} · ${STORY_FORMATS[st.format].label} · ${STORY_TYPES[st.type]}`,
    "",
    "## Title options",
    ...(o.titles ?? []).map((t) => `- ${t.title} — ${t.why ?? ""}`),
    "",
    `## Hook\n${o.hook ?? ""}`,
    "",
    "## Scenes",
    ...o.scenes.map((s) => (s.heading ? `[${s.time ?? ""}] ${s.heading}\n${s.narration}` : `[${s.time ?? ""}] ${s.narration}\n  On screen: ${s.onScreen ?? "—"}\n  Visual: ${s.visual ?? "—"}\n  Audio: ${s.audio ?? "—"}`)),
    "",
    `## Ending\n${o.ending ?? ""}`,
    `\n## CTA\n${o.cta ?? ""}`,
    `\n## Description\n${o.description ?? ""}`,
    `\nTags: ${(o.tags ?? []).join(", ")}`,
    `Thumbnail text: ${(o.thumbnailText ?? []).join(" | ")}`,
    `Pinned comment: ${o.pinnedComment ?? ""}`,
    "",
    "## Verify before publishing",
    ...(o.factCheck ?? []).map((x) => `- ${x}`),
    "",
    `Monetization: ${o.monetization ?? ""}`,
  ].join("\n");
}

const pillarFor = (niche: string): Pillar =>
  /financ|business|money/i.test(niche) ? "wealth_systems" : /tech|ai/i.test(niche) ? "ai_leverage" : /health|sport/i.test(niche) ? "longevity" : "high_agency";

export function storyToPost(st: Story, settings: Settings): Post {
  const o = st.out;
  const platform = STORY_FORMATS[st.format].platform;
  const t = nowIso();
  const post: Post = {
    id: uid("post"),
    platform,
    pillar: pillarFor(st.niche),
    format: "video_script",
    topic: st.topic,
    hook: o.titles?.[0]?.title ?? o.hook ?? st.topic,
    body: o.description ?? "",
    parts: o.scenes.map((s) => s.narration).filter(Boolean),
    hashtags: (o.tags ?? []).slice(0, PLATFORM_SPECS[platform].maxHashtags),
    cta: o.cta,
    offerId: null,
    moneyAngle: o.monetization,
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

/* ───────────── Repurpose: one source → native posts for each platform ───────────── */

export async function repurpose(sourceText: string, platforms: Platform[], settings: Settings): Promise<Post[]> {
  const user = `Repurpose this source into ONE native post for EACH platform listed. Each must feel written for that platform, not copy-pasted: different hook, length and structure that fit the platform's rules. Keep every fact from the source accurate; don't add new facts.

SOURCE:
"""${sourceText.slice(0, 12_000)}"""

PLATFORMS AND RULES:
${platforms.map((p) => `- ${p}: ${PLATFORM_SPECS[p].writingRules} Allowed formats: ${PLATFORM_SPECS[p].formats.join(", ")}.`).join("\n")}

PILLARS you may tag: ${PILLARS.map((p) => `${p} (${PILLAR_BRIEF[p].split(":")[0]})`).join("; ")}.
Reply with ONLY JSON: {"posts":[{"platform":"x","pillar":"…","format":"…","hook":"…","body":"…","parts":[],"hashtags":[],"cta":"…","moneyAngle":"…"}]}`;
  const r = await claudeJson<{ posts?: (Partial<Post> & { platform: Platform })[] }>({ system: PERSONALITY_LOCK, user, maxTokens: 1500 * platforms.length + 500, temperature: 0.75 });
  const t = nowIso();
  return (r.posts ?? [])
    .filter((d) => d && platforms.includes(d.platform) && d.hook)
    .map((d) => {
      const spec = PLATFORM_SPECS[d.platform];
      const fmt = FORMATS.includes(d.format as Post["format"]) && spec.formats.includes(d.format as Post["format"]) ? (d.format as Post["format"]) : spec.formats[0];
      const post: Post = {
        id: uid("post"),
        platform: d.platform,
        pillar: PILLARS.includes(d.pillar as Pillar) ? (d.pillar as Pillar) : "wealth_systems",
        format: fmt,
        hook: String(d.hook).trim(),
        body: String(d.body ?? "").trim(),
        parts: (d.parts ?? []).map(String).filter(Boolean),
        hashtags: (d.hashtags ?? []).map(String).slice(0, spec.maxHashtags),
        cta: d.cta ? String(d.cta) : undefined,
        offerId: null,
        moneyAngle: d.moneyAngle ? String(d.moneyAngle) : undefined,
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
    });
}
