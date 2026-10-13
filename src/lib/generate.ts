import "server-only";
import { claudeJson } from "./llm";
import { MATURE_X_ADDON, PERSONALITY_LOCK, PILLAR_BRIEF } from "./personality";
import { complianceFlags } from "./compliance";
import { PLATFORM_SPECS } from "./platforms/specs";
import { renderPost } from "./compose";
import { checkOutput } from "./safety";
import { scorePost } from "./scoring";
import { listPosts } from "./repo";
import type { Format, Pillar, Platform, Post, Settings } from "./types";
import { FORMATS, PILLARS } from "./types";
import { nowIso, uid } from "./utils";

export interface Draft {
  pillar: string;
  format: string;
  topic?: string;
  hook: string;
  body?: string;
  parts?: string[];
  hashtags?: string[];
  cta?: string;
  offerId?: string | null;
  moneyAngle?: string;
}

function offersBlock(settings: Settings) {
  if (!settings.offers.length) return "No affiliate offers configured — set offerId to null and monetize through saves, follows and email-list CTAs.";
  return (
    "Available offers (attach an offerId ONLY when the post genuinely relates to it; no more than 1 in 3 posts should carry an offer so the feed stays trustworthy):\n" +
    settings.offers.map((o) => `- id=${o.id} | ${o.name} | pillar=${o.pillar} | ${o.notes ?? ""}`).join("\n")
  );
}

async function recentHooks(platform: Platform, n = 30) {
  const posts = await listPosts();
  return posts.filter((p) => p.platform === platform).slice(0, n).map((p) => p.hook);
}

/** Weighted pillar rotation from Settings → pillar mix. Deterministic for a given seed. */
export function pickPillars(n: number, mix: Record<Pillar, number>, seed = 0): Pillar[] {
  const total = PILLARS.reduce((s, p) => s + Math.max(0, mix[p] ?? 0), 0) || 1;
  const out: Pillar[] = [];
  let x = (seed * 9301 + 49297) % 233280;
  for (let i = 0; i < n; i++) {
    x = (x * 9301 + 49297) % 233280;
    let r = (x / 233280) * total;
    let chosen: Pillar = PILLARS[0];
    for (const p of PILLARS) {
      r -= Math.max(0, mix[p] ?? 0);
      if (r <= 0) {
        chosen = p;
        break;
      }
    }
    // Avoid back-to-back repeats where possible.
    if (out.length && out[out.length - 1] === chosen) {
      chosen = PILLARS[(PILLARS.indexOf(chosen) + 1) % PILLARS.length];
    }
    out.push(chosen);
  }
  return out;
}

export function toPost(d: Draft, platform: Platform, settings: Settings, base?: Partial<Post>): Post {
  const spec = PLATFORM_SPECS[platform];
  const pillar = (PILLARS as readonly string[]).includes(d.pillar) ? (d.pillar as Pillar) : base?.pillar ?? "wealth_systems";
  let format = (FORMATS as readonly string[]).includes(d.format) ? (d.format as Format) : base?.format ?? spec.formats[0];
  if (!spec.formats.includes(format)) format = spec.formats[0];
  const offerId = d.offerId && settings.offers.some((o) => o.id === d.offerId) ? d.offerId : null;
  const t = nowIso();

  const post: Post = {
    id: base?.id ?? uid("post"),
    platform,
    pillar,
    format,
    topic: d.topic?.trim(),
    hook: (d.hook ?? "").trim(),
    body: (d.body ?? "").trim(),
    parts: (d.parts ?? []).map((p) => String(p).trim()).filter(Boolean),
    hashtags: (d.hashtags ?? []).map(String).slice(0, spec.maxHashtags),
    cta: d.cta?.trim() || undefined,
    offerId,
    moneyAngle: d.moneyAngle?.trim(),
    imageUrl: base?.imageUrl,
    mediaIds: base?.mediaIds,
    mature: base?.mature,
    status: base?.status ?? "draft",
    scheduledAt: base?.scheduledAt,
    moneyScore: 0,
    revenue: { low: 0, high: 0, basis: "" },
    scoreNotes: [],
    safetyFlags: [],
    attempts: 0,
    createdAt: base?.createdAt ?? t,
    updatedAt: t,
  };
  return finalizePost(post, settings);
}

/** Re-runs safety + scoring. Call after any edit. */
export function finalizePost(post: Post, settings: Settings): Post {
  const spec = PLATFORM_SPECS[post.platform];
  const texts = renderPost(post, settings);
  const allowedUrls = settings.offers.map((o) => o.url);
  const flags = new Set<string>();
  const perPart = post.platform === "x" ? 280 : spec.maxChars;
  for (const t of texts) {
    checkOutput(t, post.platform, { allowedUrls, perPartLimit: perPart }).flags.forEach((f) => flags.add(f));
  }
  // Script beats / slides aren't always in the rendered text — scan them too (no length check).
  checkOutput(post.parts.join("\n"), post.platform, { allowedUrls, perPartLimit: 100_000 }).flags.forEach((f) => flags.add(f));
  complianceFlags(post, settings).forEach((f) => flags.add(f));
  post.safetyFlags = [...flags];
  const s = scorePost(post, settings);
  post.moneyScore = s.score;
  post.scoreNotes = s.notes;
  post.revenue = s.revenue;
  return post;
}

