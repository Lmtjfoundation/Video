import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { gdb } from "./db";
import { addPackCredits, getUser, listUsers, saveUser, trialEligible, type User } from "./auth";
import { PLANS, introDiscount, packById, planById, type PlanId } from "./plans";
import { nowIso } from "./utils";
import { getIntegrations, saveIntegrations, stripeIntroCoupon, stripePortalConfig, stripePriceId, stripeSecretKey } from "./integrations";

/**
 * Stripe Billing over Stripe's REST API (no SDK needed).
 * Configure it in Admin → App settings → Integrations → "Connect Stripe": paste a secret key and the app creates
 * the products, monthly + yearly prices, the webhook and the customer-portal settings itself.
 * Environment variables (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_<PLAN>_<MONTHLY|ANNUAL>) override.
 */
const API = "https://api.stripe.com/v1";
export type Interval = "month" | "year";

export const stripeReady = async () => !!(await stripeSecretKey());
export const priceFor = async (plan: PlanId, interval: Interval) => (await stripePriceId(plan, interval)) || null;

async function planForPrice(priceId: string): Promise<{ plan: PlanId; interval: Interval } | null> {
  for (const p of PLANS) for (const i of ["month", "year"] as Interval[]) if ((await priceFor(p.id, i)) === priceId) return { plan: p.id, interval: i };
  return null;
}

/** Flattens nested params (objects and arrays) into Stripe's form encoding: a[b][0][c]=v */
function form(obj: Record<string, unknown>, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripeWith<T>(key: string, path: string, params: Record<string, unknown> = {}, method = "POST"): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "GET" ? undefined : form(params),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe: ${data.error?.message ?? res.status}`);
  return data;
}

async function stripe<T>(path: string, params: Record<string, unknown> = {}, method = "POST"): Promise<T> {
  const key = await stripeSecretKey();
  if (!key) throw new Error("Payments aren't set up yet. The admin connects Stripe in Admin → App settings.");
  return stripeWith<T>(key, path, params, method);
}

export async function createCheckout(user: User, plan: PlanId, interval: Interval, origin: string) {
  if (!(await stripeReady())) throw new Error("Payments aren't set up yet. Ask the admin to connect Stripe.");
  const price = await priceFor(plan, interval);
  if (!price) throw new Error(`The ${plan} ${interval === "year" ? "yearly" : "monthly"} price isn't set up yet. The admin presses "Connect Stripe" in Admin → App settings.`);
  const offer = await trialOffer(user, plan, interval);
  const params = (withCustomer: boolean) => ({
    mode: "subscription",
    line_items: { 0: { price, quantity: 1 } },
    success_url: `${origin}/plans?checkout=success${offer ? "&trial=1" : ""}`,
    cancel_url: `${origin}/plans?checkout=cancelled`,
    client_reference_id: user.id,
    ...(withCustomer && user.billing?.customerId ? { customer: user.billing.customerId } : { customer_email: user.email }),
    // Stripe allows either a fixed discount or customer promo codes on one checkout, not both.
    ...(offer?.coupon ? { discounts: { 0: { coupon: offer.coupon } } } : { allow_promotion_codes: "true" }),
    ...(offer ? { payment_method_collection: "always" } : {}),
    metadata: { userId: user.id, ...(offer ? { trial: "1" } : {}) },
    subscription_data: {
      metadata: { userId: user.id },
      ...(offer
        ? {
            trial_period_days: offer.days,
            // No card on file when the trial ends: cancel instead of leaving an unpaid invoice.
            trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
          }
        : {}),
    },
  });
  try {
    return (await stripe<{ url: string }>("/checkout/sessions", params(true))).url;
  } catch (e) {
    // A customer saved in test mode doesn't exist in live mode (or was deleted in Stripe): start fresh.
    if (user.billing?.customerId && /No such customer/i.test((e as Error).message)) {
      return (await stripe<{ url: string }>("/checkout/sessions", params(false))).url;
    }
    throw e;
  }
}

