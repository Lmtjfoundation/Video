import "server-only";
import { ADAPTERS, type PublishOptions, type VideoFile } from "./platforms/adapters";
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
import { firstImageUrl, imageUrls, readFile, remoteVideoMedia, signedUrl, trustedVideoUrl } from "./media";
import { db } from "./db";
import type { MediaItem } from "./types";
import { isProfileCred } from "./facebook-profile";
import { isMcPlatform, metricoolFor, metricoolPublish, type MetricoolConn } from "./metricool";
import { inQuietHours } from "./time";
import { withAccount } from "./account-slot";
import { notifyHandoffs } from "./handoff";
import type { User } from "./auth";

/** The newest video attached to a post (rendered first), loaded for upload. */
async function videoFor(userId: string, post: Post): Promise<VideoFile | null> {
  for (const id of post.mediaIds ?? []) {
    const m = await db().get<MediaItem>("media", id);
    if (m?.kind !== "video") continue;
    const bytes = await readFile(m);
    // Videos the app rendered are vertical unless the plan was 16:9 long-form.
    const portrait = m.rendered ? post.video?.length !== "long" : undefined;
    return { bytes, url: signedUrl(userId, m.id, 2 * 86400), mime: m.type === "video/quicktime" ? "video/quicktime" : "video/mp4", size: bytes.length, durationSec: m.durationSec, portrait };
  }
  // A finished video hosted elsewhere (an episode from Claude's content inbox): store it once, then attach it.
  if (post.videoUrl && trustedVideoUrl(post.videoUrl)) {
    const m = await remoteVideoMedia(userId, post.videoUrl);
    post.mediaIds = [m.id, ...(post.mediaIds ?? []).filter((x) => x !== m.id)];
    await savePost(post);
    const bytes = await readFile(m);
    return { bytes, url: signedUrl(userId, m.id, 2 * 86400), mime: "video/mp4", size: bytes.length, durationSec: m.durationSec };
  }
  return null;
}

/** Posts through the person's Metricool: the HD video (or first image) goes as a public signed link Metricool copies. */
async function sendViaMetricool(mc: MetricoolConn, post: Post, texts: string[], video: VideoFile | undefined, userId: string | null, settings: Settings) {
  if (!isMcPlatform(post.platform)) throw new CopyReadyError("This platform can't post through Metricool.");
  let image = post.imageUrl && /^https:\/\//.test(post.imageUrl) ? post.imageUrl : null;
  if (!video && !image && post.mediaIds?.length && userId) image = await firstImageUrl(userId, post.mediaIds);
  const media = video ? { url: video.url, video: true } : image ? { url: image, video: false } : null;
  return metricoolPublish(mc, post.platform, post, texts, media, settings.timezone);
}

/** Whether `platform` is connected through the social connect service for the signed-in user. */
async function uploadPostFor(platform: Post["platform"]) {
  const up = await import("./upload-post");
  if (!up.isUpPlatform(platform) || !(await up.uploadPostReady())) return false;
  return (await up.connectedAccounts()).some((a) => a.platform === platform);
}

