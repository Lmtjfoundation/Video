import { authed, body, fail, ok } from "@/lib/http-api";
import { createCheckout, type Interval } from "@/lib/billing";
import { appOrigin } from "@/lib/oauth";
import { PLANS, type PlanId } from "@/lib/plans";

export const dynamic = "force-dynamic";

export const POST = authed(async (req, user) => {
  const b = await body<{ plan: PlanId; interval: Interval }>(req);
  const plan = PLANS.find((p) => p.id === b.plan);
  if (!plan || plan.id === "free") return fail("Choose a paid plan.");
  return ok({ url: await createCheckout(user, plan.id, b.interval === "year" ? "year" : "month", appOrigin(req)) });
});