/**
 * One-time checkout for a credit pack. The price is sent with the checkout (no Stripe product to set up first), and
 * card is the only method so the payment is settled when the webhook arrives. Works on any plan, including Free.
 */
export async function createPackCheckout(user: User, packId: string, origin: string) {
  if (!(await stripeReady())) throw new Error("Payments aren't set up yet. Ask the admin to connect Stripe.");
  const pack = packById(packId);
  if (!pack) throw new Error("Choose a credit pack.");
  const params = (withCustomer: boolean) => ({
    mode: "payment",
    payment_method_types: { 0: "card" },
    line_items: {
      0: {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: pack.price * 100,
          product_data: { name: `Ghost Post ${pack.credits.toLocaleString("en-US")} AI credits` },
        },
      },
    },
    success_url: `${origin}/plans?checkout=credits`,
    cancel_url: `${origin}/plans?checkout=cancelled`,
    client_reference_id: user.id,
    ...(withCustomer && user.billing?.customerId ? { customer: user.billing.customerId } : { customer_email: user.email }),
    payment_intent_data: { statement_descriptor_suffix: "CREDITS" },
    metadata: { userId: user.id, pack: pack.id, credits: String(pack.credits) },
  });
  try {
    return (await stripe<{ url: string }>("/checkout/sessions", params(true))).url;
  } catch (e) {
    if (user.billing?.customerId && /No such customer/i.test((e as Error).message)) {
      return (await stripe<{ url: string }>("/checkout/sessions", params(false))).url;
    }
    throw e;
  }
}

/**
 * The free-trial offer for this checkout, or null. Each account gets one trial (Pro or Unlimited): `days` free, then
 * the first paid month at the plan's intro price (monthly billing, via a coupon "Connect Stripe" creates), then the
 * normal price. Yearly checkouts get the free days without the intro month.
 */
export async function trialOffer(user: User, plan: PlanId, interval: Interval) {
  const p = planById(plan);
  if (!p.trial || !trialEligible(user)) return null;
  const coupon = interval === "month" && introDiscount(p) > 0 ? await stripeIntroCoupon(p.id) : "";
  return { days: p.trial.days, coupon: coupon || null, firstMonth: coupon ? p.trial.firstMonth : null };
}

export async function createPortal(user: User, origin: string) {
  if (!(await stripeReady())) throw new Error("Payments aren't set up yet.");
  if (!user.billing?.customerId) throw new Error("You don't have a paid subscription yet.");
  const configuration = await stripePortalConfig();
  const s = await stripe<{ url: string }>("/billing_portal/sessions", {
    customer: user.billing.customerId,
    return_url: `${origin}/plans`,
    ...(configuration ? { configuration } : {}),
  });
  return s.url;
}

/** Cancels a subscription immediately (used when an account is deleted). */
export async function cancelSubscription(subscriptionId: string) {
  if (!(await stripeReady())) return;
  await stripe(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {}, "DELETE");
}

/* ───────────── One-click setup ───────────── */

interface StripeList<T> {
  data: T[];
}
interface SProduct {
  id: string;
  metadata?: Record<string, string>;
  statement_descriptor?: string | null;
}
/** What subscribers see on their card statement for these plans (max 22 characters, letters required). */
const STATEMENT_DESCRIPTOR = "GHOST POST";
interface SPrice {
  id: string;
  unit_amount: number | null;
  currency: string;
  recurring?: { interval: string } | null;
}
interface SHook {
  id: string;
  url: string;
  secret?: string;
}
interface SPortal {
  id: string;
  metadata?: Record<string, string>;
}

const planAmount = (p: { monthly: number; annual: number }, interval: Interval) => Math.round((interval === "month" ? p.monthly : p.annual * 12) * 100);

