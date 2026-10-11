import { handleStripeEvent, verifyStripeSignature } from "@/lib/billing";
import { stripeWebhookSecret } from "@/lib/integrations";

export const dynamic = "force-dynamic";

/**
 * Stripe → app. "Connect Stripe" in Admin → App settings registers this URL in Stripe and stores its signing
 * secret automatically (STRIPE_WEBHOOK_SECRET in the environment overrides it).
 */
export async function POST(req: Request) {
  const secret = await stripeWebhookSecret();
  if (!secret) return new Response("Webhook secret not set", { status: 500 });
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"), secret)) return new Response("Bad signature", { status: 400 });
  try {
    const result = await handleStripeEvent(JSON.parse(payload));
    return Response.json({ received: true, result });
  } catch (e) {
    console.error("[nexus:stripe]", e);
    return new Response("Handler error", { status: 500 }); // Stripe retries
  }
}
