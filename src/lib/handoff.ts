import "server-only";
import type { User } from "./auth";
import { db } from "./db";
import { emailLayout, emailReady, sendEmail } from "./email";
import { remoteVideoMedia, signedUrl, trustedVideoUrl } from "./media";
import { renderPost } from "./compose";
import { log, savePost } from "./repo";
import type { MediaItem, Post, Settings } from "./types";
import { nowIso } from "./utils";

/**
 * Posts for a Facebook profile are handed to the person (Facebook doesn't let apps post to profiles).
 * This module prepares what they need to post in one tap and lets them know when posts are ready.
 */

export interface HandoffMedia {
  kind: "video" | "image";
  /** Same-origin, signed, expiring link (so the phone can load it and pass it to the share sheet). */
  url: string;
  /** Link that downloads the file instead of playing it. */
  downloadUrl: string;
  name: string;
  type: string;
  size: number;
}

/** Signed links are absolute (APP_URL); the share page loads them from its own origin. */
const sameOrigin = (u: string) => u.replace(/^https?:\/\/[^/]+/i, "");

function fileName(post: Post, item: MediaItem) {
  const ext = item.type === "video/quicktime" ? "mov" : item.kind === "video" ? "mp4" : (item.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
  const slug = post.hook.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "post";
  return `nexus-pulse-${slug}.${ext}`;
}

/**
 * The file to share: the post's video (rendered or attached; a hosted episode is stored once first),
 * otherwise its first image. Null for text-only posts.
 */
export async function handoffMedia(userId: string, post: Post): Promise<HandoffMedia | null> {
  const items: MediaItem[] = [];
  for (const id of post.mediaIds ?? []) {
    const m = await db().get<MediaItem>("media", id);
    if (m) items.push(m);
  }
  let item = items.find((m) => m.kind === "video") ?? null;
  if (!item && post.videoUrl && trustedVideoUrl(post.videoUrl)) {
    item = await remoteVideoMedia(userId, post.videoUrl);
    post.mediaIds = [item.id, ...(post.mediaIds ?? []).filter((x) => x !== item!.id)];
    await savePost(post);
  }
  item ??= items.find((m) => m.kind === "image") ?? null;
  if (!item) return null;
  const url = sameOrigin(signedUrl(userId, item.id, 6 * 3600));
  const name = fileName(post, item);
  return { kind: item.kind === "video" ? "video" : "image", url, downloadUrl: `${url}&dl=${encodeURIComponent(name)}`, name, type: item.type, size: item.size };
}

/** The caption exactly as it would have been posted (hook/body, CTA, offer link + disclosure, hashtags). */
export const handoffCaption = (post: Post, settings: Settings) => renderPost(post, settings).join("\n\n");

/**
 * One email per scheduler run for the posts that just became ready, so the person can post them on time.
 * Skipped quietly when email isn't set up (the dashboard still shows them).
 */
export async function notifyHandoffs(user: User, posts: Post[]) {
  const pending = posts.filter((p) => p.handoff && !p.handoff.notifiedAt);
  if (!pending.length) return;
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  if (!base || !(await emailReady())) return;
  const n = pending.length;
  const hooks = pending.slice(0, 3).map((p) => `• ${p.hook.length > 90 ? `${p.hook.slice(0, 87)}…` : p.hook}`);
  if (n > 3) hooks.push(`…and ${n - 3} more.`);
  const title = n === 1 ? "Your Facebook post is ready" : `${n} Facebook posts are ready`;
  try {
    await sendEmail({
      to: user.email,
      subject: n === 1 ? `Ready to post on Facebook: ${pending[0].hook.slice(0, 60)}` : `${n} posts are ready for your Facebook profile`,
      text: [
        `${title}.`,
        "Facebook doesn't let apps post to personal profiles, so Ghost Post got it ready for you: open it on your phone and tap Share to Facebook. The video and caption are ready.",
        ...hooks,
        `${base}/post/${pending[0].id}`,
      ].join("\n\n"),
      html: emailLayout({
        title,
        lines: [
          "Facebook doesn't let apps post to personal profiles, so Ghost Post got it ready for you. Open it on your phone and tap Share to Facebook — the video and caption are ready.",
          ...hooks,
        ],
        button: { label: n === 1 ? "Open and post" : "Open the first one", url: `${base}/post/${pending[0].id}` },
        footer: "You get this email when a post scheduled for your Facebook profile is ready. Turn it off on the Platforms tab, on the Facebook card.",
      }),
    });
    const at = nowIso();
    for (const p of pending) {
      p.handoff = { ...p.handoff!, notifiedAt: at };
      await savePost(p);
    }
  } catch (e) {
    await log("warn", "post", `Couldn't email you about ready Facebook posts: ${(e as Error).message}`, { platform: "facebook" });
  }
}
