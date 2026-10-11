import { authed, body, ok } from "@/lib/http-api";
import { db } from "@/lib/db";
import { requireFeature, withCredits } from "@/lib/credits";
import { CREDIT_COST } from "@/lib/plans";
import { researchNiches } from "@/lib/stories";
import { log } from "@/lib/repo";
import type { NicheReport, Story } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = authed(async () => ok(await db().all<NicheReport>("reports", 50)));

export const POST = authed(async (req, user) => {
  requireFeature(user, "nicheResearch", "Niche research");
  const b = await body<Partial<NicheReport["input"]>>(req);
  const input = {
    interests: String(b.interests ?? "").slice(0, 600),
    platform: String(b.platform ?? "YouTube long-form").slice(0, 60),
    hours: String(b.hours ?? "3–8 hours").slice(0, 40),
    goal: String(b.goal ?? "Highest revenue per view").slice(0, 60),
  };
  const titles = (await db().all<Story>("stories", 20)).map((s) => s.out.titles?.[0]?.title ?? "").filter(Boolean);
  const rep = await withCredits(CREDIT_COST.niche, () => researchNiches(input, titles));
  await log("info", "generate", `Niche research: ${rep.niches.map((n) => n.name).join(", ")}`);
  return ok(rep);
});
