import { PLANS, CREDIT_COST, CREDIT_LABEL } from "@/lib/plans";
import { priceFor, stripeReady } from "@/lib/billing";

export const dynamic = "force-dynamic";

/** Public plan list for the pricing page. */
export async function GET() {
  return Response.json({
    plans: PLANS.map((p) => ({ ...p, checkout: { month: !!priceFor(p.id, "month"), year: !!priceFor(p.id, "year") } })),
    credits: Object.entries(CREDIT_COST).map(([k, v]) => ({ action: k, credits: v, label: CREDIT_LABEL[k as keyof typeof CREDIT_LABEL] })),
    payments: stripeReady(),
  });
}
