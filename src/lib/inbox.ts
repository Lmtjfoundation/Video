import "server-only";
import { asUser } from "./db";
import { listUsers, type User } from "./auth";
import { toPost, type Draft } from "./generate";
import { videoPost, type RawVideo } from "./video";
import { NICHES } from "./niches";
import { getSettings, kvGet, kvSet, log, savePosts } from "./repo";
import { lengthAllowed, VIDEO_LENGTHS, VIDEO_STYLES } from "./video-spec";
import type { Platform, Post, Settings, VideoPlan } from "./types";
import { PLATFORMS } from "./types";

/**
 * Content inbox.
 * A scheduled Claude cloud session writes batches of finished posts and video plans to a JSON file on a
 * separate GitHub branch. Every 15 minutes the app reads that file and imports anything new as drafts
 * in the owner's account. No Claude API key or API credits are involved on the app's side.
 *
 * Each batch can also carry a `bank`: extra finished pieces that are NOT shown as drafts. They are kept in
 * reserve, and when Claude's API can't write (no credits), the Generate button hands them out instead.
 *
 * CONTENT_INBOX_URL   — raw JSON URL (defaults to the nexus-pulse-content branch below)
 * CONTENT_INBOX_OWNER — email of the account that receives the drafts (defaults to the first admin)
 * CONTENT_INBOX=off   — turns the importer off
 */
export const DEFAULT_INBOX_URL = "https://raw.githubusercontent.com/Lmtjfoundation/Video/nexus-pulse-content/inbox.json";

const DONE_KEY = "inbox_imported";
const BANK_KEY = "inbox_bank";
const MAX_PER_RUN = 60;
const BANK_MAX = 80;

interface BankEntry {
  id: string;
  platform: Platform;
  type: "post" | "video";
  addedAt: string;
  item: InboxPost;
}

interface InboxPost {
  id?: unknown;
  type?: unknown;
  platform?: unknown;
  pillar?: unknown;
  format?: unknown;
  topic?: unknown;
  hook?: unknown;
  body?: unknown;
  parts?: unknown;
  hashtags?: unknown;
  cta?: unknown;
  moneyAngle?: unknown;
  // video fields
  niche?: unknown;
  style?: unknown;
  length?: unknown;
  titles?: unknown;
  caption?: unknown;
  thumbnail?: unknown;
  voice?: unknown;
  music?: unknown;
  scenes?: unknown;
  loopLine?: unknown;
  factCheck?: unknown;
}

interface Inbox {
  batches?: { id?: unknown; items?: unknown; bank?: unknown }[];
}

export interface InboxResult {
  imported: number;
  banked?: number;
  skipped: number;
  errors: string[];
  owner?: string;
  note?: string;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strList = (v: unknown, maxItems: number, maxLen: number) =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, maxItems).map((x) => (x as string).trim().slice(0, maxLen)) : [];

function asPlatform(v: unknown): Platform | null {
  const p = str(v, 20).toLowerCase().replace("twitter", "x");
  return (PLATFORMS as readonly string[]).includes(p) ? (p as Platform) : null;
}

async function ownerAccount(): Promise<User | null> {
  const users = (await listUsers()).filter((u) => u.status === "active");
  const wanted = (process.env.CONTENT_INBOX_OWNER ?? "").trim().toLowerCase();
  if (wanted) return users.find((u) => u.email.toLowerCase() === wanted) ?? null;
  return users.filter((u) => u.role === "admin").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null;
}

