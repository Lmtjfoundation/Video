import "server-only";
import { db } from "./db";
import { decrypt, encrypt } from "./crypto";
import { request } from "./platforms/http";
import type { Platform, Post } from "./types";

/**
 * Metricool as a connection hub: accounts the person already connected in Metricool (Facebook Page, Instagram,
 * X, LinkedIn, YouTube, TikTok) are used by Nexus Pulse without any developer setup. Posts are sent to Metricool's
 * scheduler API, which publishes them about two minutes later.
 *
 * Metricool's API needs the person's API token (Metricool → Account settings → API, Advanced or Custom plan),
 * their user ID and the brand ID (both appear in the address bar in Metricool: …?blogId=…&userId=…).
 */

/** METRICOOL_API_URL overrides the address (tests and local previews only). */
export const METRICOOL_API = (process.env.METRICOOL_API_URL || "https://app.metricool.com/api").replace(/\/$/, "");
export const MC_PLATFORMS = ["facebook", "instagram", "x", "linkedin", "youtube", "tiktok"] as const satisfies readonly Platform[];
export type McPlatform = (typeof MC_PLATFORMS)[number];
export const isMcPlatform = (p: Platform): p is McPlatform => (MC_PLATFORMS as readonly string[]).includes(p);

/** Metricool's network names for each platform. */
export const MC_NETWORK: Record<McPlatform, string> = { facebook: "facebook", instagram: "instagram", x: "twitter", linkedin: "linkedin", youtube: "youtube", tiktok: "tiktok" };

export interface MetricoolConn {
  token: string;
  userId: string;
  blogId: string;
  brand?: string;
  /** Accounts found connected in the Metricool brand. */
  found: McPlatform[];
  /** Which platforms Nexus Pulse posts to through Metricool. */
  use: Partial<Record<McPlatform, boolean>>;
  connectedAt: string;
  checkedAt: string;
}

/** What the browser may see (never the token). */
export interface MetricoolStatus {
  connected: boolean;
  brand?: string;
  blogId?: string;
  userId?: string;
  found: McPlatform[];
  use: Record<McPlatform, boolean>;
  checkedAt?: string;
}

/* ───────────── pure helpers (unit tested) ───────────── */

/** Finds blogId and userId in a pasted Metricool link (or "userId=…&blogId=…"). */
export function parseMetricoolIds(input: string): { userId?: string; blogId?: string } {
  const pick = (k: string) => input.match(new RegExp(`[?&#]?${k}=(\\d{3,15})`, "i"))?.[1];
  return { userId: pick("userId"), blogId: pick("blogId") };
}

const KEYS: Record<McPlatform, string[]> = {
  facebook: ["facebook", "facebookData", "facebookPageId", "facebookPage", "fbPage"],
  instagram: ["instagram", "instagramData", "instagramAccount", "instagramUsername"],
  x: ["twitter", "twitterData", "twitterAccount", "twitterUsername", "x"],
  linkedin: ["linkedin", "linkedinData", "linkedinCompany", "linkedInCompany", "linkedinProfile"],
  youtube: ["youtube", "youtubeData", "youtubeChannel", "youtubeChannelName"],
  tiktok: ["tiktok", "tiktokData", "tiktokAccount", "tiktokBusiness"],
};
const present = (v: unknown) =>
  (typeof v === "string" && v.trim() !== "" && v.trim().toLowerCase() !== "null") ||
  (typeof v === "number" && v > 0) ||
  (!!v && typeof v === "object" && Object.keys(v as object).length > 0);

/** Which networks a Metricool brand has connected. Reads flat fields and the nested `networksData` object. */
export function detectNetworks(brand: unknown): McPlatform[] {
  if (!brand || typeof brand !== "object") return [];
  const b = brand as Record<string, unknown>;
  const nested = [b.networksData, b.networks].filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
  return MC_PLATFORMS.filter((p) => KEYS[p].some((k) => present(b[k]) || nested.some((n) => present(n[k]))));
}

