import { cronAuthorized, fail, handle, ok } from "@/lib/http-api";
import { getIntegrations, stripeSecretKey } from "@/lib/integrations";
import { setupStripeBilling, stripePricesStale } from "@/lib/billing";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Runs once at server start (built-in scheduler):
 * - STRIPE_SECRET_KEY is set on the server but Stripe hasn't been connected yet: does the same one-click setup as
 *   Admin → Integrations → "Connect Stripe".
 * - Stripe is connected but the plan prices or first-month coupons in plans.ts changed: creates the new prices and
 *   coupons so checkout charges what the pricing page shows. Old prices stay active, so current subscribers keep theirs.
 */
export const GET = handle(async (req: Request) => {
  if (!cronAuthorized(req)) return fail("Unauthorized", 401);
  // This server was moved: the new one runs the schedule, so nothing is posted twice.
  if (await (await import("@/lib/migrate")).movedTo()) return ok({ skipped: "moved" });
  const key = await stripeSecretKey();
  const appUrl = process.env.APP_URL ?? "";
  const i = await getIntegrations();
  if (!key) return ok({ skipped: "no Stripe key" });
  const connected = !!(i.stripeSecretKey || i.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET);
  if (!connected) {
    if (!appUrl.startsWith("https://")) return ok({ skipped: "APP_URL must be https" });
    const r = await setupStripeBilling(key, appUrl);
    console.log(`[stripe] connected automatically in ${r.mode} mode: ${r.prices} prices, webhook ${r.webhook}`);
    return ok(r);
  }
  if (!(await stripePricesStale())) return ok({ skipped: "prices up to date" });
  if (!appUrl.startsWith("https://")) return ok({ skipped: "prices changed, but APP_URL must be https to refresh them" });
  const r = await setupStripeBilling(key, appUrl, { keepWebhook: true });
  console.log(`[stripe] plan prices changed: created ${r.prices} current prices and ${r.coupons} coupons in ${r.mode} mode`);
  return ok(r);
});
