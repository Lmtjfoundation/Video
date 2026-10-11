import { authed, body, fail, ok } from "@/lib/http-api";
import { getPost, savePost } from "@/lib/repo";
import { spendCredits } from "@/lib/auth";
import { CREDIT_COST } from "@/lib/plans";
import { db } from "@/lib/db";
import { signedUrl } from "@/lib/media";
import { enqueueRender, ffmpegAvailable } from "@/lib/render";
import type { MediaItem } from "@/lib/types";
import { nowIso } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Start rendering a video post into an MP4. Rendering runs in the background; poll GET for progress. */
export const POST = authed(async (req, user) => {
  const { id } = await body<{ id: string }>(req);
  const post = await getPost(id);
  if (!post || post.kind !== "video" || !post.video) return fail("Video post not found.", 404);
  if (post.render && (post.render.status === "queued" || post.render.status === "rendering")) return ok(post);
  if (!(await ffmpegAvailable())) return fail("Video rendering isn't switched on for this server yet (ffmpeg missing). Ask the admin to add it.", 503);
  const credits = post.video.length === "long" ? CREDIT_COST.renderLong : CREDIT_COST.renderShort;
  await spendCredits(user.id, credits);
  post.render = { status: "queued", progress: 0, message: "Waiting to render…", updatedAt: nowIso() };
  await savePost(post);
  enqueueRender(user.id, post.id, credits);
  return ok(post);
});

/** Progress and, when done, a playable link to the rendered MP4. */
export const GET = authed(async (req, user) => {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const post = await getPost(id);
  if (!post) return fail("Post not found.", 404);
  let url: string | null = null;
  if (post.render?.mediaId) {
    const m = await db().get<MediaItem>("media", post.render.mediaId);
    if (m) url = signedUrl(user.id, m.id, 6 * 3600);
  }
  return ok({ render: post.render ?? null, url, voice: !!process.env.ELEVENLABS_API_KEY, stock: !!process.env.PEXELS_API_KEY });
});
