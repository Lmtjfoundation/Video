import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  POOL_PER_USER_DAILY,
  VAULT_DAYS,
  balance,
  debit,
  newLot,
  planCycle,
  restore,
  splitExpired,
  type CreditLot,
} from "@/lib/vault-core";
import { CREDIT_COST, EST_COST_CENTS_PER_CREDIT, PLANS, TRIAL_DAILY_FREE_CREDITS, planById } from "@/lib/plans";

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-01T12:00:00Z");

describe("vault rules (pure)", () => {
  const lot = (id: string, credits: number, expiresInDays: number): CreditLot => newLot(id, credits, "plan", T0, T0 + expiresInDays * DAY);

  it("spends the lot that expires first, and refuses when the vault is short", () => {
    const lots = [lot("late", 50, 20), lot("soon", 30, 5)];
    const after = debit(lots, 40, T0)!;
    expect(after.find((l) => l.id === "soon")).toBeUndefined();
    expect(after.find((l) => l.id === "late")!.credits).toBe(40);
    expect(balance(after, T0)).toBe(40);
    expect(debit(lots, 81, T0)).toBeNull();
    expect(lots[1].credits).toBe(30); // the input is never modified
  });

  it("separates credits that expired unused", () => {
    const lots = [lot("old", 12, -1), lot("ok", 7, 3), lot("spent", 0, 3)];
    const { live, expired } = splitExpired(lots, T0);
    expect(expired).toBe(12);
    expect(live.map((l) => l.id)).toEqual(["ok"]);
    expect(balance(lots, T0)).toBe(7);
  });

  it("puts refunded credits back into the longest-lived lot, or a short new lot", () => {
    const back = restore([lot("soon", 5, 2), lot("late", 5, 25)], 3, T0, "x");
    expect(back.find((l) => l.id === "late")!.credits).toBe(8);
    const fresh = restore([], 4, T0, "r1");
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({ credits: 4, source: "refund" });
    expect(Date.parse(fresh[0].expiresAt)).toBeGreaterThan(T0);
  });

  const free = planById("free");
  const pro = planById("pro");
  const iso = (t: number) => new Date(t).toISOString();

  it("Free and admin-assigned plans get a new 30-day cycle counted from sign-up", () => {
    const u = { createdAt: iso(T0) };
    expect(planCycle(u, free, T0)!.key).toBe("free:0");
    expect(planCycle(u, free, T0 + 29 * DAY)!.key).toBe("free:0");
    const second = planCycle(u, free, T0 + 31 * DAY)!;
    expect(second.key).toBe("free:1");
    expect(second.start).toBe(T0 + VAULT_DAYS * DAY);
    expect(planCycle(u, pro, T0)!.key).toBe("comp:0"); // a paid plan with no Stripe subscription
  });

  it("a monthly subscriber gets credits once per paid period, and none before the first payment or when overdue", () => {
    const end = iso(T0 + 20 * DAY);
    const sub = { subscriptionId: "sub_1", interval: "month" as const, currentPeriodEnd: end };
    const active = planCycle({ createdAt: iso(T0 - 90 * DAY), billing: { ...sub, status: "active" } }, pro, T0)!;
    expect(active.key).toBe(`m:${end}`);
    expect(active.credits).toBe(pro.credits);
    expect(planCycle({ createdAt: iso(T0), billing: { ...sub, status: "trialing" } }, pro, T0)).toBeNull();
    expect(planCycle({ createdAt: iso(T0), billing: { ...sub, status: "past_due" } }, pro, T0)).toBeNull();
    expect(planCycle({ createdAt: iso(T0), status: "suspended" }, free, T0)).toBeNull();
  });

  it("a yearly subscriber still receives credits every 30 days", () => {
    const end = T0 + 300 * DAY; // 65 days into the year
    const billing = { subscriptionId: "sub_y", interval: "year" as const, currentPeriodEnd: iso(end), status: "active" };
    const a = planCycle({ createdAt: iso(T0 - 400 * DAY), billing }, pro, T0)!;
    const b = planCycle({ createdAt: iso(T0 - 400 * DAY), billing }, pro, T0 + 30 * DAY)!;
    expect(a.key).not.toBe(b.key);
    expect(a.key.startsWith("y:")).toBe(true);
  });
});

