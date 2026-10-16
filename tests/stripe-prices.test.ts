import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PLANS, introDiscount } from "@/lib/plans";

const dir = mkdtempSync(path.join(tmpdir(), "nexus-stripe-"));
process.env.DATA_DIR = dir;
process.env.SETUP_CODE = "test-setup-code";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
delete process.env.SUPABASE_URL;
delete process.env.DATABASE_URL;
delete process.env.STRIPE_SECRET_KEY;

/** A tiny in-memory Stripe: just the endpoints "Connect Stripe" uses. */
function fakeStripe() {
  let n = 0;
  const products = new Map<string, Record<string, unknown>>();
  const prices = new Map<string, Record<string, unknown>>();
  const coupons = new Map<string, Record<string, unknown>>();
  const webhookCalls: string[] = [];
  const nested = (body: URLSearchParams) => {
    const o: Record<string, string> = {};
    body.forEach((v, k) => (o[k] = v));
    return o;
  };
  const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(String(url));
    const p = u.pathname.replace("/v1", "");
    const method = init?.method ?? "GET";
    const body = nested(new URLSearchParams(String(init?.body ?? "")));
    if (p === "/products" && method === "GET") return respond({ data: [...products.values()] });
    if (p === "/products" && method === "POST") {
      const id = `prod_${++n}`;
      const row = { id, metadata: { nexus_plan: body["metadata[nexus_plan]"] }, statement_descriptor: body.statement_descriptor };
      products.set(id, row);
      return respond(row);
    }
    if (p.startsWith("/products/") && method === "POST") return respond({ ...products.get(p.split("/")[2]), ...body });
    if (p === "/prices" && method === "GET") return respond({ data: [...prices.values()].filter((x) => x.product === u.searchParams.get("product")) });
    if (p === "/prices" && method === "POST") {
      const id = `price_${++n}`;
      const row = { id, product: body.product, currency: body.currency, unit_amount: Number(body.unit_amount), recurring: { interval: body["recurring[interval]"] }, active: true };
      prices.set(id, row);
      return respond(row);
    }
    if (p.startsWith("/prices/")) return prices.has(p.split("/")[2]) ? respond(prices.get(p.split("/")[2])) : respond({ error: { message: "No such price" } }, 404);
    if (p.startsWith("/coupons/") && method === "GET") return coupons.has(p.split("/")[2]) ? respond(coupons.get(p.split("/")[2])) : respond({ error: { message: "No such coupon" } }, 404);
    if (p === "/coupons" && method === "POST") {
      const row = { id: body.id, amount_off: Number(body.amount_off), valid: true };
      coupons.set(body.id, row);
      return respond(row);
    }
    if (p.startsWith("/webhook_endpoints")) {
      webhookCalls.push(`${method} ${p}`);
      return method === "GET" ? respond({ data: [] }) : respond({ id: "we_new", url: body.url, secret: "whsec_new" });
    }
    if (p.startsWith("/billing_portal/configurations")) return method === "GET" ? respond({ data: [] }) : respond({ id: "bpc_1" });
    return respond({ error: { message: `unexpected ${method} ${p}` } }, 500);
  });
  return { fetchFn, products, prices, coupons, webhookCalls };
}

afterEach(() => vi.unstubAllGlobals());
beforeAll(() => undefined);

describe("Stripe prices follow plans.ts", () => {
  it("detects stale prices, creates the new ones, keeps the working webhook, and then reports up to date", async () => {
    const stripe = fakeStripe();
    vi.stubGlobal("fetch", stripe.fetchFn);
    const { saveIntegrations } = await import("@/lib/integrations");
    const { setupStripeBilling, stripePricesStale } = await import("@/lib/billing");

    // An earlier "Connect Stripe" at the old prices.
    const OLD = { creator: [12, 10], pro: [29, 24], unlimited: [59, 49] } as const;
    const oldPrices: Record<string, string> = {};
    const oldProducts: Record<string, string> = {};
    for (const [plan, [m, a]] of Object.entries(OLD)) {
      const prod = `prod_old_${plan}`;
      stripe.products.set(prod, { id: prod, metadata: { nexus_plan: plan }, statement_descriptor: "GHOST POST" });
      oldProducts[plan] = prod;
      for (const [interval, amount] of [["month", m * 100], ["year", a * 12 * 100]] as const) {
        const id = `price_old_${plan}_${interval}`;
        stripe.prices.set(id, { id, product: prod, currency: "usd", unit_amount: amount, recurring: { interval }, active: true });
        oldPrices[`${plan}_${interval}`] = id;
      }
    }
    stripe.coupons.set("nexus_pro_intro_old", { id: "nexus_pro_intro_old", amount_off: 1900, valid: true });
    stripe.coupons.set("nexus_unlimited_intro_old", { id: "nexus_unlimited_intro_old", amount_off: 3900, valid: true });
    await saveIntegrations({
      stripeSecretKey: "sk_test_abc123",
      stripeWebhookSecret: "whsec_old",
      stripeWebhookId: "we_old",
      stripePrices: oldPrices,
      stripeProducts: oldProducts,
      stripeCoupons: { pro: "nexus_pro_intro_old", unlimited: "nexus_unlimited_intro_old" },
    });

    expect(await stripePricesStale()).toBe(true);

    const r = await setupStripeBilling("sk_test_abc123", "https://app.example.com", { keepWebhook: true });
    expect(r.prices).toBe(6);
    expect(stripe.webhookCalls.filter((c) => !c.startsWith("GET"))).toEqual([]); // the working webhook was not touched

    const { getIntegrations } = await import("@/lib/integrations");
    const saved = await getIntegrations();
    for (const p of PLANS.filter((x) => x.monthly > 0)) {
      expect(stripe.prices.get(saved.stripePrices![`${p.id}_month`])!.unit_amount).toBe(p.monthly * 100);
      expect(stripe.prices.get(saved.stripePrices![`${p.id}_year`])!.unit_amount).toBe(p.annual * 12 * 100);
      // Old prices stay active, so current subscribers keep what they pay.
      expect(stripe.prices.get(oldPrices[`${p.id}_month`])!.active).toBe(true);
      if (p.trial) expect(stripe.coupons.get(saved.stripeCoupons![p.id])!.amount_off).toBe(introDiscount(p) * 100);
    }
    expect(saved.stripeWebhookSecret).toBe("whsec_old");
    expect(await stripePricesStale()).toBe(false);
  });

  it("an explicit Connect Stripe still replaces the webhook so its secret is captured", async () => {
    const stripe = fakeStripe();
    vi.stubGlobal("fetch", stripe.fetchFn);
    const { setupStripeBilling } = await import("@/lib/billing");
    const { getIntegrations } = await import("@/lib/integrations");
    await setupStripeBilling("sk_test_abc123", "https://app.example.com");
    expect(stripe.webhookCalls).toContain("POST /webhook_endpoints");
    expect((await getIntegrations()).stripeWebhookSecret).toBe("whsec_new");
  });
});
