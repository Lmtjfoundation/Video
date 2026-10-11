import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { gdb } from "./db";
import { getUser, listUsers, saveUser, type User } from "./auth";
import { PLANS, type PlanId } from "./plans";
import { nowIso } from "./utils";

/**
 * Stripe Billing over Stripe's REST API (no SDK needed).
 * Create one Product per paid plan in Stripe with a monthly and a yearly recurring Price, then set:
 *   STRIPE_PRICE_CREATOR_MONTHLY, STRIPE_PRICE_CREATOR_ANNUAL, STRIPE_PRICE_PRO_MONTHLY, …
 */
const API = "https://api.stripe.com/v1";
export const stripeReady = () => !!process.env.STRIPE_SECRET_KEY;
export type Interval = "month" | "year";

const envKey = (plan: PlanId, interval: Interval) => `STRIPE_PRICE_${plan.toUpperCase()}_${interval === "year" ? "ANNUAL" : "MONTHLY"}`;
export const priceFor = (plan: PlanId, interval: Interval) => process.env[envKey(plan, interval)] ?? null;

function planForPrice(priceId: string): { plan: PlanId; interval: Interval } | null {
  for (const p of PLANS) for (const i of ["month", "year"] as Interval[]) if (priceFor(p.id, i) === priceId) return { plan: p.id, interval: i };
  return null;
}

/** Flattens nested params into Stripe's form encoding: a[b][0][c]=v */
function form(obj: Record<string, unknown>, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe<T>(path: string, params: Record<string, unknown> = {}, method = "POST"): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "GET" ? undefined : form(params),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe: ${data.error?.message ?? res.status}`);
  return data;
}

export async function createCheckout(user: User, plan: PlanId, interval: Interval, origin: string) {
  if (!stripeReady()) throw new Error("Payments aren't set up yet. Ask the admin to add Stripe keys.");
  const price = priceFor(plan, interval);
  if (!price) throw new Error(`No Stripe price is set for ${plan} (${interval}ly). Add ${envKey(plan, interval)}.`);
  const s = await stripe<{ url: string }>("/checkout/sessions", {
    mode: "subscription",
    line_items: { 0: { price, quantity: 1 } },
    success_url: `${origin}/plans?checkout=success`,
    cancel_url: `${origin}/plans?checkout=cancelled`,
    client_reference_id: user.id,
    ...(user.billing?.customerId ? { customer: user.billing.customerId } : { customer_email: user.email }),
    allow_promotion_codes: "true",
    metadata: { userId: user.id },
    subscription_data: { metadata: { userId: user.id } },
  });
  return s.url;
}

export async function createPortal(user: User, origin: string) {
  if (!stripeReady()) throw new Error("Payments aren't set up yet.");
  if (!user.billing?.customerId) throw new Error("You don't have a paid subscription yet.");
  const s = await stripe<{ url: string }>("/billing_portal/sessions", { customer: user.billing.customerId, return_url: `${origin}/plans` });
  return s.url;
}

/** Cancels a subscription immediately (used when an account is deleted). */
export async function cancelSubscription(subscriptionId: string) {
  if (!stripeReady()) return;
  await stripe(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {}, "DELETE");
}

/** Verifies the Stripe-Signature header (HMAC-SHA256 over "timestamp.payload"), 5-minute tolerance. */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, toleranceSec = 300) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return header
    .split(",")
    .filter((kv) => kv.startsWith("v1="))
    .some((kv) => {
      const got = Buffer.from(kv.slice(3));
      const want = Buffer.from(expected);
      return got.length === want.length && timingSafeEqual(got, want);
    });
}

interface StripeSub {
  id: string;
  customer: string;
  status: string;
  current_period_end?: number;
  items?: { data?: { price?: { id: string }; current_period_end?: number }[] };
  metadata?: { userId?: string };
}

async function userForSub(sub: StripeSub) {
  if (sub.metadata?.userId) return getUser(sub.metadata.userId);
  return (await listUsers()).find((u) => u.billing?.customerId === sub.customer) ?? null;
}

const ACTIVE = ["active", "trialing", "past_due"];

/** Applies a Stripe webhook event. Idempotent: each event id is processed once. */
export async function handleStripeEvent(evt: { id: string; type: string; data: { object: Record<string, unknown> } }) {
  if (await gdb().get("billing_events", evt.id)) return "duplicate";
  const o = evt.data.object;

  if (evt.type === "checkout.session.completed") {
    const u = await getUser(String(o.client_reference_id ?? (o.metadata as { userId?: string })?.userId ?? ""));
    if (u) {
      u.billing = { ...(u.billing ?? {}), customerId: String(o.customer ?? ""), subscriptionId: String(o.subscription ?? "") };
      await saveUser(u);
    }
  }

  if (evt.type.startsWith("customer.subscription.")) {
    const sub = o as unknown as StripeSub;
    const u = await userForSub(sub);
    if (u) {
      const item = sub.items?.data?.[0];
      const mapped = item?.price?.id ? planForPrice(item.price.id) : null;
      const end = item?.current_period_end ?? sub.current_period_end;
      u.billing = {
        ...(u.billing ?? {}),
        customerId: sub.customer,
        subscriptionId: sub.id,
        status: sub.status,
        interval: mapped?.interval,
        currentPeriodEnd: end ? new Date(end * 1000).toISOString() : undefined,
      };
      if (evt.type === "customer.subscription.deleted" || !ACTIVE.includes(sub.status)) u.plan = "free";
      else if (mapped) u.plan = mapped.plan;
      await saveUser(u);
    }
  }

  await gdb().upsert("billing_events", { id: evt.id, type: evt.type, at: nowIso() });
  return "ok";
}
