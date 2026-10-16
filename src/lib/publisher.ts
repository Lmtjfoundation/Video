import "server-only";
import { ADAPTERS, type VideoFile } from "./platforms/adapters";
import { freshCredential } from "./platforms/auth";
import { AuthError, CopyReadyError, RateLimitError } from "./platforms/http";
import { renderPost } from "./compose";
import { canAct, clearStrikes, coolDown, recordAction } from "./ratelimit";
import { getSettings, listPosts, log, savePost } from "./repo";
import { hasBlockingFlag } from "./safety";
import type { Post, Settings } from "./types";
import { nowIso } from "./utils";
import { finalizePost } from "./generate";
import { describeFlag, historyFlags } from "./compliance";
import { usePostAllowance } from "./auth";
import { currentUserId } from "./db";
import { firstImageUrl, readFile, remoteVideoMedia, signedUrl, trustedVideoUrl } from "./media";
import { db } from "./db";
import type { MediaItem } from "./types";
import { isProfileCred } from "./facebook-profile";
import { inQuietHours } from "./time";
import { notifyHandoffs } from "./handoff";
import type { User } from "./auth";

/** The newest video attached to a post (rendered first), loaded for upload. */
async function videoFor(userId: string, post: Post): Promise<VideoFile | null> {
  for (const id of post.mediaIds ?? []) {
    const m = await db().get<MediaItem>("media", id);
    if (m?.kind !== "video") continue;
    const bytes = await readFile(m);
    return { bytes, url: signedUrl(userId, m.id, 2 * 86400), mime: m.type === "video/quicktime" ? "video/quicktime" : "video/mp4", size: bytes.length };
  }
  // A finished video hosted elsewhere (an episode from Claude's content inbox): store it once, then attach it.
  if (post.videoUrl && trustedVideoUrl(post.videoUrl)) {
    const m = await remoteVideoMedia(userId, post.videoUrl);
    post.mediaIds = [m.id, ...(post.mediaIds ?? []).filter((x) => x !== m.id)];
    await savePost(post);
    const bytes = await readFile(m);
    return { bytes, url: signedUrl(userId, m.id, 2 * 86400), mime: "video/mp4", size: bytes.length };
  }
  return null;
}

const STALE_MS = 12 * 3600_000;
const MAX_PER_RUN = 6;

export type PublishOutcome = "published" | "copy_ready" | "waiting" | "failed" | "retry";
type PublishResultInfo = { outcome: PublishOutcome; message: string; handoff?: boolean };

/**
 * Facebook profiles (including monetized profiles in professional mode): Facebook doesn't let apps post to them,
 * so at the post's time it's prepared and handed to the person, who shares it from their phone with one tap.
 * Counts toward the plan's monthly posts once, like a published post.
 */
async function handOffToProfile(post: Post, userId: string | null, manual: boolean): Promise<PublishResultInfo> {
  const first = !post.handoff;
  const now = nowIso();
  post.status = "copy_ready";
  post.error = undefined;
  // Pressing "Post now" in the app needs no email: the person is already here.
  post.handoff = { to: "facebook_profile", readyAt: now, notifiedAt: manual ? now : undefined };
  await savePost(post);
  if (first && userId) await usePostAllowance(userId, true);
  await log("info", "post", `Ready for your Facebook profile — “${post.hook.slice(0, 80)}”. Open it and tap Share to Facebook.`, { platform: post.platform, postId: post.id });
  return { outcome: "copy_ready", message: "Ready for your Facebook profile. Open it and tap Share to Facebook.", handoff: true };
}

async function setWaiting(post: Post, reason: string) {
  if (post.error !== reason) {
    post.error = reason;
    await savePost(post);
    await log("info", "post", `Waiting: ${reason}`, { platform: post.platform, postId: post.id });
  }
}

