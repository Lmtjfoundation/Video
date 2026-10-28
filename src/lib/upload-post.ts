import "server-only";
import { currentUserId } from "./db";
import { pick } from "./integrations";
import { AuthError, CopyReadyError, RateLimitError } from "./platforms/http";
import { kvGet, kvSet } from "./repo";
import type { Platform, Post } from "./types";

/**
 * Upload-Post (upload-post.com): a social posting service whose apps are already approved by Instagram, Facebook,
 * TikTok, YouTube, LinkedIn and X. With its key saved once (Admin → Integrations), every Ghost Post user connects a
 * network with one tap: Ghost Post asks Upload-Post for that network's sign-in page, the person signs in there, and
 * comes straight back. No developer apps, testers or app reviews on the owner's side.
 *
 * Each Ghost Post user has one Upload-Post profile ("gp_<user id>") that holds one account per network.
 */
export const UP_PLATFORMS = ["instagram", "facebook", "tiktok", "youtube", "linkedin", "x"] as const satisfies readonly Platform[];
export type UpPlatform = (typeof UP_PLATFORMS)[number];
export const isUpPlatform = (p: string): p is UpPlatform => (UP_PLATFORMS as readonly string[]).includes(p);

const base = () => (process.env.UPLOAD_POST_API_URL || "https://api.upload-post.com").replace(/\/+$/, "");
export const uploadPostKey = () => pick("uploadPostKey", "UPLOAD_POST_API_KEY");
export const uploadPostReady = async () => !!(await uploadPostKey());

export class UploadPostError extends Error {}

/** The profile name for the signed-in user (letters, numbers and underscores only). */
export function profileName(userId = currentUserId()) {
  if (!userId) throw new UploadPostError("No signed-in user.");
  return `gp_${userId.replace(/[^A-Za-z0-9_]/g, "_")}`.slice(0, 64);
}

type Json = Record<string, unknown>;

async function call<T = Json>(path: string, init: RequestInit & { form?: FormData } = {}): Promise<{ status: number; body: T }> {
  const key = await uploadPostKey();
  if (!key) throw new UploadPostError("The social connect service isn't set up. The owner adds the Upload-Post key in Admin → App settings → Integrations.");
  const headers: Record<string, string> = { Authorization: `Apikey ${key}`, ...((init.headers as Record<string, string>) ?? {}) };
  if (init.body && !init.form) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, { ...init, body: init.form ?? init.body, headers, signal: AbortSignal.timeout(120_000), cache: "no-store" });
  } catch (e) {
    throw new UploadPostError(`The social connect service didn't answer (${(e as Error).message}). Try again in a minute.`);
  }
  const body = (await res.json().catch(() => ({}))) as T;
  if (res.status === 401) throw new AuthError("The Upload-Post key was refused. Check it in Admin → App settings → Integrations.");
  if (res.status === 429) throw new RateLimitError("The social connect service asked us to slow down.", 60);
  return { status: res.status, body };
}

const message = (b: Json) => String(b.message ?? b.error ?? b.detail ?? "").slice(0, 300);

/** Creates the user's profile the first time (a profile that already exists is fine). */
export async function ensureProfile(displayName?: string) {
  const name = profileName();
  if ((await kvGet<string>("upload-post-profile")) === name) return name;
  const { status, body } = await call("/api/uploadposts/users", { method: "POST", body: JSON.stringify({ username: name, ...(displayName ? { display_name: displayName.slice(0, 100) } : {}) }) });
  if (status === 403) throw new UploadPostError("Ghost Post's social connect service is full. The owner can add more profiles in Upload-Post (upload-post.com → Plans).");
  if (status !== 201 && status !== 200 && status !== 409) throw new UploadPostError(`The social connect service couldn't set up your profile: ${message(body as Json) || status}`);
  await kvSet("upload-post-profile", name);
  return name;
}

/** The address of `platform`'s own sign-in page for this user. They come back to `redirectUrl`. */
export async function startConnect(platform: UpPlatform, redirectUrl: string, displayName?: string) {
  const profile = await ensureProfile(displayName);
  const { status, body } = await call<{ authorize_url?: string; error_code?: string; message?: string }>(`/api/uploadposts/oauth/${platform}/start`, {
    method: "POST",
    body: JSON.stringify({ profile, redirect_url: redirectUrl }),
  });
  if (!body.authorize_url) throw new UploadPostError(`Couldn't start the ${platform} sign-in (${body.error_code ?? status}). ${message(body as Json)}`.trim());
  forget();
  return body.authorize_url;
}

