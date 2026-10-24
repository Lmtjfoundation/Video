import { authed, body, fail, ok } from "@/lib/http-api";
import { withCredits } from "@/lib/credits";
import { spendCredits } from "@/lib/auth";
import { isGraphicsLook } from "@/lib/looks";
import { picturesReady } from "@/lib/pictures";
import { enqueueRender, ffmpegAvailable } from "@/lib/render";
import { getSettings, log, savePost } from "@/lib/repo";
import { getSeries, saveSeries, writeEpisode } from "@/lib/series";
import { renderCredits, videoCredits } from "@/lib/video-spec";
import { nowIso } from "@/lib/utils";
import { startJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Writes one episode as a movie from the series bible and its outline, and (with renderNow) makes the video. */
export const POST = authed(async (req, user) => {
  const b = await body<{ id: string; n: number; renderNow?: boolean; background?: boolean }>(req);
  const s = await getSeries(String(b.id ?? ""));
  if (!s) return fail("Series not found.", 404);
  const ep = s.episodes.find((e) => e.n === Number(b.n));
  if (!ep) return fail("Episode not found.", 404);
  const series = s;
  const episode = ep;
  if (!isGraphicsLook(s.look) && !(await picturesReady())) return fail("Episodes need Ghost Post's engine for pictures. The admin connects it in Admin → App settings → Integrations.", 503);
  // In the background the person can leave the page; the jobs tray says when the video is ready.
  if (b.background) return ok({ job: await startJob(user.id, { kind: "episode", title: `${series.title}: Episode ${episode.n}` }, async () => { const r = await make(); return { post: r.post, href: "/series", message: r.note || undefined }; }) });
  return ok(await make());

  async function make() {
    const post = await withCredits(videoCredits(series.length, "plan"), async () => writeEpisode(series, episode.n, await getSettings()));
    let note = "";
    if (b.renderNow) {
      if (!(await ffmpegAvailable())) note = "Saved. Video rendering isn't switched on for this server yet (ffmpeg missing).";
      else {
        const credits = renderCredits(post.video);
        try {
          await spendCredits(user.id, credits);
          post.render = { status: "queued", progress: 0, message: "Waiting to render…", credits, updatedAt: nowIso() };
        } catch (e) {
          note = `Saved as a draft, not rendered: ${(e as Error).message}`;
        }
      }
    }
    await savePost(post);
    if (post.render?.status === "queued") enqueueRender(user.id, post.id, post.render.credits ?? 0);
    // Re-read: the series may have been edited while the episode was being written.
    const fresh = (await getSeries(series.id)) ?? series;
    const e = fresh.episodes.find((x) => x.n === episode.n);
    if (e) e.postId = post.id;
    await saveSeries(fresh);
    await log("info", "generate", `${series.title}: Episode ${episode.n} written`, { postId: post.id });
    return { post, note };
  }
});
