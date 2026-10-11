import { PLANS, CREDIT_COST, CREDIT_LABEL } from "@/lib/plans";
import { priceFor, stripeReady } from "@/lib/billing";

export const dynamic = "force-dynamic";

/** Public plan list for the pricing page. */
export async function GET() {
  const plans = await Promise.all(
    PLANS.map(async (p) => ({ ...p, checkout: { month: !!(await priceFor(p.id, "month")), year: !!(await priceFor(p.id, "year")) } })),
  );
  return Response.json({
    plans,
    credits: Object.entries(CREDIT_COST).map(([k, v]) => ({ action: k, credits: v, label: CREDIT_LABEL[k as keyof typeof CREDIT_LABEL] })),
    payments: await stripeReady(),
  });
}
