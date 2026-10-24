import { authed, body, fail, ok } from "@/lib/http-api";
import { withCredits } from "@/lib/credits";
import { CHARACTER_LOOK_GROUPS, CHARACTER_LOOKS, getCharacters, listCharacters } from "@/lib/characters";
import { signedUrl } from "@/lib/media";
import { CREDIT_COST } from "@/lib/plans";
import { getPost, log } from "@/lib/repo";
import { PLATFORMS, type Platform } from "@/lib/types";
import { lengthAllowed, MOVIE_LENGTHS, MOVIE_SHAPE, type MovieLength } from "@/lib/video-spec";
import { deleteSeries, getSeries, listSeries, MAX_EPISODES, MIN_EPISODES, planSeries, saveSeries } from "@/lib/series";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Every series with each made episode's render state, plus the cast and styles to start a new one. */
export const GET = authed(async (_req, user) => {
  const list = await listSeries();
  const series = await Promise.all(
    list.map(async (s) => ({
      ...s,
      episodes: await Promise.all(
        s.episodes.map(async (e) => {
          const p = e.postId ? await getPost(e.postId) : null;
          return { ...e, made: p ? { status: p.render?.status ?? "plan", message: p.render?.message ?? "" } : null };
        }),
      ),
    })),
  );
  return ok({
    series,
    characters: (await listCharacters()).map((c) => ({ id: c.id, name: c.name, imageUrl: signedUrl(user.id, c.imageMediaId, 6 * 3600) })),
    lookGroups: CHARACTER_LOOK_GROUPS,
    lengths: MOVIE_LENGTHS.map((l) => ({ id: l, label: MOVIE_SHAPE[l].label })),
    credits: { plan: CREDIT_COST.filmDevelopLong },
    limits: { min: MIN_EPISODES, max: MAX_EPISODES },
  });
});

/** Plans a new series: the bible and every episode outline. */
export const POST = authed(async (req) => {
  const b = await body<{ premise?: string; episodes?: number; characterIds?: string[]; look?: string; platform?: Platform; length?: MovieLength }>(req);
  const premise = String(b.premise ?? "").trim();
  if (premise.length < 20) return fail("Describe the series in a few sentences, or paste your story bible.");
  const platform = PLATFORMS.includes(b.platform as Platform) && b.platform !== "webhook" ? (b.platform as Platform) : "tiktok";
  const length = MOVIE_LENGTHS.includes(b.length as MovieLength) ? (b.length as MovieLength) : "m3";
  if (!lengthAllowed(length, platform)) return fail("X allows videos up to 2 minutes 20 seconds. Pick a shorter episode length for X.");
  const cast = await getCharacters(Array.isArray(b.characterIds) ? b.characterIds.slice(0, 6) : []);
  const look = String(b.look ?? "").trim().slice(0, 160) || cast[0]?.look || CHARACTER_LOOKS[0];
  const s = await withCredits(CREDIT_COST.filmDevelopLong, () =>
    planSeries({ premise, episodes: Number(b.episodes) || 10, characterIds: cast.map((c) => c.id), look, platform, length }),
  );
  await log("info", "generate", `Series planned: “${s.title}” (${s.episodes.length} episodes)`);
  return ok(s);
});

/** Edits the title, logline, bible or an episode's title, outline or hook. */
export const PATCH = authed(async (req) => {
  const b = await body<{ id: string; title?: string; logline?: string; bible?: string; episode?: { n: number; title?: string; outline?: string; hook?: string } }>(req);
  const s = await getSeries(String(b.id ?? ""));
  if (!s) return fail("Series not found.", 404);
  if (typeof b.title === "string") s.title = b.title.slice(0, 120);
  if (typeof b.logline === "string") s.logline = b.logline.slice(0, 400);
  if (typeof b.bible === "string") s.bible = b.bible.slice(0, 6000);
  if (b.episode) {
    const ep = s.episodes.find((e) => e.n === b.episode!.n);
    if (!ep) return fail("Episode not found.", 404);
    if (typeof b.episode.title === "string") ep.title = b.episode.title.slice(0, 80);
    if (typeof b.episode.outline === "string") ep.outline = b.episode.outline.slice(0, 3000);
    if (typeof b.episode.hook === "string") ep.hook = b.episode.hook.slice(0, 400);
  }
  return ok(await saveSeries(s));
});

export const DELETE = authed(async (req) => {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!(await getSeries(id))) return fail("Series not found.", 404);
  await deleteSeries(id);
  return ok({ ok: true });
});
