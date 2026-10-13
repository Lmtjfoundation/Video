import type { Platform, Post, Settings } from "./types";

/**
 * Platform rules engine — keeps accounts in good standing.
 * Returns flags: "block:*" stops publishing, "warn:*" is shown for review.
 * Sources: each platform's published rules (X Adult Content policy, X Creator Monetization Standards,
 * Meta/LinkedIn/TikTok/YouTube community guidelines). Rules change; review them periodically.
 */
export interface RuleHint {
  platform: Platform;
  rules: string[];
}

export const PLATFORM_RULES: Record<Platform, string[]> = {
  x: [
    "Adult (18+) content is allowed only with a content warning: turn on “Mark media you post as having material that may be sensitive” in X settings.",
    "Never put adult content in your profile photo, header, Lists, Communities or live video.",
    "Sexual or overly suggestive content earns less: X restricts it from creator monetization.",
    "Don't post identical or near-identical posts repeatedly; X treats it as spam.",
    "Automated accounts should be labeled as automated in X settings.",
  ],
  facebook: [
    "No adult nudity or sexual content; sexually suggestive posts get reduced distribution and can't be monetized.",
    "Posts go to Pages you manage; engagement bait (“comment YES if…”) is demoted.",
    "Disclose paid partnerships with the branded-content tool.",
  ],
  instagram: [
    "No nudity or sexual content; suggestive posts may be hidden from Explore and Reels recommendations.",
    "Links in captions aren't clickable — use your bio link.",
    "3–5 relevant hashtags work best; repeated identical hashtag blocks look spammy.",
  ],
  linkedin: [
    "Professional context only — sexual or suggestive content is removed.",
    "Too many posts in a short time reduces reach; 1–2 a day is plenty.",
  ],
  youtube: [
    "Sexual content and nudity are removed or age-restricted, and age-restricted videos earn little or no ad revenue.",
    "Label realistic AI-generated or altered visuals when you upload.",
    "Reused or mass-produced content without added value can lose monetization.",
  ],
  tiktok: [
    "No nudity or sexual activity; suggestive content is made ineligible for the For You feed.",
    "Label AI-generated content that shows realistic scenes or people.",
    "Creator Rewards only pays for original videos over 1 minute.",
  ],
  webhook: [
    "The app that receives the webhook is subject to its own platform rules; check them in that app.",
    "Posts sent here are checked by the same safety filter as every other platform.",
  ],
};

const norm = (s: string) => s.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Static checks that need only the post and settings. */
export function complianceFlags(post: Post, settings: Settings): string[] {
  const f: string[] = [];
  if (post.mature) {
    if (post.platform !== "x") f.push(`block:mature_not_allowed_on_${post.platform}`);
    else if (!settings.matureX) f.push("block:mature_mode_off");
    else if (!settings.xSensitiveConfirmed) f.push("block:x_sensitive_setting_not_confirmed");
    else f.push("warn:mature_needs_manual_publish");
  }
  const text = [post.hook, post.body, ...post.parts].join("\n");
  if (post.platform === "instagram" && /https?:\/\//.test(text)) f.push("warn:instagram_links_not_clickable");
  if (/\b(comment|type)\s+(yes|amen|1)\b|\btag\s+\d+\s+friends\b|\blike if\b/i.test(text)) f.push("warn:engagement_bait");
  if (post.platform === "tiktok" && post.format === "video_script" && !["s90", "m3"].includes(post.video?.length ?? "")) f.push("warn:tiktok_rewards_need_over_1_minute");
  return f;
}

/** Recent-history checks (duplicates, burst posting). `history` = this user's posts. */
export function historyFlags(post: Post, history: Post[]): string[] {
  const f: string[] = [];
  const week = Date.now() - 7 * 86400_000;
  const mine = norm([post.hook, post.body].join(" "));
  const dup = history.some(
    (h) => h.id !== post.id && h.platform === post.platform && h.status === "published" && new Date(h.publishedAt ?? 0).getTime() > week && norm([h.hook, h.body].join(" ")) === mine,
  );
  if (dup) f.push("block:duplicate_of_recent_post");
  return f;
}

/** Turns a flag into plain words for the UI. */
export function describeFlag(flag: string): string {
  const map: Record<string, string> = {
    "block:mature_mode_off": "Mature mode is off. Turn it on in Settings → Voice to post 18+ content on X.",
    "block:x_sensitive_setting_not_confirmed": "Confirm in Settings → Voice that your X account marks media as sensitive.",
    "warn:mature_needs_manual_publish": "Mature post: never auto-published. Review it and press Post now.",
    "warn:instagram_links_not_clickable": "Instagram links aren't clickable in captions; point to your bio link.",
    "warn:engagement_bait": "Looks like engagement bait, which platforms demote.",
    "warn:tiktok_rewards_need_over_1_minute": "TikTok pays only for videos over 1 minute.",
    "block:duplicate_of_recent_post": "Same text was published on this platform in the last 7 days; platforms treat repeats as spam.",
  };
  if (map[flag]) return map[flag];
  const m = flag.match(/^block:mature_not_allowed_on_(\w+)$/);
  if (m) return `Mature content isn't allowed on ${m[1]}. Mature mode works on X only.`;
  return flag.replace(/^(block|warn):/, "").replace(/_/g, " ");
}