/** What Upload-Post's return address says about a connect attempt, in plain words. */
export function connectOutcome(q: URLSearchParams): { ok: boolean; message?: string } {
  const status = q.get("connect_status");
  if (status === "success") return { ok: true };
  const code = q.get("error_code") ?? "";
  if (status === "cancelled" || code === "ACCESS_DENIED") return { ok: false, message: "The sign-in was cancelled." };
  const why: Record<string, string> = {
    PROVIDER_ERROR: "the network had a problem. Try again in a minute",
    INVALID_STATE: "the sign-in took too long. Try again",
    CONNECTION_FAILED: "the account couldn't be linked. Try again",
  };
  return { ok: false, message: `It didn't connect: ${why[code] ?? "something went wrong. Try again"}.` };
}

export type UpAccount = { platform: UpPlatform; handle?: string; image?: string };
const cache = new Map<string, { at: number; accounts: UpAccount[] }>();
const forget = () => cache.delete(profileName());
/** Ask Upload-Post again next time (after a connect). */
export const forgetAccounts = forget;

/** The networks connected in this user's profile (asked at most once a minute). */
export async function connectedAccounts(): Promise<UpAccount[]> {
  if (!(await uploadPostReady())) return [];
  let name: string;
  try {
    name = profileName();
  } catch {
    return [];
  }
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < 60_000) return hit.accounts;
  if ((await kvGet<string>("upload-post-profile")) !== name) return [];
  try {
    const { status, body } = await call<{ profile?: { social_accounts?: Record<string, unknown> } }>(`/api/uploadposts/users/${encodeURIComponent(name)}`);
    if (status !== 200) return hit?.accounts ?? [];
    const accounts: UpAccount[] = [];
    for (const [k, v] of Object.entries(body.profile?.social_accounts ?? {})) {
      const p = k === "twitter" ? "x" : k;
      if (!isUpPlatform(p) || !v || typeof v !== "object") continue; // "" = added but not connected
      const a = v as { display_name?: string; username?: string; social_images?: string };
      accounts.push({ platform: p, handle: a.username ? `@${a.username.replace(/^@/, "")}` : a.display_name, image: a.social_images });
    }
    cache.set(name, { at: Date.now(), accounts });
    return accounts;
  } catch {
    return hit?.accounts ?? [];
  }
}

export async function disconnect(platform: UpPlatform) {
  const name = profileName();
  await call("/api/uploadposts/users/social", { method: "DELETE", body: JSON.stringify({ profile_username: name, social_platform: platform }) });
  forget();
}

