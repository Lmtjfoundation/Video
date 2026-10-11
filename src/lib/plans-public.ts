import "server-only";
import { CREDIT_COST, CREDIT_LABEL, PLANS } from "./plans";
import { priceFor, stripeReady } from "./billing";

/** Public plan list (pricing page + /api/plans): which plans can be bought right now, monthly and yearly. */
export async function plansPayload() {
  const plans = await Promise.all(
    PLANS.map(async (p) => ({ ...p, checkout: { month: !!(await priceFor(p.id, "month")), year: !!(await priceFor(p.id, "year")) } })),
  );
  return {
    plans,
    credits: Object.entries(CREDIT_COST).map(([k, v]) => ({ action: k, credits: v, label: CREDIT_LABEL[k as keyof typeof CREDIT_LABEL] })),
    payments: await stripeReady(),
  };
}