function buildPost(item: InboxPost, settings: Settings): Post {
  const platform = asPlatform(item.platform);
  if (!platform) throw new Error(`unknown platform "${String(item.platform)}"`);

  if (item.type === "video") {
    const scenes = Array.isArray(item.scenes) ? item.scenes.filter((s) => s && typeof s === "object").slice(0, 80) : [];
    if (!scenes.length) throw new Error("video has no scenes");
    let length = str(item.length, 10) as VideoPlan["length"];
    if (!(length in VIDEO_LENGTHS)) length = "s60";
    if (!lengthAllowed(length, platform)) length = "s60";
    let style = str(item.style, 20) as VideoPlan["style"];
    if (!(style in VIDEO_STYLES)) style = "explainer";
    const nicheIn = str(item.niche, 40);
    const niche = NICHES.some((n) => n.id === nicheIn) ? nicheIn : "finance";
    const thumb = item.thumbnail && typeof item.thumbnail === "object" ? (item.thumbnail as { text?: unknown; prompt?: unknown }) : {};
    const raw: RawVideo = {
      titles: strList(item.titles, 3, 120),
      hook: str(item.hook, 300),
      caption: str(item.caption, 2200),
      hashtags: strList(item.hashtags, 10, 60).map((h) => h.replace(/^#/, "")),
      cta: str(item.cta, 300) || undefined,
      thumbnail: { text: str(thumb.text, 60), prompt: str(thumb.prompt, 600) },
      voice: str(item.voice, 600),
      music: str(item.music, 600),
      scenes: scenes.map((s) => {
        const o = s as Record<string, unknown>;
        return {
          time: str(o.time, 20), narration: str(o.narration, 1500), onScreen: str(o.onScreen, 120),
          visual: str(o.visual, 800), motion: str(o.motion, 300), sfx: str(o.sfx, 200),
        };
      }),
      loopLine: str(item.loopLine, 400),
      factCheck: strList(item.factCheck, 30, 400),
      moneyAngle: str(item.moneyAngle, 400),
    };
    if (!raw.titles?.length && !raw.hook) throw new Error("video has no title or hook");
    const post = videoPost(raw, { platform, niche, style, length, topic: str(item.topic, 200) || undefined }, settings);
    post.source = "claude-batch";
    return post;
  }

  const hook = str(item.hook, 600);
  if (!hook) throw new Error("post has no hook");
  const draft: Draft = {
    pillar: str(item.pillar, 30),
    format: str(item.format, 30),
    topic: str(item.topic, 200) || undefined,
    hook,
    body: str(item.body, 12000),
    parts: strList(item.parts, 40, 3000),
    hashtags: strList(item.hashtags, 30, 60).map((h) => h.replace(/^#/, "")),
    cta: str(item.cta, 300) || undefined,
    offerId: null,
    moneyAngle: str(item.moneyAngle, 400) || undefined,
  };
  const post = toPost(draft, platform, settings, { status: "draft" });
  post.source = "claude-batch";
  return post;
}

/** Reads the inbox file and imports new items as drafts in the owner's account. Safe to call often. */
export async function importInbox(): Promise<InboxResult> {
  if ((process.env.CONTENT_INBOX ?? "").toLowerCase() === "off") return { imported: 0, skipped: 0, errors: [], note: "Content inbox is turned off." };
  const url = process.env.CONTENT_INBOX_URL || DEFAULT_INBOX_URL;

  let inbox: Inbox;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store", signal: ctrl.signal });
    clearTimeout(timer);
    if (res.status === 404) return { imported: 0, skipped: 0, errors: [], note: "No inbox file yet." };
    if (!res.ok) return { imported: 0, skipped: 0, errors: [`Inbox fetch returned ${res.status}`] };
    inbox = (await res.json()) as Inbox;
  } catch (e) {
    return { imported: 0, skipped: 0, errors: [`Inbox fetch failed: ${(e as Error).message}`] };
  }

  const items: InboxPost[] = [];
  const bankItems: InboxPost[] = [];
  for (const b of Array.isArray(inbox?.batches) ? inbox.batches : []) {
    if (Array.isArray(b?.items)) for (const it of b.items) if (it && typeof it === "object") items.push(it as InboxPost);
    if (Array.isArray(b?.bank)) for (const it of b.bank) if (it && typeof it === "object") bankItems.push(it as InboxPost);
  }
  if (!items.length && !bankItems.length) return { imported: 0, skipped: 0, errors: [], note: "Inbox is empty." };

  const owner = await ownerAccount();
  if (!owner) return { imported: 0, skipped: 0, errors: ["No active admin account to import into."] };

  return asUser(owner.id, async () => {
    const done = new Set((await kvGet<string[]>(DONE_KEY)) ?? []);
    const fresh = items.filter((it) => str(it.id, 120) && !done.has(str(it.id, 120))).slice(0, MAX_PER_RUN);
    const freshBank = bankItems.filter((it) => str(it.id, 120) && !done.has(str(it.id, 120))).slice(0, MAX_PER_RUN);
    if (!fresh.length && !freshBank.length) return { imported: 0, skipped: 0, errors: [], owner: owner.email };

    const settings = await getSettings();
    const posts: Post[] = [];
    const errors: string[] = [];

    // Reserve pieces: check they build, then keep the raw item for the Generate button.
    let banked = 0;
    if (freshBank.length) {
      const bank = (await kvGet<BankEntry[]>(BANK_KEY)) ?? [];
      for (const it of freshBank) {
        const id = str(it.id, 120);
        try {
          buildPost(it, settings); // validation only
          bank.push({ id, platform: asPlatform(it.platform)!, type: it.type === "video" ? "video" : "post", addedAt: new Date().toISOString(), item: it });
          banked++;
        } catch (e) {
          errors.push(`${id}: ${(e as Error).message}`);
        }
        done.add(id);
      }
      await kvSet(BANK_KEY, bank.slice(-BANK_MAX));
    }

    for (const it of fresh) {
      const id = str(it.id, 120);
      try {
        posts.push(buildPost(it, settings));
      } catch (e) {
        errors.push(`${id}: ${(e as Error).message}`);
      }
      done.add(id); // a broken item is skipped once, not retried every 15 minutes
    }
    if (posts.length) await savePosts(posts);
    await kvSet(DONE_KEY, [...done].slice(-3000));
    const videos = posts.filter((p) => p.kind === "video").length;
    await log(errors.length ? "warn" : "info", "generate",
      `Imported ${posts.length} draft${posts.length === 1 ? "" : "s"} written by Claude (${posts.length - videos} posts, ${videos} video plans)` +
        `${banked ? `; ${banked} more kept in reserve for the Generate button` : ""}${errors.length ? `; ${errors.length} skipped` : ""}`,
      { errors: errors.slice(0, 20) });
    return { imported: posts.length, banked, skipped: errors.length, errors, owner: owner.email };
  });
}

/** How many reserve pieces are left, per platform and kind. Runs in the current user's scope. */
export async function bankCounts() {
  const bank = (await kvGet<BankEntry[]>(BANK_KEY)) ?? [];
  const counts: Partial<Record<Platform, { text: number; video: number }>> = {};
  for (const e of bank) {
    const c = (counts[e.platform] ??= { text: 0, video: 0 });
    if (e.type === "video") c.video++;
    else c.text++;
  }
  return counts;
}

/**
 * Takes up to `count` reserve pieces for a platform (newest first) and turns them into drafts.
 * Runs in the current user's scope, so only the account that receives the daily batch has a bank.
 */
export async function takeFromBank(platform: Platform, kind: "text" | "video", count: number, settings: Settings): Promise<Post[]> {
  const bank = (await kvGet<BankEntry[]>(BANK_KEY)) ?? [];
  const want = kind === "video" ? "video" : "post";
  const picked: BankEntry[] = [];
  for (let i = bank.length - 1; i >= 0 && picked.length < count; i--) {
    if (bank[i].platform === platform && bank[i].type === want) picked.push(bank[i]);
  }
  if (!picked.length) return [];
  const posts: Post[] = [];
  for (const e of picked) {
    try {
      posts.push(buildPost(e.item, settings));
    } catch {
      /* skip a piece that no longer builds */
    }
  }
  const used = new Set(picked.map((e) => e.id));
  await kvSet(BANK_KEY, bank.filter((e) => !used.has(e.id)));
  return posts;
}