/** Admin → Integrations → Test: the plan and how many customer profiles are in use. */
export async function testUploadPost(): Promise<{ ok: boolean; message: string }> {
  try {
    const { status, body } = await call<{ plan?: string; limit?: number; profiles?: unknown[] }>("/api/uploadposts/users");
    if (status !== 200) return { ok: false, message: `Upload-Post answered ${status}: ${message(body as Json)}` };
    return { ok: true, message: `Connected to Upload-Post (${body.plan ?? "plan unknown"} plan): ${body.profiles?.length ?? 0} of ${body.limit ?? "?"} customer profiles in use. Every network now connects with one tap.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/* ---------------- Publishing ---------------- */

export type UpMedia = { video?: { url: string }; images?: string[] };

/** The form Upload-Post's upload endpoints take. Pure, for tests. */
export function uploadForm(platform: UpPlatform, post: Post, texts: string[], media: UpMedia, profile: string, facebookPageId?: string) {
  const f = new FormData();
  const caption = texts.join("\n\n").slice(0, 5000);
  f.append("user", profile);
  f.append("platform[]", platform);
  f.append("title", caption);
  f.append("async_upload", "true");
  f.append("external_id", post.id);
  const story = post.placement === "story";
  if (platform === "youtube") {
    f.append("youtube_title", (post.hook || caption).replace(/\s+/g, " ").slice(0, 100));
    f.append("description", caption);
    f.append("privacyStatus", "public");
  }
  if (platform === "linkedin" || platform === "facebook") f.append("description", caption);
  if (platform === "instagram" && media.video) f.append("media_type", story ? "STORIES" : "REELS");
  if (platform === "facebook") {
    if (media.video) f.append("facebook_media_type", story ? "STORIES" : post.video?.length === "long" ? "VIDEO" : "REELS");
    if (facebookPageId) f.append("facebook_page_id", facebookPageId);
  }
  if (platform === "tiktok") f.append("privacy_level", "PUBLIC_TO_EVERYONE");
  if (media.video) {
    f.append("video", media.video.url);
    return { path: "/api/upload", form: f };
  }
  if (media.images?.length) {
    for (const u of media.images.slice(0, 10)) f.append("photos[]", u);
    return { path: "/api/upload_photos", form: f };
  }
  if (platform === "instagram" || platform === "tiktok" || platform === "youtube") {
    throw new CopyReadyError(`${platform === "youtube" ? "YouTube" : platform === "tiktok" ? "TikTok" : "Instagram"} needs a picture or video with the post.`);
  }
  return { path: "/api/upload_text", form: f };
}

type UpResult = { success?: boolean; url?: string; post_url?: string; error?: string; message?: string; platform?: string; status?: string };

/** One platform's result from either response shape (an object keyed by platform, or a list). */
function resultFor(platform: string, results: unknown): UpResult | undefined {
  if (Array.isArray(results)) return (results as UpResult[]).find((r) => r.platform === platform || (platform === "x" && r.platform === "twitter"));
  if (results && typeof results === "object") return (results as Record<string, UpResult>)[platform];
  return undefined;
}

/** Sends the post. Returns at once; the post's link arrives later (checkSent). */
export async function publishViaUploadPost(platform: UpPlatform, post: Post, texts: string[], media: UpMedia) {
  const profile = profileName();
  let page = platform === "facebook" ? ((await kvGet<string>("upload-post-facebook-page")) ?? undefined) : undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { path, form } = uploadForm(platform, post, texts, media, profile, page);
    const { status, body } = await call<Json & { request_id?: string; results?: unknown; available_pages?: { id?: string; page_id?: string }[] }>(path, {
      method: "POST",
      form,
      headers: { "Idempotency-Key": `${post.id}-${post.attempts ?? 0}` },
    });
    // Several Facebook Pages and none chosen: the first one, remembered (the Facebook card can change it).
    if (platform === "facebook" && !page && body.available_pages?.length) {
      page = String(body.available_pages[0].id ?? body.available_pages[0].page_id ?? "");
      if (page) {
        await kvSet("upload-post-facebook-page", page);
        continue;
      }
    }
    if (status >= 400 || body.success === false) {
      const text = message(body);
      if (/not connected|no .*account|reconnect|expired/i.test(text)) throw new AuthError(`${text} Reconnect it on the Platforms tab.`);
      if (/limit|quota|cap/i.test(text) && status === 429) throw new RateLimitError(text, 3600);
      throw new UploadPostError(text || `Upload-Post answered ${status}.`);
    }
    const r = resultFor(platform, body.results);
    if (r && r.success === false) throw new UploadPostError(r.error || r.message || "The network refused the post.");
    const id = String(body.request_id ?? post.id);
    return { externalId: `upload-post:${id}`, externalIds: [`upload-post:${id}`], url: r?.url ?? r?.post_url };
  }
  throw new UploadPostError("Choose which Facebook Page to post to on the Platforms tab.");
}

/**
 * For a post sent earlier: done (with its link), failed (with the reason), or still going. Never throws, so a slow
 * service can't hold up the scheduler.
 */
export async function checkSent(post: Post): Promise<{ state: "done" | "failed" | "pending"; url?: string; error?: string }> {
  const id = post.externalId?.replace(/^upload-post:/, "");
  if (!id) return { state: "done" };
  try {
    const { status, body } = await call<{ status?: string; results?: unknown; error?: string }>(`/api/uploadposts/status?request_id=${encodeURIComponent(id)}`);
    if (status === 404) return { state: "done" };
    const r = resultFor(post.platform, body.results);
    if (r?.success === false || r?.status === "failed" || body.status === "failed") return { state: "failed", error: r?.error || r?.message || body.error || "The network refused the post." };
    if (body.status === "completed" || r?.status === "completed" || r?.url || r?.post_url) return { state: "done", url: r?.url ?? r?.post_url };
    return { state: "pending" };
  } catch {
    return { state: "pending" };
  }
}
