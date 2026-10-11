import { handleStripeEvent, verifyStripeSignature } from "@/lib/billing";

export const dynamic = "force-dynamic";

/** Stripe → app. Add this URL in Stripe → Developers → Webhooks, and put its signing secret in STRIPE_WEBHOOK_SECRET. */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
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
