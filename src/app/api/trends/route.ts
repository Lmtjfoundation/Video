import { authed, fail, ok } from "@/lib/http-api";
import { feedHealth, feedsFor, getTrends } from "@/lib/trends";
import { genreById } from "@/lib/genres";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Live stories for a genre, with the health of each feed behind it. `?refresh=1` re-reads the feeds (at most every 3 minutes). */
export const GET = authed(async (req) => {
  const q = new URL(req.url).searchParams;
  const genre = q.get("genre") || "trending";
  if (!genreById(genre)) return fail("Unknown genre.");
  let res = await getTrends(genre);
  if (q.get("refresh") === "1" && (!res.fetchedAt || Date.now() - Date.parse(res.fetchedAt) > 3 * 60_000)) res = await getTrends(genre, { force: true });
  const health = await feedHealth();
  const feeds = (await feedsFor(genre)).map((f) => ({ id: f.id, name: f.name, tier: f.tier, health: health[f.id] ?? null }));
  return ok({ genre, ...res, feeds });
});
