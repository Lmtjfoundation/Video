import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CREDIT_COST, CREDIT_PACKS, EST_COST_CENTS_PER_CREDIT, PLANS } from "@/lib/plans";
import { PACK_DAYS } from "@/lib/vault-core";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-packs-"));
process.env.DATA_DIR = dir;
process.env.SETUP_CODE = "test-setup-code";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
delete process.env.SUPABASE_URL;
delete process.env.DATABASE_URL;
delete process.env.STRIPE_SECRET_KEY;

describe("credit pack prices", () => {
  it.each(CREDIT_PACKS.map((p) => [p.id, p] as const))("%s keeps at least 20%% margin after Stripe's fee if every credit is used", (_id, p) => {
    const cost = (p.credits * EST_COST_CENTS_PER_CREDIT) / 100;
    expect((p.price - (p.price * 0.029 + 0.3) - cost) / p.price).toBeGreaterThanOrEqual(0.2);
  });

  it("costs more per credit than the best-value subscription, so subscribing stays the better deal", () => {
    const cheapestPack = Math.min(...CREDIT_PACKS.map((p) => p.price / p.credits));
    const bestPlan = Math.min(...PLANS.filter((x) => x.monthly > 0).map((x) => x.annual / x.credits));
    expect(cheapestPack).toBeGreaterThan(bestPlan);
  });

  it("charges the own video engine at least its estimated GPU cost a second", () => {
    // About 1,056 s on an H100 per 5-second clip at $3.673-6.98 an hour works out to 20-41¢ a second; the A100 default is the 33¢ end.
    expect(CREDIT_COST.ownSecond * EST_COST_CENTS_PER_CREDIT).toBeGreaterThanOrEqual(30);
  });
});

describe("buying a pack", () => {
  it("adds the credits once, only for a paid session at the pack's price", async () => {
    const { createUser, getUser } = await import("@/lib/auth");
    const { handleStripeEvent } = await import("@/lib/billing");
    await createUser({ email: "owner@example.com", password: "Correct-horse-1", setupCode: "test-setup-code" });
    const buyer = await createUser({ email: "buyer@example.com", password: "Correct-horse-1" });
    const pack = CREDIT_PACKS[1];
    const session = (over: Record<string, unknown> = {}) => ({
      mode: "payment",
      payment_status: "paid",
      amount_subtotal: pack.price * 100,
      client_reference_id: buyer.id,
      metadata: { userId: buyer.id, pack: pack.id },
      ...over,
    });
    const packLots = async () => ((await getUser(buyer.id))!.vault?.lots ?? []).filter((l) => l.source === "pack");

    await handleStripeEvent({ id: "evt_unpaid", type: "checkout.session.completed", data: { object: session({ payment_status: "unpaid" }) } });
    await handleStripeEvent({ id: "evt_wrong_amount", type: "checkout.session.completed", data: { object: session({ amount_subtotal: 100 }) } });
    expect(await packLots()).toEqual([]);

    await handleStripeEvent({ id: "evt_paid", type: "checkout.session.completed", data: { object: session() } });
    await handleStripeEvent({ id: "evt_paid", type: "checkout.session.completed", data: { object: session() } }); // Stripe retries
    const lots = await packLots();
    expect(lots).toHaveLength(1);
    expect(lots[0].credits).toBe(pack.credits);
    const days = (Date.parse(lots[0].expiresAt) - Date.parse(lots[0].grantedAt)) / 86_400_000;
    expect(Math.round(days)).toBe(PACK_DAYS);
    // A pack purchase never touches the subscription fields.
    expect((await getUser(buyer.id))!.billing?.subscriptionId).toBeUndefined();
  });
});
