import "server-only";
import { CREDIT_COST, CREDIT_LABEL, PLANS } from "./plans";
import { priceFor, stripeReady } from "./billing";
import { stripeIntroCoupon } from "./integrations";

/**
 * Public plan list (pricing page + /api/plans): which plans can be bought right now, monthly and yearly, and
 * whether the discounted first month after the free trial is live (it needs "Connect Stripe" to have run since
 * trials were added, which creates the coupon). Without the coupon the free days still work, and the page
 * doesn't advertise an intro price it can't charge.
 */
export async function plansPayload() {
  const plans = await Promise.all(
    PLANS.map(async (p) => ({
      ...p,
      checkout: { month: !!(await priceFor(p.id, "month")), year: !!(await priceFor(p.id, "year")) },
      introReady: !!p.trial && !!(await stripeIntroCoupon(p.id)),
    })),
  );
  return {
    plans,
    credits: Object.entries(CREDIT_COST).map(([k, v]) => ({ action: k, credits: v, label: CREDIT_LABEL[k as keyof typeof CREDIT_LABEL] })),
    payments: await stripeReady(),
  };
}
