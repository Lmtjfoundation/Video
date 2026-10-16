import type { Credential } from "./types";

/**
 * Facebook personal profiles, including monetized profiles in professional mode.
 *
 * Meta's Graph API publishes to Pages only (personal-profile publishing was removed in 2018), so no app can post to
 * a profile by itself. A profile connection therefore works as a handoff: at the scheduled time Nexus Pulse prepares
 * the post (HD video or image plus caption), lets the person know, and they post it from their phone with one tap.
 */

export const isProfileCred = (c: Pick<Credential, "mode"> | null | undefined) => c?.mode === "profile";

const FB_HOST = /^(?:www\.|m\.|web\.|mbasic\.|business\.)?(?:facebook\.com|fb\.com)$/i;
const RESERVED = new Set([
  "home.php", "login", "login.php", "pages", "groups", "watch", "reel", "reels", "marketplace", "events", "gaming",
  "settings", "help", "policies", "privacy", "story.php", "share", "sharer", "sharer.php", "photo.php", "permalink.php",
  "profile", "people", "messages", "notifications", "friends", "search", "hashtag", "business", "ads", "bookmarks",
]);

/**
 * Accepts a profile link the way people copy it (with or without https://, www., m., a trailing slash or tracking
 * parameters) and returns a clean https://www.facebook.com/… link, or null when it isn't a Facebook profile link.
 */
export function normalizeProfileUrl(input: string): string | null {
  let raw = input.trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!FB_HOST.test(u.hostname)) return null;
  const path = u.pathname.replace(/\/+$/, "");
  if (/^\/profile\.php$/i.test(path)) {
    const id = u.searchParams.get("id");
    return id && /^\d{5,25}$/.test(id) ? `https://www.facebook.com/profile.php?id=${id}` : null;
  }
  // "Copy link" on a profile in the Facebook app gives a short share link: facebook.com/share/AbC123xyZ/
  const share = path.match(/^\/share\/([A-Za-z0-9_-]{6,40})$/);
  if (share) return `https://www.facebook.com/share/${share[1]}/`;
  const people = path.match(/^\/people\/([^/]{1,100})\/(\d{5,25})$/i);
  if (people) return `https://www.facebook.com/people/${people[1]}/${people[2]}`;
  const name = path.match(/^\/([A-Za-z0-9.]{5,50})$/)?.[1];
  if (!name || RESERVED.has(name.toLowerCase())) return null;
  return `https://www.facebook.com/${name}`;
}

/** Display name for the profile: 1–80 characters, spaces collapsed. */
export function cleanProfileName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const n = input.replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim();
  return n.length >= 1 && n.length <= 80 ? n : null;
}

const POST_HOST = /^(?:www\.|m\.|web\.|mbasic\.)?(?:facebook\.com|fb\.com|fb\.watch)$/i;

/** The link to a post the person made by hand (optional when they mark it posted). Facebook links only. */
export function normalizePostLink(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let raw = input.trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!POST_HOST.test(u.hostname) || u.pathname.length < 2) return null;
  u.protocol = "https:";
  const out = u.toString();
  return out.length <= 500 ? out : null;
}
