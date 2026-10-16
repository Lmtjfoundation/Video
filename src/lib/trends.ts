import "server-only";
import { createHash } from "crypto";
import { gdb } from "./db";
import { FEEDS, GENRES, genreById, type Feed, type FeedTier } from "./genres";
import { nowIso } from "./utils";

/**
 * Trend Radar: reads live headlines from each genre's newsrooms (RSS/Atom feeds, plus Wikipedia's On This Day),
 * groups reports of the same event, and ranks stories by freshness and how many outlets are covering them.
 * Results are cached app-wide for 30 minutes so every subscriber shares one fetch.
 */

export interface TrendStory {
  id: string;
  genre: string;
  title: string;
  summary: string;
  link: string;
  source: string;
  tier: FeedTier;
  publishedAt: string;
  /** Other outlets reporting the same event (the first entry is the lead report). */
  coverage: { source: string; link: string }[];
  /** 0–100: freshness + how many newsrooms are on it. A ranking signal, not a view prediction. */
  heat: number;
}

export interface FeedHealth {
  ok: boolean;
  at: string;
  items: number;
  error?: string;
}

interface RawItem {
  title: string;
  link: string;
  summary: string;
  source: string;
  tier: FeedTier;
  publishedAt: number;
}

const TTL_MS = 30 * 60_000;
const MAX_AGE_MS = 72 * 3600_000;
const UA = `Mozilla/5.0 (compatible; NexusPulse/1.0; +${process.env.APP_URL || "https://nexus-pulse.app"})`;

/* ───────── parsing ───────── */

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…" };
const entities = (t: string) =>
  t
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
/** Text from a feed field: CDATA unwrapped, HTML removed, entities decoded (twice: feeds often escape their HTML). */
export function decode(s: string) {
  let t = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  for (let i = 0; i < 2; i++) t = entities(t.replace(/<[^>]+>/g, " "));
  return t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
const tag = (block: string, name: string) => block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? "";
const attr = (block: string, name: string, a: string) => block.match(new RegExp(`<${name}\\b[^>]*\\b${a}="([^"]+)"`, "i"))?.[1] ?? "";

/** Parses RSS 2.0 and Atom. Google News items carry the outlet in <source>, which becomes the item's source. */
export function parseFeed(xml: string, feed: Pick<Feed, "name" | "tier">): RawItem[] {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  const out: RawItem[] = [];
  for (const b of blocks) {
    const outlet = decode(tag(b, "source"));
    let title = decode(tag(b, "title"));
    if (outlet && title.endsWith(` - ${outlet}`)) title = title.slice(0, -(outlet.length + 3));
    const link = decode(tag(b, "link")) || attr(b, "link", "href") || decode(tag(b, "guid"));
    const when = decode(tag(b, "pubDate") || tag(b, "dc:date") || tag(b, "published") || tag(b, "updated"));
    const ts = Date.parse(when);
    let summary = decode(tag(b, "description") || tag(b, "summary") || tag(b, "content:encoded") || tag(b, "content"));
    if (summary.startsWith(title)) summary = summary.slice(title.length).trim();
    if (!title || !/^https?:\/\//.test(link)) continue;
    out.push({ title: title.slice(0, 300), link, summary: summary.slice(0, 600), source: outlet || feed.name, tier: feed.tier, publishedAt: Number.isFinite(ts) ? ts : Date.now() });
  }
  return out;
}

/** Wikipedia's On This Day events for today's date (UTC), as story items. */
export function parseOnThisDay(json: unknown, feed: Pick<Feed, "name" | "tier">): RawItem[] {
  const events = ((json as { events?: unknown[] })?.events ?? []) as { text?: string; year?: number; pages?: { titles?: { normalized?: string }; content_urls?: { desktop?: { page?: string } }; extract?: string }[] }[];
  return events
    .filter((e) => e.text && e.year && e.pages?.[0]?.content_urls?.desktop?.page)
    .map((e, i) => ({
      title: `${e.year}: ${e.text!.trim()}`,
      link: e.pages![0].content_urls!.desktop!.page!,
      summary: (e.pages![0].extract ?? "").slice(0, 600),
      source: feed.name,
      tier: feed.tier,
      // Keep Wikipedia's order (it lists the most notable first) while treating them all as today's.
      publishedAt: Date.now() - i * 60_000,
    }));
}

/* ───────── fetching ───────── */

async function fetchText(url: string, accept: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: accept }, signal: ctrl.signal, redirect: "follow", cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return text.slice(0, 3_000_000);
  } finally {
    clearTimeout(timer);
  }
}