export async function publishOne(post: Post, settings: Settings, manual = false): Promise<PublishResultInfo> {
  const adapter = ADAPTERS[post.platform];
  const userId = currentUserId();

  if (post.status === "pending_review" || post.status === "rejected") {
    return { outcome: "waiting", message: post.status === "rejected" ? `Rejected in review: ${post.reviewNote ?? "edit and resubmit"}` : "Waiting for admin approval." };
  }

  // Re-check rules at publish time: settings or history may have changed since the post was written.
  finalizePost(post, settings);
  const hist = historyFlags(post, await listPosts());
  post.safetyFlags = [...new Set([...post.safetyFlags, ...hist])];

  if (post.mature && !manual) {
    await setWaiting(post, "Mature posts are never auto-published. Review it and press Post now.");
    return { outcome: "waiting", message: post.error ?? "" };
  }

  if (hasBlockingFlag(post.safetyFlags)) {
    post.status = "draft";
    post.error = `Held to protect your account: ${post.safetyFlags.filter((f) => f.startsWith("block:")).map(describeFlag).join(" ")} Edit and reschedule.`;
    await savePost(post);
    await log("warn", "safety", `Post held back by safety filter`, { platform: post.platform, postId: post.id, flags: post.safetyFlags });
    return { outcome: "failed", message: post.error };
  }

  // Video posts need a finished file: the rendered MP4 or one the user attached.
  let video: VideoFile | undefined;
  if (post.kind === "video") {
    let found: VideoFile | null = null;
    try {
      found = userId ? await videoFor(userId, post) : null;
    } catch (e) {
      post.status = "copy_ready";
      post.error = `${(e as Error).message} Press Post now to try again, or download the video and post it in the app.`;
      await savePost(post);
      return { outcome: "copy_ready", message: post.error };
    }
    if (!found) {
      post.status = "copy_ready";
      post.error = "Render the video first (press Render video), or attach a finished MP4 from the Media Library.";
      await savePost(post);
      return { outcome: "copy_ready", message: post.error };
    }
    video = found;
  }

  if (userId) {
    const allowance = await usePostAllowance(userId, false);
    if (!allowance.ok) {
      if (manual) return { outcome: "waiting", message: allowance.reason ?? "" };
      await setWaiting(post, allowance.reason ?? "Monthly post limit reached.");
      return { outcome: "waiting", message: post.error ?? "" };
    }
  }
  if (post.platform === "instagram" && !post.imageUrl && post.mediaIds?.length && userId) {
    post.imageUrl = (await firstImageUrl(userId, post.mediaIds)) ?? undefined;
  }

  const can = adapter.publishable(post);
  const cred = can === true ? await freshCredential(post.platform) : null;
  if (post.platform === "facebook" && cred && isProfileCred(cred)) {
    // Don't ask the person to post in the middle of the night: wait for quiet hours to end (Post now still works).
    const q = settings.quietHours;
    if (!manual && q.enabled && inQuietHours(new Date(), settings.timezone, q.start, q.end)) {
      await setWaiting(post, "Quiet hours — it will be ready for you when they end.");
      return { outcome: "waiting", message: post.error ?? "" };
    }
    return handOffToProfile(post, userId, manual);
  }
  if (can !== true || !cred) {
    post.status = "copy_ready";
    post.error = can !== true ? can : "No account connected — copy and post manually, or connect it in Settings.";
    await savePost(post);
    await log("info", "post", `Copy-ready: ${post.error}`, { platform: post.platform, postId: post.id });
    return { outcome: "copy_ready", message: post.error };
  }

  const gate = await canAct(post.platform, "post", settings);
  if (!gate.ok) {
    if (manual) return { outcome: "waiting", message: gate.reason ?? "Blocked by limits" };
    await setWaiting(post, gate.reason ?? "Rate limits");
    return { outcome: "waiting", message: gate.reason ?? "" };
  }

  post.status = "publishing";
  await savePost(post);
  try {
    const texts = renderPost(post, settings);
    const res = await adapter.publish(post, texts, cred, video);
    post.status = "published";
    post.publishedAt = nowIso();
    post.externalId = res.externalId;
    post.externalIds = res.externalIds;
    post.externalUrl = res.url;
    post.error = undefined;
    await savePost(post);
    if (userId) await usePostAllowance(userId, true);
    await recordAction(post.platform, "post");
    await clearStrikes(post.platform);
    await log("info", "post", `Published ${post.format} — “${post.hook.slice(0, 80)}”`, {
      platform: post.platform,
      postId: post.id,
      url: res.url,
      text: texts.join("\n---\n"),
    });
    return { outcome: "published", message: res.url ?? "Published" };
  } catch (e) {
    const err = e as Error;
    if (err instanceof CopyReadyError) {
      post.status = "copy_ready";
      post.error = err.message;
    } else if (err instanceof RateLimitError) {
      const until = await coolDown(post.platform, err.retryAfterSec);
      post.status = "scheduled";
      post.error = `Rate limited — paused until ${new Date(until).toISOString()}`;
      await log("warn", "post", post.error, { platform: post.platform, postId: post.id });
    } else if (err instanceof AuthError) {
      post.status = "failed";
      post.error = `Authorization failed — reconnect ${post.platform} in Settings. (${err.message.slice(0, 160)})`;
      await log("error", "post", post.error, { platform: post.platform, postId: post.id });
    } else {
      post.attempts = (post.attempts ?? 0) + 1;
      post.error = err.message.slice(0, 400);
      if (post.attempts < 3 && !manual) {
        post.status = "scheduled";
        post.scheduledAt = new Date(Date.now() + 15 * 60_000 * post.attempts).toISOString();
        await log("warn", "post", `Publish failed, retrying (${post.attempts}/3): ${post.error}`, { platform: post.platform, postId: post.id });
      } else {
        post.status = "failed";
        await log("error", "post", `Publish failed: ${post.error}`, { platform: post.platform, postId: post.id });
      }
    }
    await savePost(post);
    return { outcome: post.status === "scheduled" ? "retry" : post.status === "copy_ready" ? "copy_ready" : "failed", message: post.error ?? "" };
  }
}

/** Cron entry: publish everything that's due. `user` (when given) gets one email for posts handed to their Facebook profile. */
export async function runPublish(user?: User) {
  const settings = await getSettings();
  if (settings.killSwitch) return { ran: false, reason: "Kill switch on" };
  if (!settings.autopilot) return { ran: false, reason: "Autopilot off" };

  const now = Date.now();
  const posts = (await listPosts()).filter((p) => p.status === "scheduled" && p.scheduledAt && new Date(p.scheduledAt).getTime() <= now);
  posts.sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));

  const results: Record<string, string> = {};
  const handedOff: Post[] = [];
  let processed = 0;
  for (const post of posts) {
    if (!settings.platforms[post.platform]) continue;
    if (now - new Date(post.scheduledAt!).getTime() > STALE_MS) {
      post.status = "failed";
      post.error = "Missed its window by more than 12 hours (scheduler wasn't running). Reschedule it.";
      await savePost(post);
      await log("warn", "post", post.error, { platform: post.platform, postId: post.id });
      results[post.id] = "stale";
      continue;
    }
    if (processed >= MAX_PER_RUN) break;
    const r = await publishOne(post, settings);
    results[post.id] = r.outcome;
    if (r.handoff) handedOff.push(post);
    processed++;
  }
  if (user && handedOff.length && settings.handoffEmail) await notifyHandoffs(user, handedOff);
  return { ran: true, due: posts.length, results };
}