/** Posts through Upload-Post: the video (or the pictures) as public signed links it fetches itself. */
async function sendViaUploadPost(post: Post, texts: string[], video: VideoFile | undefined, userId: string | null) {
  const up = await import("./upload-post");
  if (!up.isUpPlatform(post.platform)) throw new CopyReadyError("This platform can't post through the social connect service.");
  const images = video ? [] : [...(userId && post.mediaIds?.length ? await imageUrls(userId, post.mediaIds) : []), ...(post.imageUrl && /^https:\/\//.test(post.imageUrl) ? [post.imageUrl] : [])];
  return up.publishViaUploadPost(post.platform, post, texts, { video: video ? { url: video.url } : undefined, images: [...new Set(images)] });
}

/** Pictures and placement for Instagram / Facebook: every attached picture plus the image URL, and Reel / feed / Story. */
async function publishOptions(post: Post, settings: Settings, userId: string | null): Promise<PublishOptions> {
  const images = userId && post.mediaIds?.length ? await imageUrls(userId, post.mediaIds) : [];
  // The image URL counts unless it's one of the attached pictures already (a signed link to our own media).
  const ownMedia = (u: string) => (post.mediaIds ?? []).some((id) => u.includes(`/api/media/file/`) && u.includes(`/${id}?`));
  if (post.imageUrl && /^https:\/\//.test(post.imageUrl) && !ownMedia(post.imageUrl)) images.push(post.imageUrl);
  const fallback = post.platform === "instagram" ? settings.autoPost.instagram : post.platform === "facebook" ? settings.autoPost.facebook : "auto";
  return { images, placement: post.placement ?? fallback };
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

/** Same finished video or picture: an episode's hosted MP4, or the first file attached from the Media Library. */
const mediaKey = (p: Post) => p.videoUrl || p.mediaIds?.[0] || "";

/**
 * Facebook profile on autopilot: Facebook doesn't let apps post to profiles, but Instagram's own "Share to Facebook"
 * setting (Accounts Center → Sharing across profiles) copies Instagram posts to the person's Facebook profile.
 * So the post goes to Instagram and Instagram puts it on the profile. When an Instagram post of the same video is
 * already planned, that one carries it (no duplicate on Instagram). Text-only posts, or a missing Instagram
 * connection, fall back to the one-tap handoff, so nothing is lost.
 */
async function shareThroughInstagram(post: Post, settings: Settings, userId: string | null, manual: boolean, video?: VideoFile): Promise<PublishResultInfo> {
  const key = mediaKey(post);
  const twin = key
    ? (await listPosts()).find((p) => p.platform === "instagram" && p.id !== post.id && mediaKey(p) === key && !["rejected", "failed"].includes(p.status))
    : undefined;
  if (twin?.status === "published") {
    post.status = "published";
    post.publishedAt = nowIso();
    post.externalUrl = twin.externalUrl;
    post.error = undefined;
    await savePost(post);
    await log("info", "post", `Shared to your Facebook profile with the Instagram post — “${post.hook.slice(0, 80)}”`, { platform: post.platform, postId: post.id, url: twin.externalUrl });
    return { outcome: "published", message: "Shared to your Facebook profile through Instagram." };
  }
  if (twin) {
    await setWaiting(post, "Goes out with the Instagram post of the same video — Instagram shares it to your profile.");
    return { outcome: "waiting", message: post.error ?? "" };
  }

  const igPost: Post = { ...post, platform: "instagram" };
  // Instagram connected in the person's Metricool works too: no developer account needed.
  const mc = await metricoolFor("instagram");
  const ig = mc ? null : await freshCredential("instagram");
  const linked = !!mc || !!ig?.accessToken;
  const can = ADAPTERS.instagram.publishable(igPost);
  if (!linked || can !== true) {
    const r = await handOffToProfile(post, userId, manual);
    post.error = !linked ? "Instagram isn't connected, so this one is ready for you to post. Reconnect Instagram on the Platforms tab." : "Text-only posts can't go through Instagram, so this one is ready for you to post.";
    await savePost(post);
    return r;
  }
  const gate = await canAct("instagram", "post", settings);
  if (!gate.ok) {
    if (manual) return { outcome: "waiting", message: gate.reason ?? "Blocked by limits" };
    await setWaiting(post, gate.reason ?? "Rate limits");
    return { outcome: "waiting", message: post.error ?? "" };
  }
  post.status = "publishing";
  await savePost(post);
  try {
    const texts = renderPost(igPost, settings);
    const res = mc ? await sendViaMetricool(mc, igPost, texts, video, userId, settings) : await ADAPTERS.instagram.publish(igPost, texts, ig!, video, await publishOptions(igPost, settings, userId));
    post.status = "published";
    post.publishedAt = nowIso();
    post.externalId = res.externalId;
    post.externalIds = res.externalIds;
    post.externalUrl = res.url;
    post.error = undefined;
    await savePost(post);
    if (userId) await usePostAllowance(userId, true);
    await recordAction("instagram", "post");
    await log("info", "post", `${mc ? "Sent to Instagram through Metricool" : "Posted to Instagram"}, which shares it to your Facebook profile — “${post.hook.slice(0, 80)}”`, { platform: post.platform, postId: post.id, url: res.url });
    return { outcome: "published", message: res.url ?? "Published" };
  } catch (e) {
    // Never lose a post: hand it over to post with one tap, and say why.
    const r = await handOffToProfile(post, userId, manual);
    post.error = `Instagram didn't take it (${(e as Error).message.slice(0, 200)}), so it's ready for you to post.`;
    await savePost(post);
    await log("warn", "post", post.error, { platform: post.platform, postId: post.id });
    return r;
  }
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
  // Accounts connected in the person's Metricool post through Metricool when switched on for this platform.
  // An extra account on the network (post.account) always posts with its own sign-in, never through Metricool.
  const mc = can === true && !post.account ? await metricoolFor(post.platform) : null;
  const cred = can === true && !mc ? await withAccount(post.account, () => freshCredential(post.platform)) : null;
  // Connected through the social connect service (Upload-Post) and not directly: post through it.
  const up = can === true && !mc && !cred && !post.account ? await uploadPostFor(post.platform) : false;
  if (post.platform === "facebook" && cred && isProfileCred(cred)) {
    // Don't ask the person to post in the middle of the night: wait for quiet hours to end (Post now still works).
    const q = settings.quietHours;
    if (!manual && q.enabled && inQuietHours(new Date(), settings.timezone, q.start, q.end)) {
      await setWaiting(post, "Quiet hours — it will be ready for you when they end.");
      return { outcome: "waiting", message: post.error ?? "" };
    }
    if (cred.viaInstagram) return shareThroughInstagram(post, settings, userId, manual, video);
    return handOffToProfile(post, userId, manual);
  }
  if (can !== true || (!cred && !mc && !up)) {
    post.status = "copy_ready";
    post.error = can !== true ? can : post.account ? "The account picked for this post isn't connected anymore — choose another account on the post, or reconnect it on the Platforms tab." : "No account connected — copy and post manually, or connect it on the Platforms tab.";
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
    const res = mc
      ? await sendViaMetricool(mc, post, texts, video, userId, settings)
      : up
        ? await sendViaUploadPost(post, texts, video, userId)
        : await adapter.publish(post, texts, cred!, video, await publishOptions(post, settings, userId));
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
    const how = mc ? "Sent to Metricool, which publishes it in about 2 minutes" : up ? "Sent through the social connect service, which publishes it in a few minutes" : `Published ${post.format}`;
    await log("info", "post", `${how} — “${post.hook.slice(0, 80)}”`, {
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
      post.error = mc
        ? `Metricool didn't accept the API token — reconnect Metricool on the Platforms tab. (${err.message.slice(0, 160)})`
        : up
          ? `Reconnect ${post.platform} on the Platforms tab (one tap). (${err.message.slice(0, 160)})`
        : `Authorization failed — reconnect ${post.platform} on the Platforms tab. (${err.message.slice(0, 160)})`;
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

/**
 * "Post automatically": publishes a freshly written (or freshly rendered) post straight away, through every check
 * Post now uses (kill switch, safety filter, rate limits, monthly allowance). Anything that has to wait — quiet
 * hours, a rate limit, a retry — is scheduled for now so the scheduler posts it as soon as it can. Mature posts and
 * accounts that need approval are never posted automatically.
 */
export async function autoPublish(post: Post, opts: { requireApproval?: boolean } = {}): Promise<PublishResultInfo> {
  const settings = await getSettings();
  if (opts.requireApproval) {
    post.status = "pending_review";
    post.scheduledAt = nowIso();
    await savePost(post);
    return { outcome: "waiting", message: "Sent for approval — it posts once an admin approves it." };
  }
  if (settings.killSwitch) {
    await setWaiting(post, "Kill switch is on, so it wasn't posted. Release the kill switch and press Post now.");
    return { outcome: "waiting", message: post.error ?? "" };
  }
  if (post.mature) {
    await setWaiting(post, "Mature posts are never posted automatically. Review it and press Post now.");
    return { outcome: "waiting", message: post.error ?? "" };
  }
  const r = await publishOne(post, settings, false);
  if (r.outcome === "waiting" && post.status === "draft") {
    post.status = "scheduled";
    post.scheduledAt = nowIso();
    await savePost(post);
  }
  return r;
}

/** Cron entry: publish everything that's due. `user` (when given) gets one email for posts handed to their Facebook profile. */
/**
 * Posts sent through the social connect service finish on its side a few minutes later: fill in the post's link, or
 * mark it failed with the network's reason. At most 10 a run, for 2 days after sending.
 */
export async function settleServiceSends(now = Date.now()) {
  const waiting = (await listPosts())
    .filter((p) => p.status === "published" && p.externalId?.startsWith("upload-post:") && !p.remoteSettled && now - new Date(p.publishedAt ?? 0).getTime() < 2 * 86_400_000)
    .slice(0, 10);
  if (!waiting.length) return;
  const { checkSent } = await import("./upload-post");
  for (const post of waiting) {
    const r = await checkSent(post);
    if (r.state === "pending") continue;
    post.remoteSettled = true;
    if (r.state === "done") {
      if (r.url) post.externalUrl = r.url;
    } else {
      post.status = "failed";
      post.error = `The network refused it: ${(r.error ?? "no reason given").slice(0, 300)}`;
      await log("error", "post", post.error, { platform: post.platform, postId: post.id });
    }
    await savePost(post);
  }
}

export async function runPublish(user?: User) {
  const settings = await getSettings();
  // Only reads results of posts already sent, so it runs even with the kill switch or autopilot off.
  await settleServiceSends().catch((e) => console.error("[upload-post] settle failed:", (e as Error).message));
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
