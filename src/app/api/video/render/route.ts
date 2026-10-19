import { freeVoiceEnabled } from "@/lib/free-voice";
import { authed, body, fail, ok } from "@/lib/http-api";
import { getPost, savePost } from "@/lib/repo";
import { spendCredits } from "@/lib/auth";
import { db } from "@/lib/db";
import { signedUrl } from "@/lib/media";
import { enqueueRender, ffmpegAvailable, releaseOrphanedRender } from "@/lib/render";
import type { MediaItem } from "@/lib/types";
import { nowIso } from "@/lib/utils";
import { elevenlabsKey, stockReady } from "@/lib/integrations";
import { renderCredits } from "@/lib/video-spec";
import { mediaKey } from "@/lib/gemini-media";
import { isGraphicsLook } from "@/lib/looks";

export const dynamic = "force-dynamic";

/** Start rendering a video post into an MP4. Rendering runs in the background; poll GET for progress. */
export const POST = authed(async (req, user) => {
  const { id } = await body<{ id: string }>(req);
  const post = await getPost(id);
  if (!post || post.kind !== "video" || !post.video) return fail("Video post not found.", 404);
  await releaseOrphanedRender(user.id, post);
  if (post.render && (post.render.status === "queued" || post.render.status === "rendering")) return ok(post);
  if (!(await ffmpegAvailable())) return fail("Video rendering isn't switched on for this server yet (ffmpeg missing). Ask the admin to add it.", 503);
  if (post.video.ai && !isGraphicsLook(post.video.ai.look) && !(await mediaKey())) return fail("This video's pictures and Veo clips need the app's Gemini key. Ask the admin to add it in Admin → App settings → Integrations.", 503);
  const credits = renderCredits(post.video);
  await spendCredits(user.id, credits);
  post.render = { status: "queued", progress: 0, message: "Waiting to render…", credits, updatedAt: nowIso() };
  await savePost(post);
  enqueueRender(user.id, post.id, credits);
  return ok(post);
});

/** Progress and, when done, a playable link to the rendered MP4. */
export const GET = authed(async (req, user) => {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const post = await getPost(id);
  if (!post) return fail("Post not found.", 404);
  await releaseOrphanedRender(user.id, post);
  let url: string | null = null;
  if (post.render?.mediaId) {
    const m = await db().get<MediaItem>("media", post.render.mediaId);
    if (m) url = signedUrl(user.id, m.id, 6 * 3600);
  }
  if (!url && post.videoUrl) url = `/api/media/remote?u=${encodeURIComponent(post.videoUrl)}`;
  return ok({ render: post.render ?? null, url, voice: !!(await elevenlabsKey()) || freeVoiceEnabled(), stock: await stockReady(), ai: !!post.video?.ai });
});
