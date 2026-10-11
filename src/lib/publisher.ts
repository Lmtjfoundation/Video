import "server-only";
import { ADAPTERS } from "./platforms/adapters";
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
import { firstImageUrl } from "./media";

const STALE_MS = 12 * 3600_000;
const MAX_PER_RUN = 6;

export type PublishOutcome = "published" | "copy_ready" | "waiting" | "failed" | "retry";

async function setWaiting(post: Post, reason: string) {
  if (post.error !== reason) {
    post.error = reason;
    await savePost(post);
    await log("info", "post", `Waiting: ${reason}`, { platform: post.platform, postId: post.id });
  }
}

export async function publishOne(post: Post, settings: Settings, manual = false): Promise<{ outcome: PublishOutcome; message: string }> {
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

  if (post.kind === "video") {
    post.status = "copy_ready";
    post.error = "Video post: make the video from this plan (or upload the finished file), then post it from the platform's app. Automatic video upload isn't available yet.";
    await savePost(post);
    await log("info", "post", `Copy-ready: ${post.error}`, { platform: post.platform, postId: post.id });
    return { outcome: "copy_ready", message: post.error };
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
    const res = await adapter.publish(post, texts, cred);
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

/** Cron entry: publish everything that's due. */
export async function runPublish() {
  const settings = await getSettings();
  if (settings.killSwitch) return { ran: false, reason: "Kill switch on" };
  if (!settings.autopilot) return { ran: false, reason: "Autopilot off" };

  const now = Date.now();
  const posts = (await listPosts()).filter((p) => p.status === "scheduled" && p.scheduledAt && new Date(p.scheduledAt).getTime() <= now);
  posts.sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));

  const results: Record<string, string> = {};
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
    processed++;
  }
  return { ran: true, due: posts.length, results };
}
