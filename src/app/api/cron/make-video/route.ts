import { cronAuthorized, fail, handle, ok } from "@/lib/http-api";
import { findUserByEmail } from "@/lib/auth";
import { asUser, db } from "@/lib/db";
import { signedUrl } from "@/lib/media";
import { enqueueRender } from "@/lib/render";
import { getPost, getSettings, savePosts } from "@/lib/repo";
import { PLATFORMS, type MediaItem, type Platform, type VideoPlan } from "@/lib/types";
import { nowIso } from "@/lib/utils";
import { generateVideoPosts } from "@/lib/video";
import { VIDEO_LENGTHS, VIDEO_STYLES } from "@/lib/video-spec";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Owner tool (server access only): write and render a video in an account, the same way Content Studio does, without
 * charging credits. POST { email, topic, platform?, length?, style?, niche? } starts it; GET ?email=&post= reports the
 * render and, when done, a download link.
 */
export const POST = handle(async (req: Request) => {
  if (!cronAuthorized(req)) return fail("Unauthorized", 401);
  const b = (await req.json().catch(() => ({}))) as { email?: string; topic?: string; platform?: string; length?: string; style?: string; niche?: string };
  const user = await findUserByEmail(String(b.email ?? ""));
  if (!user) return fail("No account with that email.", 404);
  const platform = (PLATFORMS.includes(b.platform as Platform) ? b.platform : "tiktok") as Platform;
  const length = (b.length && b.length in VIDEO_LENGTHS ? b.length : "s30") as VideoPlan["length"];
  const style = (b.style && b.style in VIDEO_STYLES ? b.style : "true") as VideoPlan["style"];
  return asUser(user.id, async () => {
    const posts = await generateVideoPosts({ platform, count: 1, niche: String(b.niche ?? "edu"), style, length, topic: String(b.topic ?? "").slice(0, 500) || undefined }, await getSettings());
    for (const p of posts) p.render = { status: "queued", progress: 0, message: "Waiting to render…", credits: 0, updatedAt: nowIso() };
    await savePosts(posts);
    for (const p of posts) enqueueRender(user.id, p.id, 0);
    return ok({ posts: posts.map((p) => ({ id: p.id, hook: p.hook, scenes: p.video?.scenes.length, firstLine: p.video?.scenes[0]?.narration })) });
  });
});

export const GET = handle(async (req: Request) => {
  if (!cronAuthorized(req)) return fail("Unauthorized", 401);
  const q = new URL(req.url).searchParams;
  const user = await findUserByEmail(q.get("email") ?? "");
  if (!user) return fail("No account with that email.", 404);
  return asUser(user.id, async () => {
    const p = await getPost(q.get("post") ?? "");
    if (!p) return fail("No such post.", 404);
    const m = p.render?.mediaId ? await db().get<MediaItem>("media", p.render.mediaId) : null;
    return ok({ hook: p.hook, render: p.render, video: m ? signedUrl(user.id, m.id, 6 * 3600) : null });
  });
});