describe("plans stay profitable", () => {
  // Worst case: every credit used at the estimated cost, after Stripe's 2.9% + 30¢ on a monthly card payment.
  it.each(PLANS.filter((p) => p.monthly > 0).map((p) => [p.name, p] as const))("%s keeps at least 30%% margin monthly and 20%% yearly if every credit is used", (_name, p) => {
    const cost = (p.credits * EST_COST_CENTS_PER_CREDIT) / 100;
    const monthly = (p.monthly - (p.monthly * 0.029 + 0.3) - cost) / p.monthly;
    const yearly = (p.annual - (p.annual * 12 * 0.029 + 0.3) / 12 - cost) / p.annual;
    expect(monthly).toBeGreaterThanOrEqual(0.3);
    expect(yearly).toBeGreaterThanOrEqual(0.2);
  });

  it("prices rise with credits, and the yearly price is a real discount", () => {
    const paid = PLANS.filter((p) => p.monthly > 0);
    for (let i = 1; i < paid.length; i++) {
      expect(paid[i].monthly).toBeGreaterThan(paid[i - 1].monthly);
      expect(paid[i].credits).toBeGreaterThan(paid[i - 1].credits);
    }
    for (const p of paid) expect(p.annual).toBeLessThan(p.monthly);
  });

  it("a trial can't cost more than ~$8 of Claude usage, and a live-news piece is charged close to its real cost", () => {
    expect((14 * TRIAL_DAILY_FREE_CREDITS * EST_COST_CENTS_PER_CREDIT) / 100).toBeLessThanOrEqual(8);
    expect(CREDIT_COST.post + CREDIT_COST.liveCheck).toBeGreaterThanOrEqual(5);
  });
});

/* ───────── with storage: grants, expiry, the pool ───────── */

const dir = mkdtempSync(path.join(tmpdir(), "nexus-vault-"));
process.env.DATA_DIR = dir;
process.env.SETUP_CODE = "test-setup-code";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
delete process.env.SUPABASE_URL;
delete process.env.DATABASE_URL;
delete process.env.COMMUNITY_POOL_DAILY_MAX;