/**
 * True when the prices or first-month coupons saved by "Connect Stripe" no longer match plans.ts (the prices were
 * changed), so checkout would still charge the old amounts. Prices managed through environment variables are left alone.
 */
/** True when Stripe sends events to another address than `appUrl` (the app moved), or the saved webhook is gone. */
export async function stripeWebhookMoved(appUrl: string): Promise<boolean> {
  const key = await stripeSecretKey();
  const saved = await getIntegrations();
  if (!key || !saved.stripeWebhookId) return false;
  const hook = await stripeWith<{ url?: string; status?: string }>(key, `/webhook_endpoints/${encodeURIComponent(saved.stripeWebhookId)}`, {}, "GET").catch(() => null);
  return !hook?.url || hook.url !== `${appUrl.replace(/\/+$/, "")}/api/stripe/webhook`;
}

export async function stripePricesStale(): Promise<boolean> {
  const key = await stripeSecretKey();
  const saved = await getIntegrations();
  if (!key || !saved.stripePrices) return false;
  const get = <T>(path: string) => stripeWith<T>(key, path, {}, "GET").catch(() => null);
  for (const p of PLANS.filter((x) => x.monthly > 0)) {
    for (const interval of ["month", "year"] as Interval[]) {
      const id = saved.stripePrices[`${p.id}_${interval}`];
      if (!id) return true;
      const price = await get<{ unit_amount: number | null; active?: boolean }>(`/prices/${encodeURIComponent(id)}`);
      if (!price || price.active === false || price.unit_amount !== planAmount(p, interval)) return true;
    }
    const off = introDiscount(p);
    if (p.trial && off > 0) {
      const id = saved.stripeCoupons?.[p.id];
      if (!id) return true;
      const coupon = await get<{ amount_off: number | null; valid?: boolean }>(`/coupons/${encodeURIComponent(id)}`);
      if (!coupon || coupon.valid === false || coupon.amount_off !== Math.round(off * 100)) return true;
    }
  }
  return false;
}

/**
 * Creates (or reuses) everything subscriptions need in the owner's Stripe account:
 * one product per paid plan, a monthly and a yearly USD price each, a webhook pointed at this app (its signing
 * secret is captured on creation) and a customer-portal configuration that allows plan changes, card updates,
 * invoices and cancel-at-period-end. Safe to run again: existing Ghost Post products/prices are reused.
 */