/** Local wall-clock time in `tz`, `minutes` from now, as Metricool expects: YYYY-MM-DDTHH:mm:ss. */
export function localDateTime(tz: string, minutes = 2, from = new Date()) {
  const d = new Date(from.getTime() + minutes * 60_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** The request body for Metricool's scheduler (one network per post, published in about two minutes). */
export function metricoolBody(p: McPlatform, post: Post, texts: string[], media: { url: string; video: boolean } | null, timezone: string) {
  const network = MC_NETWORK[p];
  const vertical = post.video?.length !== "long" && post.video?.length !== "m3";
  const body: Record<string, unknown> = {
    publicationDate: { dateTime: localDateTime(timezone), timezone },
    text: texts[0] ?? "",
    providers: [{ network }],
    autoPublish: true,
    draft: false,
    shortener: false,
    media: media ? [media.url] : [],
    // Metricool copies the file to its own storage, so the signed link only has to work for a few minutes.
    saveExternalMediaFiles: !!media,
    descendants: p === "x" ? texts.slice(1).map((text) => ({ text })) : [],
  };
  if (p === "x") body.twitterData = { tags: [] };
  if (p === "facebook") body.facebookData = { type: media?.video && vertical ? "REEL" : "POST" };
  if (p === "instagram") body.instagramData = { type: media?.video ? "REEL" : "POST", showReelOnFeed: true };
  if (p === "linkedin") body.linkedinData = { type: "post", previewIncluded: true };
  if (p === "youtube") body.youtubeData = { title: (post.video?.titles[0] ?? post.hook).replace(/[<>]/g, "").slice(0, 100), type: vertical ? "short" : "video", privacy: "public", madeForKids: false };
  if (p === "tiktok") body.tiktokData = { privacyOption: "PUBLIC_TO_EVERYONE", disableComment: false, disableDuet: false, disableStitch: false };
  return body;
}

/* ───────────── storage ───────────── */

const KEY = "metricool";

export async function getMetricool(): Promise<MetricoolConn | null> {
  const row = await db().get<{ id: string; value: { cipher: string } }>("kv", KEY);
  if (!row?.value?.cipher) return null;
  try {
    return JSON.parse(decrypt(row.value.cipher)) as MetricoolConn;
  } catch {
    return null;
  }
}

export async function saveMetricool(conn: MetricoolConn) {
  await db().upsert("kv", { id: KEY, value: { cipher: encrypt(JSON.stringify(conn)) } });
}

export async function clearMetricool() {
  await db().remove("kv", KEY);
}

export function metricoolStatus(conn: MetricoolConn | null): MetricoolStatus {
  const use = Object.fromEntries(MC_PLATFORMS.map((p) => [p, !!conn?.use[p]])) as Record<McPlatform, boolean>;
  if (!conn) return { connected: false, found: [], use };
  return { connected: true, brand: conn.brand, blogId: conn.blogId, userId: conn.userId, found: conn.found, use, checkedAt: conn.checkedAt };
}

/** The Metricool connection when this platform posts through it, else null. */
export async function metricoolFor(platform: Platform): Promise<MetricoolConn | null> {
  if (!isMcPlatform(platform)) return null;
  const conn = await getMetricool();
  return conn?.use[platform] ? conn : null;
}

/* ───────────── API ───────────── */

const headers = (token: string) => ({ "X-Mc-Auth": token, "Content-Type": "application/json", Accept: "application/json" });
const qs = (c: Pick<MetricoolConn, "userId" | "blogId">) => new URLSearchParams({ userId: c.userId, blogId: c.blogId }).toString();

export const PLAN_HINT = "Copy the token from Metricool → Account settings → API. Metricool only offers API access on its Advanced and Custom plans.";

/** Checks the token and IDs, and reads which accounts the brand has connected. */
export async function checkMetricool(input: { token: string; userId: string; blogId: string }) {
  let data: unknown;
  try {
    data = (await request<unknown>(`${METRICOOL_API}/admin/simpleProfiles?${qs(input)}`, { headers: headers(input.token), label: "Metricool" })).data;
  } catch (e) {
    const msg = (e as Error).message;
    if (/: (401|403) /.test(msg) || (e as Error).name === "AuthError") throw new Error(`Metricool didn't accept that token for this user ID. ${PLAN_HINT}`);
    throw new Error(`Couldn't reach Metricool: ${msg.slice(0, 200)}`);
  }
  const list = (Array.isArray(data) ? data : Array.isArray((data as { data?: unknown })?.data) ? (data as { data: unknown[] }).data : []) as Record<string, unknown>[];
  const brand = list.find((b) => String(b.id ?? b.blogId ?? "") === input.blogId);
  if (!brand) {
    const ids = list.slice(0, 5).map((b) => `${b.label ?? "brand"} (${b.id ?? b.blogId})`).join(", ");
    throw new Error(list.length ? `Brand ${input.blogId} isn't in this Metricool account. Brands found: ${ids}.` : "Metricool returned no brands for this account. Check the user ID.");
  }
  return { brand: typeof brand.label === "string" ? brand.label.trim() : undefined, found: detectNetworks(brand) };
}

/** Sends one post to Metricool's scheduler; Metricool publishes it about two minutes later. */
export async function metricoolPublish(conn: MetricoolConn, platform: McPlatform, post: Post, texts: string[], media: { url: string; video: boolean } | null, timezone: string) {
  const { data } = await request<{ data?: { id?: string | number; uuid?: string }; id?: string | number }>(`${METRICOOL_API}/v2/scheduler/posts?${qs(conn)}`, {
    method: "POST",
    headers: headers(conn.token),
    body: JSON.stringify(metricoolBody(platform, post, texts, media, timezone)),
    label: "Metricool",
  });
  const id = String(data?.data?.id ?? data?.data?.uuid ?? data?.id ?? post.id);
  return { externalId: `metricool:${id}`, externalIds: [`metricool:${id}`], url: undefined as string | undefined };
}
