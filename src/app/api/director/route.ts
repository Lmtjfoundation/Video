import { authed, body, fail, ok } from "@/lib/http-api";
import { withCredits } from "@/lib/credits";
import { CHARACTER_LOOK_GROUPS, CHARACTER_LOOKS, getCharacters, listCharacters } from "@/lib/characters";
import { db } from "@/lib/db";
import { isGraphicsLook } from "@/lib/looks";
import { listMedia, signedUrl } from "@/lib/media";
import { picturesReady } from "@/lib/pictures";
import { CREDIT_COST } from "@/lib/plans";
import { getPost, getSettings, log } from "@/lib/repo";
import { startJob } from "@/lib/jobs";
import { deleteSession, getSession, listSessions, revise, setScenes, startSession } from "@/lib/director";
import { PLATFORMS, type MediaItem, type Platform, type VideoScene } from "@/lib/types";
import { lengthAllowed, MOVIE_LENGTHS, MOVIE_SHAPE, renderCredits, videoCredits, type MovieLength } from "@/lib/video-spec";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The sessions, the open one's storyboard with each scene's picture, and what's needed to start a new one. */
export const GET = authed(async (req, user) => {
  const id = new URL(req.url).searchParams.get("id");
  const sessions = await listSessions();
  const open = id ? sessions.find((s) => s.id === id) : sessions[0];
  let video = null;
  if (open) {
    const post = await getPost(open.postId);
    if (post?.video) {
      const pic = (mid?: string) => (mid ? signedUrl(user.id, mid, 6 * 3600) : null);
      const rendered = post.render?.mediaId ? await db().get<MediaItem>("media", post.render.mediaId) : null;
      video = {
        postId: post.id,
        title: post.hook,
        scenes: post.video.scenes.map((s) => ({ ...s, picture: pic(s.mediaId) ?? pic(s.painted?.mediaId) })),
        render: post.render ?? null,
        url: rendered ? signedUrl(user.id, rendered.id, 6 * 3600) : null,
        renderCredits: renderCredits(post.video),
      };
    }
  }
  return ok({
    sessions: sessions.map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt })),
    open: open ? { ...open, video } : null,
    characters: (await listCharacters()).map((c) => ({ id: c.id, name: c.name, imageUrl: signedUrl(user.id, c.imageMediaId, 6 * 3600) })),
    pictures: (await listMedia()).filter((m) => m.kind === "image" && !m.name.startsWith("scene-")).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60).map((m) => ({ id: m.id, name: m.name, url: signedUrl(user.id, m.id, 6 * 3600) })),
    lookGroups: CHARACTER_LOOK_GROUPS,
    lengths: MOVIE_LENGTHS.map((l) => ({ id: l, label: MOVIE_SHAPE[l].label })),
    credits: { change: CREDIT_COST.filmBeat },
  });
});

/** A chat message: the first one starts a video, the rest change it. */
export const POST = authed(async (req, user) => {
  const b = await body<{ id?: string; message?: string; characterIds?: string[]; look?: string; platform?: Platform; length?: MovieLength; background?: boolean }>(req);
  const message = String(b.message ?? "").trim().slice(0, 4000);
  if (message.length < 3) return fail("Tell the Director what you want.");
  if (b.id) {
    const session = await getSession(b.id);
    if (!session) return fail("This conversation was deleted.", 404);
    const r = await withCredits(CREDIT_COST.filmBeat, () => revise(session, message));
    return ok({ id: r.session.id });
  }
  const platform = PLATFORMS.includes(b.platform as Platform) && b.platform !== "webhook" ? (b.platform as Platform) : "tiktok";
  const length = MOVIE_LENGTHS.includes(b.length as MovieLength) ? (b.length as MovieLength) : "s60";
  if (!lengthAllowed(length, platform)) return fail("X allows videos up to 2 minutes 20 seconds. Pick a shorter length for X.");
  const cast = await getCharacters(Array.isArray(b.characterIds) ? b.characterIds.slice(0, 6) : []);
  const look = String(b.look ?? "").trim().slice(0, 160) || cast[0]?.look || CHARACTER_LOOKS[0];
  if (!isGraphicsLook(look) && !(await picturesReady())) return fail("The Director needs Ghost Post's engine for pictures. The admin connects it in Admin → App settings → Integrations.", 503);
  const start = async () => {
    const r = await withCredits(videoCredits(length, "plan"), async () => startSession({ message, characterIds: cast.map((c) => c.id), look, platform, length }, await getSettings()));
    await log("info", "generate", `Director: “${r.post.hook}”`, { postId: r.post.id });
    return r;
  };
  // In the background the person can leave the page; the jobs tray opens the storyboard when it's ready.
  if (b.background) {
    const job = await startJob(user.id, { kind: "director", title: message.slice(0, 80) }, async () => {
      const r = await start();
      return { post: r.post, href: `/director?id=${r.session.id}`, message: "Storyboard ready" };
    });
    return ok({ job });
  }
  return ok({ id: (await start()).session.id });
});

/** Timeline edits by hand: the whole scene list, in its new order. */
export const PUT = authed(async (req) => {
  const b = await body<{ id: string; scenes: Partial<VideoScene>[] }>(req);
  const session = await getSession(String(b.id ?? ""));
  if (!session) return fail("This conversation was deleted.", 404);
  if (!Array.isArray(b.scenes)) return fail("Send the scenes.");
  const owns = async (mid: string) => !!(await db().get<MediaItem>("media", mid));
  await setScenes(session, b.scenes, owns);
  return ok({ id: session.id });
});

export const DELETE = authed(async (req) => {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!(await getSession(id))) return fail("Conversation not found.", 404);
  await deleteSession(id);
  return ok({ ok: true });
});
