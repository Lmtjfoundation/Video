import { body, fail, authed, ok } from "@/lib/http-api";
import { deletePost, getPost, getSettings, listPosts, log, savePost } from "@/lib/repo";
import { finalizePost } from "@/lib/generate";
import { zonedToUtc, localParts } from "@/lib/time";
import { PLACEMENTS, type Post, type PostStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = authed(async (req: Request) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const platform = url.searchParams.get("platform");
  let posts = await listPosts();
  if (status) posts = posts.filter((p) => status.split(",").includes(p.status));
  if (platform) posts = posts.filter((p) => p.platform === platform);
  return ok(posts);
});

type Patch = Partial<Pick<Post, "hook" | "body" | "parts" | "hashtags" | "cta" | "offerId" | "imageUrl" | "topic" | "mediaIds" | "mature" | "placement">> & {
  id: string;
  status?: PostStatus;
  /** Local date + time in the user's timezone */
  date?: string;
  time?: string;
  /** Drag-and-drop: keep local time, change day */
  moveToDate?: string;
  unschedule?: boolean;
};

export const PATCH = authed(async (req, user) => {
  const patch = await body<Patch>(req);
  const post = await getPost(patch.id);
  if (!post) return fail("Post not found", 404);
  if (post.status === "published" || post.status === "publishing") return fail("Published posts can't be edited here.");
  const s = await getSettings();

  if (typeof patch.hook === "string") post.hook = patch.hook.trim();
  if (typeof patch.body === "string") post.body = patch.body.trim();
  for (const k of ["cta", "imageUrl", "topic"] as const) {
    const v = patch[k];
    if (typeof v === "string") post[k] = v.trim() || undefined;
  }
  if (post.imageUrl && !/^https:\/\//.test(post.imageUrl)) return fail("Image URL must start with https://");
  if (Array.isArray(patch.parts)) {
    post.parts = patch.parts.map(String).filter((x) => x.trim());
    // Video posts: keep the scene plan in sync with edited narration ("[0:00–0:02] text" per scene).
    if (post.kind === "video" && post.video) post.video.scenes.forEach((sc, i) => { if (post.parts[i] != null) sc.narration = post.parts[i].replace(/^\[[^\]]*\]\s*/, ""); });
  }
  if (Array.isArray(patch.hashtags)) post.hashtags = patch.hashtags.map(String).filter(Boolean);
  if (patch.offerId !== undefined) post.offerId = patch.offerId || null;
  if (Array.isArray(patch.mediaIds)) post.mediaIds = patch.mediaIds.map(String).slice(0, 10);
  if (typeof patch.mature === "boolean") post.mature = patch.mature && post.platform === "x";
  if (patch.placement !== undefined) {
    if (!(PLACEMENTS as readonly string[]).includes(patch.placement)) return fail("Choose Auto, Reel, Feed or Story.");
    post.placement = patch.placement;
  }
  // Users on approval go to the review queue instead of straight to the schedule.
  const scheduleStatus = user.requireApproval ? "pending_review" : "scheduled";

  if (patch.moveToDate && post.scheduledAt) {
    const t = localParts(new Date(post.scheduledAt), s.timezone).time;
    post.scheduledAt = zonedToUtc(patch.moveToDate, t, s.timezone).toISOString();
    if (post.status !== "pending_review") post.status = scheduleStatus;
  }
  if (patch.date && patch.time) {
    post.scheduledAt = zonedToUtc(patch.date, patch.time, s.timezone).toISOString();
    post.status = scheduleStatus;
  }
  if (patch.unschedule) {
    post.scheduledAt = undefined;
    post.status = "draft";
  }
  if (patch.status) {
    // "published" here means the user posted a copy-ready item by hand.
    if (patch.status === "published") post.publishedAt = new Date().toISOString();
    if (!["draft", "scheduled", "published", "copy_ready"].includes(patch.status)) return fail("You can't set that status.");
    if (patch.status === "scheduled" && !post.scheduledAt) return fail("Pick a date and time first.");
    post.status = patch.status === "scheduled" ? scheduleStatus : patch.status;
  }
  post.error = undefined;
  post.attempts = 0;
  finalizePost(post, s);
  await savePost(post);
  return ok(post);
});

export const DELETE = authed(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("Missing id");
  const post = await getPost(id);
  await deletePost(id);
  if (post) await log("info", "post", `Deleted post “${post.hook.slice(0, 60)}”`, { platform: post.platform });
  return ok({ ok: true });
});