export async function setupStripeBilling(secretKey: string, appUrl: string, opts: { keepWebhook?: boolean } = {}) {
  const sk = secretKey.trim();
  if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]+/.test(sk)) throw new Error("That isn't a Stripe secret key. It starts with sk_live_ or sk_test_ (Stripe → Developers → API keys).");
  if (!/^https:\/\//.test(appUrl)) throw new Error("APP_URL must be your public https address so Stripe can reach the webhook.");
  const base = appUrl.replace(/\/$/, "");
  const call = <T>(path: string, params?: Record<string, unknown>, method = "POST") => stripeWith<T>(sk, path, params ?? {}, method);
  const mode = sk.includes("_live_") ? "live" : "test";

  // Products + prices
  const products = await call<StripeList<SProduct>>("/products?limit=100&active=true", undefined, "GET");
  const stripePrices: Record<string, string> = {};
  const stripeProducts: Record<string, string> = {};
  const stripeCoupons: Record<string, string> = {};
  const portalProducts: { product: string; prices: string[] }[] = [];
  for (const p of PLANS.filter((x) => x.monthly > 0)) {
    // Products made before the rename carry their plan as nexus_plan; reuse them instead of making duplicates.
    let prod = products.data.find((x) => (x.metadata?.ghost_post_plan ?? x.metadata?.nexus_plan) === p.id);
    if (!prod) {
      prod = await call<SProduct>("/products", {
        name: `Ghost Post ${p.name}`,
        description: p.blurb,
        statement_descriptor: STATEMENT_DESCRIPTOR,
        metadata: { ghost_post_plan: p.id, app: "ghost-post" },
      });
    } else if (prod.statement_descriptor !== STATEMENT_DESCRIPTOR) {
      prod = await call<SProduct>(`/products/${prod.id}`, { statement_descriptor: STATEMENT_DESCRIPTOR });
    }
    stripeProducts[p.id] = prod.id;
    const existing = await call<StripeList<SPrice>>(`/prices?product=${encodeURIComponent(prod.id)}&active=true&limit=100`, undefined, "GET");
    const ids: string[] = [];
    for (const interval of ["month", "year"] as Interval[]) {
      const amount = planAmount(p, interval);
      let price = existing.data.find((x) => x.recurring?.interval === interval && x.unit_amount === amount && x.currency === "usd");
      if (!price) {
        price = await call<SPrice>("/prices", {
          product: prod.id,
          currency: "usd",
          unit_amount: amount,
          recurring: { interval },
          nickname: `${p.name} ${interval === "month" ? "monthly" : "yearly"}`,
          metadata: { ghost_post_plan: p.id, ghost_post_interval: interval },
        });
      }
      stripePrices[`${p.id}_${interval}`] = price.id;
      ids.push(price.id);
    }
    portalProducts.push({ product: prod.id, prices: ids });

    // Trial plans: a coupon that takes the first paid month down to the intro price. It lasts one month from the
    // day the subscription starts, so it covers the invoice at the end of the 14-day trial and nothing after it.
    const off = introDiscount(p);
    if (p.trial && off > 0) {
      // The id carries the amount and product, so a price change or a recreated product gets a fresh coupon.
      let couponId = `ghost_post_${p.id}_intro_${Math.round(off * 100)}_${prod.id.slice(-8)}`;
      const found = await call<{ id: string; valid?: boolean }>(`/coupons/${couponId}`, undefined, "GET").catch(() => null);
      if (!found?.id || found.valid === false) {
        if (found?.id) couponId = `${couponId}_${Date.now().toString(36)}`; // an expired/deleted coupon keeps its id
        await call("/coupons", {
          id: couponId,
          name: `${p.name}: first month $${p.trial.firstMonth}`,
          amount_off: Math.round(off * 100),
          currency: "usd",
          duration: "repeating",
          duration_in_months: 1,
          applies_to: { products: { 0: prod.id } },
          metadata: { ghost_post_plan: p.id, app: "ghost-post" },
        });
      }
      stripeCoupons[p.id] = couponId;
    }
  }

  // Webhook: recreate ours so the signing secret (only returned at creation) is captured. An automatic price refresh
  // (keepWebhook) leaves a working webhook alone, so no events are missed while it is swapped.
  const url = `${base}/api/stripe/webhook`;
  const stored = await getIntegrations();
  let hook: SHook;
  if (opts.keepWebhook && stored.stripeWebhookId && stored.stripeWebhookSecret) {
    hook = { id: stored.stripeWebhookId, url, secret: stored.stripeWebhookSecret };
  } else {
    const hooks = await call<StripeList<SHook>>("/webhook_endpoints?limit=100", undefined, "GET");
    // Ours at this address, and the one saved for an old address (the app moved): Stripe can't follow a redirect.
    for (const h of hooks.data.filter((x) => x.url === url || x.id === stored.stripeWebhookId)) await call(`/webhook_endpoints/${h.id}`, {}, "DELETE");
    hook = await call<SHook>("/webhook_endpoints", {
      url,
      enabled_events: ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"],
      description: "Ghost Post subscriptions",
      metadata: { app: "ghost-post" },
    });
    if (!hook.secret) throw new Error("Stripe didn't return the webhook signing secret. Try again.");
  }

  // Customer portal: plan switching between the three paid plans (monthly/yearly), cards, invoices, cancel.
  const portalParams = {
    business_profile: {
      headline: "Manage your Ghost Post subscription",
      privacy_policy_url: `${base}/privacy`,
      terms_of_service_url: `${base}/terms`,
    },
    default_return_url: `${base}/plans`,
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ["email", "name"] },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: { enabled: true, default_allowed_updates: ["price"], proration_behavior: "create_prorations", products: portalProducts },
    },
    metadata: { app: "ghost-post" },
  };
  const portals = await call<StripeList<SPortal>>("/billing_portal/configurations?active=true&limit=100", undefined, "GET");
  const mine = portals.data.find((x) => x.metadata?.app === "ghost-post" || x.metadata?.app === "nexus-pulse");
  const portal = mine
    ? await call<SPortal>(`/billing_portal/configurations/${mine.id}`, portalParams)
    : await call<SPortal>("/billing_portal/configurations", portalParams);

  await saveIntegrations({
    stripeSecretKey: sk,
    stripeWebhookSecret: hook.secret,
    stripeWebhookId: hook.id,
    stripePortalConfig: portal.id,
    stripePrices,
    stripeProducts,
    stripeCoupons,
    stripeMode: mode,
  });
  return { mode, prices: Object.keys(stripePrices).length, coupons: Object.keys(stripeCoupons).length, webhook: url, portal: portal.id };
}