describe("vault with storage", () => {
  type Auth = typeof import("@/lib/auth");
  type Pool = typeof import("@/lib/credit-pool");
  let auth: Auth;
  let pool: Pool;
  let owner: { id: string };
  let n = 0;

  const newUser = async () => auth.createUser({ email: `user${++n}@example.com`, password: "Correct-horse-battery-9" });
  const fresh = async (id: string) => (await auth.getUser(id))!;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    auth = await import("@/lib/auth");
    pool = await import("@/lib/credit-pool");
    owner = await auth.createUser({ email: "owner@example.com", password: "Correct-horse-battery-9", setupCode: "test-setup-code" });
  });
  afterAll(() => vi.useRealTimers());

  it("a new Free account gets 30 credits that expire in 30 days", async () => {
    const u = await newUser();
    await auth.rollVault(u);
    const s = auth.vaultSummary(await fresh(u.id));
    expect(s.balance).toBe(30);
    expect(s.lots).toHaveLength(1);
    expect(Date.parse(s.lots[0].expiresAt) - Date.now()).toBeGreaterThan(29 * DAY);
    expect(Date.parse(s.lots[0].expiresAt) - Date.now()).toBeLessThanOrEqual(VAULT_DAYS * DAY);
    // Rolling again in the same cycle never adds credits twice.
    await auth.rollVault(await fresh(u.id));
    await auth.rollVault(await fresh(u.id));
    expect(auth.vaultSummary(await fresh(u.id)).balance).toBe(30);
  });

  it("spending lowers the balance and a refund restores it", async () => {
    const u = await newUser();
    expect(await auth.spendCredits(u.id, 5)).toBe(25);
    expect((await fresh(u.id)).usage.credits).toBe(5);
    await auth.refundCredits(u.id, 5);
    expect(auth.vaultSummary(await fresh(u.id)).balance).toBe(30);
    expect((await fresh(u.id)).usage.credits).toBe(0);
  });

  it("the owner (admin) account never uses credits, even with an empty vault", async () => {
    expect((await fresh(owner.id)).role).toBe("admin");
    const before = (await fresh(owner.id)).usage.credits;
    await expect(auth.spendCredits(owner.id, 500)).resolves.toBeTypeOf("number");
    await auth.refundCredits(owner.id, 500); // nothing was taken, so nothing is added back
    const after = await fresh(owner.id);
    expect(after.usage.credits).toBe(before);
    expect(auth.vaultSummary(after).balance).toBeLessThanOrEqual(after.plan === "free" ? 30 : 100000);
    // A regular account is still charged and still refused when short.
    const u = await newUser();
    await expect(auth.spendCredits(u.id, 500)).rejects.toThrow(/your vault has/);
  });

  it("credits unused after 30 days move to the community pool, once", async () => {
    const before = (await pool.poolSnapshot()).balance;
    const u = await newUser();
    await auth.spendCredits(u.id, 10); // 20 left
    vi.setSystemTime(T0 + 29 * DAY);
    expect(auth.vaultSummary(await auth.rollVault(await fresh(u.id))).balance).toBe(20);
    vi.setSystemTime(T0 + 31 * DAY);
    const rolled = await auth.rollVault(await fresh(u.id));
    // The expired 20 are gone; the new cycle's 30 arrived.
    expect(auth.vaultSummary(rolled).balance).toBe(30);
    expect((await pool.poolSnapshot()).balance).toBe(before + 20);
    await auth.rollVault(await fresh(u.id));
    await auth.rollVault(await fresh(u.id));
    expect((await pool.poolSnapshot()).balance).toBe(before + 20); // not counted twice
    vi.setSystemTime(T0);
  });

  it("an account that ran out is topped up from the pool, up to its daily limit", async () => {
    await pool.addToPool(500, Date.now());
    const u = await newUser();
    await auth.spendCredits(u.id, 30); // vault empty
    expect(auth.vaultSummary(await fresh(u.id)).balance).toBe(0);
    const poolBefore = (await pool.poolSnapshot()).balance;
    expect(await auth.spendCredits(u.id, 3)).toBe(0); // 3 came from the pool and were spent
    expect((await pool.poolSnapshot()).balance).toBe(poolBefore - 3);
    expect(auth.vaultSummary(await fresh(u.id)).poolAllowanceLeft).toBe(POOL_PER_USER_DAILY - 3);
    // 6 more would pass the daily limit (3 + 6 > 8): refused, and nothing leaves the pool.
    await expect(auth.spendCredits(u.id, 6)).rejects.toThrow(/your vault has 0/);
    expect((await pool.poolSnapshot()).balance).toBe(poolBefore - 3);
    expect(await auth.spendCredits(u.id, 5)).toBe(0); // exactly the rest of today's limit
    await expect(auth.spendCredits(u.id, 1)).rejects.toThrow(/Your next 30 credits arrive/);
    // Tomorrow the limit resets.
    vi.setSystemTime(T0 + DAY);
    expect(await auth.spendCredits(u.id, 2)).toBe(0);
    vi.setSystemTime(T0);
  });

  it("unused pool credits go back to the pool", async () => {
    const u = await newUser();
    await auth.spendCredits(u.id, 30);
    await auth.spendCredits(u.id, 1); // takes 1 from the pool... and spends it
    await auth.refundCredits(u.id, 1); // returned into a short-lived lot
    const before = (await pool.poolSnapshot()).balance;
    vi.setSystemTime(T0 + 10 * DAY);
    await auth.rollVault(await fresh(u.id));
    expect((await pool.poolSnapshot()).balance).toBeGreaterThanOrEqual(before + 1);
    vi.setSystemTime(T0);
  });

  it("the global daily ceiling stops the pool from emptying in one day", async () => {
    process.env.COMMUNITY_POOL_DAILY_MAX = "0";
    try {
      const u = await newUser();
      await auth.spendCredits(u.id, 30);
      await expect(auth.spendCredits(u.id, 1)).rejects.toThrow(/credit/);
    } finally {
      delete process.env.COMMUNITY_POOL_DAILY_MAX;
    }
  });

  it("accounts that existed before the vault keep what they had left this month, with no windfall", async () => {
    const u = await newUser();
    const legacy = await fresh(u.id);
    delete legacy.vault;
    legacy.usage = { period: new Date().toISOString().slice(0, 7), credits: 12, posts: 3 };
    await auth.saveUser(legacy);
    await auth.rollVault(await fresh(u.id));
    expect(auth.vaultSummary(await fresh(u.id)).balance).toBe(18);
    await auth.rollVault(await fresh(u.id));
    expect(auth.vaultSummary(await fresh(u.id)).balance).toBe(18);
  });

  it("a subscriber is credited once per paid period, upgrades add only the difference, and a trial adds nothing", async () => {
    const u = await newUser();
    const end = new Date(Date.now() + 25 * DAY).toISOString();
    const set = async (plan: "pro" | "unlimited", status: string) => {
      const x = await fresh(u.id);
      x.plan = plan;
      x.billing = { subscriptionId: "sub_1", customerId: "cus_1", status, interval: "month", currentPeriodEnd: end };
      await auth.saveUser(x);
    };
    await auth.rollVault(await fresh(u.id)); // the Free credits every account starts with
    await set("pro", "trialing");
    await auth.rollVault(await fresh(u.id));
    expect(auth.vaultSummary(await fresh(u.id)).balance).toBe(30); // a trial adds no plan credits; only the Free ones remain
    await set("pro", "active");
    await auth.rollVault(await fresh(u.id));
    expect(auth.vaultSummary(await fresh(u.id)).balance).toBe(30 + planById("pro").credits);
    await auth.rollVault(await fresh(u.id));
    expect(auth.vaultSummary(await fresh(u.id)).balance).toBe(30 + planById("pro").credits);
    await set("unlimited", "active");
    await auth.rollVault(await fresh(u.id));
    expect(auth.vaultSummary(await fresh(u.id)).balance).toBe(30 + planById("unlimited").credits);
  });

  it("the sweeper keeps every vault current and respects its 30-minute spacing", async () => {
    const { sweepVaults } = await import("@/lib/vault-sweep");
    const first = await sweepVaults(Date.now(), true);
    expect(first.skipped).toBe(false);
    expect((await sweepVaults(Date.now() + 60_000)).skipped).toBe(true);
    expect((await sweepVaults(Date.now() + 31 * 60_000)).skipped).toBe(false);
  });

  it("the owner account (unlimited, no Stripe) is credited from its own cycle", async () => {
    await auth.rollVault(await fresh(owner.id));
    expect(auth.vaultSummary(await fresh(owner.id)).balance).toBe(planById("unlimited").credits);
  });
});
