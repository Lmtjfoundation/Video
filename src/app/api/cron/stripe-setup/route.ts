import { cronAuthorized, fail, handle, ok } from "@/lib/http-api";
import { getIntegrations } from "@/lib/integrations";
import { setupStripeBilling } from "@/lib/billing";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Runs once at server start (built-in scheduler): when STRIPE_SECRET_KEY is set on the server but Stripe hasn't
 * been connected yet, it does the same one-click setup as Admin → Integrations → "Connect Stripe".
 */
export const GET = handle(async (req: Request) => {
  if (!cronAuthorized(req)) return fail("Unauthorized", 401);
  const key = process.env.STRIPE_SECRET_KEY;
  const appUrl = process.env.APP_URL ?? "";
  const i = await getIntegrations();
  if (!key) return ok({ skipped: "no STRIPE_SECRET_KEY" });
  if (i.stripeSecretKey || i.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET) return ok({ skipped: "already connected" });
  if (!appUrl.startsWith("https://")) return ok({ skipped: "APP_URL must be https" });
  const r = await setupStripeBilling(key, appUrl);
  console.log(`[stripe] connected automatically in ${r.mode} mode: ${r.prices} prices, webhook ${r.webhook}`);
  return ok(r);
});