/** Removes the saved Stripe settings (the products stay in Stripe). */
export async function disconnectStripe() {
  await saveIntegrations({ stripeSecretKey: "", stripeWebhookSecret: "", stripeWebhookId: "", stripePortalConfig: "", stripePrices: null, stripeProducts: null, stripeCoupons: null, stripeMode: "" });
}

/* ───────────── Webhooks ───────────── */

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
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  current_period_end?: number;
  trial_end?: number | null;
  items?: { data?: { price?: { id: string; metadata?: Record<string, string>; recurring?: { interval?: string } | null }; current_period_end?: number }[] };
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

  if (evt.type === "checkout.session.completed" && o.mode === "payment") {
    // A credit pack. The pack id from metadata decides the credits (not the amount field), and only a paid session counts.
    const meta = (o.metadata ?? {}) as { userId?: string; pack?: string };
    const pack = packById(meta.pack);
    const userId = String(o.client_reference_id ?? meta.userId ?? "");
    if (pack && o.payment_status === "paid" && [pack.price, ...(pack.legacyPrices ?? [])].some((d) => o.amount_subtotal === d * 100)) await addPackCredits(userId, pack.credits);
  } else if (evt.type === "checkout.session.completed") {
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
      let mapped = item?.price?.id ? await planForPrice(item.price.id) : null;
      // Fallback: prices created by "Connect Stripe" carry their plan in metadata (covers older/replaced prices).
      const metaPlan = item?.price?.metadata?.ghost_post_plan ?? item?.price?.metadata?.nexus_plan;
      if (!mapped && metaPlan && PLANS.some((p) => p.id === metaPlan && p.monthly > 0)) {
        mapped = { plan: metaPlan as PlanId, interval: item?.price?.recurring?.interval === "year" ? "year" : "month" };
      }
      const end = item?.current_period_end ?? sub.current_period_end;
      u.billing = {
        ...(u.billing ?? {}),
        customerId: sub.customer,
        subscriptionId: sub.id,
        status: sub.status,
        interval: mapped?.interval,
        currentPeriodEnd: end ? new Date(end * 1000).toISOString() : undefined,
        cancelAtPeriodEnd: !!(sub.cancel_at_period_end || sub.cancel_at),
        trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : undefined,
        trialUsed: !!(u.billing?.trialUsed || sub.trial_end),
      };
      if (evt.type === "customer.subscription.deleted" || !ACTIVE.includes(sub.status)) u.plan = "free";
      else if (mapped) u.plan = mapped.plan;
      await saveUser(u);
    }
  }

  await gdb().upsert("billing_events", { id: evt.id, type: evt.type, at: nowIso() });
  return "ok";
}
