import { authed, body, fail, ok } from "@/lib/http-api";
import { withCredits } from "@/lib/credits";
import { CREDIT_COST } from "@/lib/plans";
import { getSettings, log, savePosts } from "@/lib/repo";
import { repurpose } from "@/lib/stories";
import { PLATFORMS, type Platform } from "@/lib/types";
import {
  deleteFilm, developFilm, FILM_FORMATS, FILM_GENRES, getFilm, listFilms, MAX_FILMS, promoSource, promoteFilm, reviewFilm, reviseFilm, saveFilm, writePages,
  type FilmFormat, type FilmProject,
} from "@/lib/writers-room";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Writers' Room projects. */
export const GET = authed(async () => ok({ films: await listFilms(), genres: FILM_GENRES, formats: FILM_FORMATS, max: MAX_FILMS }));

type Body = {
  action?: "develop" | "revise" | "pages" | "review" | "promo" | "promoPosts";
  id?: string;
  premise?: string;
  genre?: string;
  format?: FilmFormat;
  tone?: string;
  influences?: string;
  notes?: string;
  from?: number;
  to?: number;
  platforms?: Platform[];
};

const MAX_PAGES_AT_ONCE = 4;
const developCost = (f: FilmFormat) => (f === "short" ? CREDIT_COST.filmDevelop : CREDIT_COST.filmDevelopLong);

export const POST = authed(async (req: Request) => {
  const b = await body<Body>(req);
  if (b.action === "develop") {
    const premise = String(b.premise ?? "").trim();
    if (premise.length < 15) return fail("Describe your idea in a sentence or two: who it's about and what happens.");
    if ((await listFilms()).length >= MAX_FILMS) return fail(`You have ${MAX_FILMS} projects. Delete one to start another.`);
    const format = FILM_FORMATS.includes(b.format as FilmFormat) ? (b.format as FilmFormat) : "short";
    const genre = String(b.genre ?? "").trim().slice(0, 40) || "Drama";
    const f = await withCredits(developCost(format), () =>
      developFilm({ premise: premise.slice(0, 4000), genre, format, tone: String(b.tone ?? "").trim().slice(0, 200), influences: String(b.influences ?? "").trim().slice(0, 300) || undefined }),
    );
    await saveFilm(f);
    await log("info", "generate", `Writers' Room developed “${f.title}”`);
    return ok(f);
  }

  const film = b.id ? await getFilm(String(b.id)) : null;
  if (!film) return fail("That project wasn't found.", 404);
  let next: FilmProject;
  switch (b.action) {
    case "revise": {
      const notes = String(b.notes ?? "").trim();
      if (notes.length < 5) return fail("Write the notes to address, or use the review's fixes.");
      next = await withCredits(developCost(film.format), () => reviseFilm(film, notes.slice(0, 4000)));
      break;
    }
    case "pages": {
      const from = Math.max(1, Math.round(Number(b.from) || 1));
      const to = Math.min(film.scenes.length, Math.max(from, Math.round(Number(b.to) || from)), from + MAX_PAGES_AT_ONCE - 1);
      next = await withCredits(CREDIT_COST.filmPage * (to - from + 1), () => writePages(film, from, to));
      break;
    }
    case "review":
      next = await withCredits(CREDIT_COST.filmReview, () => reviewFilm(film));
      break;
    case "promo":
      next = await withCredits(CREDIT_COST.filmPromo, () => promoteFilm(film));
      break;
    case "promoPosts": {
      // Promotion posts as drafts on the chosen platforms, written from the promotion kit.
      if (!film.promo) return fail("Make the promotion kit first.");
      const platforms = (Array.isArray(b.platforms) ? b.platforms : []).filter((p): p is Platform => PLATFORMS.includes(p) && p !== "webhook").slice(0, 6);
      if (!platforms.length) return fail("Choose at least one platform.");
      const settings = await getSettings();
      const posts = await withCredits(CREDIT_COST.repurposePerPlatform * platforms.length, () => repurpose(promoSource(film), platforms, settings));
      await savePosts(posts);
      await log("info", "generate", `Promotion posts for “${film.title}” on ${platforms.join(", ")}`);
      return ok({ film, posts });
    }
    default:
      return fail("Unknown action.");
  }
  await saveFilm(next);
  return ok(next);
});

/** Small edits by hand: pick a title, edit the logline. */
export const PATCH = authed(async (req: Request) => {
  const b = await body<{ id?: string; title?: string; logline?: string }>(req);
  const film = b.id ? await getFilm(String(b.id)) : null;
  if (!film) return fail("That project wasn't found.", 404);
  if (typeof b.title === "string" && b.title.trim()) film.title = b.title.trim().slice(0, 120);
  if (typeof b.logline === "string" && b.logline.trim()) film.logline = b.logline.trim().slice(0, 600);
  return ok(await saveFilm(film));
});

export const DELETE = authed(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("Missing id.");
  await deleteFilm(id);
  return ok({ ok: true });
});
