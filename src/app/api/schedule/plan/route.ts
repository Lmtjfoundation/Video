import { body, authed, ok } from "@/lib/http-api";
import { planSlots } from "@/lib/scheduler";
import { getSettings } from "@/lib/repo";
import { withCredits } from "@/lib/credits";
import { CREDIT_COST } from "@/lib/plans";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = authed(async (req: Request) => {
  const { notes } = await body<{ notes?: string }>(req);
  const s = await getSettings();
  return ok(await withCredits(CREDIT_COST.plan, () => planSlots(s, notes?.slice(0, 600))));
});