async function readFeed(feed: Feed): Promise<RawItem[]> {
  if (feed.kind === "json-onthisday") {
    const d = new Date();
    const url = `${feed.url}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
    return parseOnThisDay(JSON.parse(await fetchText(url, "application/json")), feed);
  }
  return parseFeed(await fetchText(feed.url, "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5"), feed);
}

/* ───────── admin-added feeds ───────── */

export interface CustomFeed extends Feed {
  genre: string;
}
export async function customFeeds(): Promise<CustomFeed[]> {
  const row = await gdb().get<{ id: string; value?: CustomFeed[] }>("kv", "trend_custom_feeds");
  return Array.isArray(row?.value) ? row.value : [];
}
export async function saveCustomFeeds(list: CustomFeed[]) {
  await gdb().upsert("kv", { id: "trend_custom_feeds", value: list.slice(0, 100) });
  for (const g of GENRES) await gdb().upsert("kv", { id: `trends_${g.id}`, value: null }); // refresh caches
}

export async function feedsFor(genreId: string): Promise<Feed[]> {
  const g = genreById(genreId);
  if (!g) return [];
  const extra = (await customFeeds()).filter((f) => f.genre === genreId);
  return [...g.feeds.map((id) => FEEDS[id]).filter(Boolean), ...extra];
}

/* ───────── ranking ───────── */

const STOP = new Set("the a an and or but of to in on for with at by from as is are was were be been has have had it its this that these those after over into about says say said new will would could than more amid after before what why how who when where your you our their his her they them not no yes up out off".split(" "));
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
function similar(a: Set<string>, b: Set<string>) {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}
const TIER_BONUS: Record<FeedTier, number> = { wire: 10, public: 9, national: 7, black_press: 9, specialist: 6, reference: 4 };

/** Groups reports of the same event and scores each story by freshness, coverage and source tier. */
export function rankStories(items: RawItem[], genre: string, now = Date.now()): TrendStory[] {
  const fresh = items.filter((i) => now - i.publishedAt < MAX_AGE_MS).sort((a, b) => b.publishedAt - a.publishedAt);
  const clusters: { lead: RawItem; tokens: Set<string>; members: RawItem[] }[] = [];
  for (const it of fresh) {
    const t = words(it.title);
    const hit = t.size >= 3 ? clusters.find((c) => similar(c.tokens, t) >= 0.34) : undefined;
    if (hit) {
      if (!hit.members.some((m) => m.source === it.source)) hit.members.push(it);
    } else clusters.push({ lead: it, tokens: t, members: [it] });
  }
  return clusters
    .map(({ lead, members }) => {
      // Prefer the most authoritative outlet's version as the lead report.
      const best = [...members].sort((a, b) => TIER_BONUS[b.tier] - TIER_BONUS[a.tier] || b.publishedAt - a.publishedAt)[0] ?? lead;
      const ageH = (now - Math.max(...members.map((m) => m.publishedAt))) / 3600_000;
      const recency = Math.max(0, 1 - ageH / 48);
      const heat = Math.min(100, Math.round(recency * 45 + (members.length - 1) * 14 + TIER_BONUS[best.tier] * 1.5));
      return {
        id: createHash("sha1").update(best.link).digest("hex").slice(0, 16),
        genre,
        title: best.title,
        summary: best.summary || members.find((m) => m.summary)?.summary || "",
        link: best.link,
        source: best.source,
        tier: best.tier,
        publishedAt: new Date(best.publishedAt).toISOString(),
        coverage: [best, ...members.filter((m) => m !== best)].slice(0, 8).map((m) => ({ source: m.source, link: m.link })),
        heat,
      };
    })
    .sort((a, b) => b.heat - a.heat)
    .slice(0, 40);
}

/* ───────── public API ───────── */

async function recordHealth(results: Record<string, FeedHealth>) {
  const row = await gdb().get<{ id: string; value?: Record<string, FeedHealth> }>("kv", "trend_feed_health");
  await gdb().upsert("kv", { id: "trend_feed_health", value: { ...(row?.value ?? {}), ...results } });
}
export async function feedHealth(): Promise<Record<string, FeedHealth>> {
  const row = await gdb().get<{ id: string; value?: Record<string, FeedHealth> }>("kv", "trend_feed_health");
  return row?.value ?? {};
}

/** Live stories for one genre (cached 30 minutes app-wide). Evergreen genres return []. */
export async function getTrends(genreId: string, opts: { force?: boolean } = {}): Promise<{ stories: TrendStory[]; fetchedAt: string | null }> {
  const g = genreById(genreId);
  if (!g) return { stories: [], fetchedAt: null };
  const key = `trends_${genreId}`;
  const cached = await gdb().get<{ id: string; value?: { at: string; stories: TrendStory[] } | null }>("kv", key);
  // Fresh cache; an empty result (every feed down) is retried after 5 minutes instead of 30.
  const ttl = cached?.value?.stories?.length ? TTL_MS : 5 * 60_000;
  if (!opts.force && cached?.value && Date.now() - Date.parse(cached.value.at) < ttl) return { stories: cached.value.stories, fetchedAt: cached.value.at };

  const feeds = await feedsFor(genreId);
  if (!feeds.length) return { stories: [], fetchedAt: null };
  const health: Record<string, FeedHealth> = {};
  const all: RawItem[] = [];
  await Promise.all(
    feeds.map(async (f) => {
      try {
        const items = await readFeed(f);
        all.push(...items);
        health[f.id] = { ok: items.length > 0, at: nowIso(), items: items.length, ...(items.length ? {} : { error: "No items in the feed" }) };
      } catch (e) {
        const err = e as Error & { cause?: { code?: string } };
        health[f.id] = { ok: false, at: nowIso(), items: 0, error: err.name === "AbortError" ? "Timed out" : `${err.message}${err.cause?.code ? ` (${err.cause.code})` : ""}`.slice(0, 120) };
      }
    }),
  );
  await recordHealth(health);
  const stories = rankStories(all, genreId);
  // Keep the last good result if every feed failed this time.
  if (!stories.length && cached?.value?.stories?.length) return { stories: cached.value.stories, fetchedAt: cached.value.at };
  const at = nowIso();
  await gdb().upsert("kv", { id: key, value: { at, stories } });
  return { stories, fetchedAt: at };
}

export async function findStory(genreId: string, id: string) {
  return (await getTrends(genreId)).stories.find((s) => s.id === id) ?? null;
}

/** A few of today's biggest headlines, used to give evergreen genres a timely angle. */
export async function todaysHeadlines(n = 6) {
  try {
    return (await getTrends("trending")).stories.slice(0, n);
  } catch {
    return [];
  }
}
