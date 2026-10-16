import { authed, body, fail, ok } from "@/lib/http-api";
import { customFeeds, saveCustomFeeds, type CustomFeed } from "@/lib/trends";
import { genreById, type FeedTier } from "@/lib/genres";
import { webhookUrlProblem } from "@/lib/platforms/webhook-guard";

export const dynamic = "force-dynamic";

/** Admin: extra news feeds per genre (add a newsroom, or replace a feed whose address changed). */
export const GET = authed(async () => ok(await customFeeds()), { admin: true });

export const PUT = authed(async (req) => {
  const b = await body<{ feeds?: { genre?: string; name?: string; url?: string; tier?: FeedTier }[] }>(req);
  const list: CustomFeed[] = [];
  for (const [i, f] of (b.feeds ?? []).entries()) {
    if (!genreById(f.genre)) return fail(`Feed ${i + 1}: unknown genre.`);
    const url = String(f.url ?? "").trim();
    const problem = webhookUrlProblem(url);
    if (problem) return fail(`Feed ${i + 1}: ${problem.replace("webhook address", "feed address")}`);
    list.push({ id: `custom_${i}_${Buffer.from(url).toString("base64url").slice(-10)}`, genre: f.genre!, name: String(f.name ?? "").trim().slice(0, 60) || new URL(url).hostname, url, tier: f.tier ?? "national" });
  }
  await saveCustomFeeds(list);
  return ok(list);
}, { admin: true });