export async function generatePosts(
  opts: { platform: Platform; count: number; pillars?: Pillar[]; format?: Format; topic?: string; mature?: boolean },
  settings: Settings,
): Promise<Post[]> {
  const mature = !!opts.mature && opts.platform === "x" && settings.matureX;
  const spec = PLATFORM_SPECS[opts.platform];
  const pillars = opts.pillars?.length ? opts.pillars : pickPillars(opts.count, settings.pillarMix, Date.now() % 997);
  const recent = await recentHooks(opts.platform);

  const user = `Write ${opts.count} distinct ${spec.name} posts.

PLATFORM RULES
${spec.writingRules}
Allowed formats: ${spec.formats.join(", ")}${opts.format ? ` (use "${opts.format}" for all posts)` : " (pick the best format per idea)"}.

PILLARS — one post per entry, in this order:
${pillars.map((p, i) => `${i + 1}. ${p}: ${PILLAR_BRIEF[p]}`).join("\n")}
${opts.topic ? `\nFOCUS TOPIC (apply to every post): ${opts.topic}` : ""}
${settings.brandVoiceNotes ? `\nCREATOR NOTES: ${settings.brandVoiceNotes}` : ""}

DO NOT REPEAT these recent hooks or their ideas:
${recent.length ? recent.map((h) => `- ${h}`).join("\n") : "- (none yet)"}

MONETIZATION
${offersBlock(settings)}
Pick the strongest money angle for each post: topics advertisers pay for, content people save and share, natural product fit, CTAs that grow an email list or followers. Never sound salesy.

OUTPUT — JSON only:
{"posts":[{"pillar":"wealth_systems","format":"short","topic":"…","hook":"…","body":"…","parts":[],"hashtags":["…"],"cta":"…","offerId":null,"moneyAngle":"one sentence on how this post earns"}]}
Field rules: "hook" is the first line / headline / title. "body" is the rest of the post (for threads and scripts it may be a 1–2 sentence description). "parts" holds thread posts, carousel slides, or script beats; otherwise []. Hashtags without "#". Never write the offer URL or a disclosure — the app adds both.`;

  const system = mature ? `${PERSONALITY_LOCK}\n\n${MATURE_X_ADDON}` : PERSONALITY_LOCK;
  const res = await claudeJson<{ posts: Draft[] }>({ system, user, maxTokens: 1200 * opts.count + 800 });
  return (res.posts ?? [])
    .filter((d) => d?.hook)
    .slice(0, opts.count)
    .map((d) => toPost(d, opts.platform, settings, mature ? { mature: true } : undefined));
}

/** One-click "Maximize Money Potential" rewrite. Keeps id, schedule and image. */
export async function maximizeMoney(post: Post, settings: Settings): Promise<Post> {
  const spec = PLATFORM_SPECS[post.platform];
  const user = `Rewrite this ${spec.name} post to maximize money potential while staying honest and on-voice.

CURRENT POST (JSON):
${JSON.stringify({ pillar: post.pillar, format: post.format, topic: post.topic, hook: post.hook, body: post.body, parts: post.parts, hashtags: post.hashtags, cta: post.cta, offerId: post.offerId })}

PLATFORM RULES
${spec.writingRules}

LEVERS (use the ones that fit, don't force all):
- Shift the angle toward the highest-advertiser-demand framing of the same idea (money, careers, business tools, measurable outcomes).
- Sharpen the hook with tension or a specific number the body pays off.
- Make it more saveable/shareable (a framework, checklist, or steps).
- Add a CTA that builds an owned audience (save, follow, reply with a keyword, join the newsletter).
- ${settings.offers.length ? "Attach the best-fitting offer via offerId if — and only if — it genuinely helps the reader." : "No offers are configured; tease a lead magnet or newsletter instead."}
- Suggest brand-deal fit in moneyAngle (which kind of sponsor would buy this slot).

${offersBlock(settings)}

Return JSON only, same shape:
{"pillar":"…","format":"…","topic":"…","hook":"…","body":"…","parts":[],"hashtags":[],"cta":"…","offerId":null,"moneyAngle":"…"}
Never write the offer URL or disclosure — the app adds both.`;

  const system = post.mature && post.platform === "x" && settings.matureX ? `${PERSONALITY_LOCK}\n\n${MATURE_X_ADDON}` : PERSONALITY_LOCK;
  const d = await claudeJson<Draft>({ system, user, maxTokens: 2500, temperature: 0.7 });
  const next = toPost({ ...d, format: d.format || post.format }, post.platform, settings, post);
  next.status = post.status === "failed" ? "draft" : post.status;
  next.attempts = 0;
  return next;
}
