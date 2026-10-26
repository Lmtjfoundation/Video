import { describe, expect, it } from "vitest";
import { CREDIT_COST, CREDIT_PACKS, EST_COST_CENTS_PER_CREDIT, PLANS } from "@/lib/plans";
import { breakEven, cheapestCreditDollars, contribution, DEFAULT_COSTS, fixedMonthly, GPU_JOB_SECONDS, gpuJobMargin, packMargins, profit, stripeFee } from "@/lib/operating-costs";

const paid = PLANS.filter((p) => p.monthly > 0);

describe("every plan pays for what it uses and for running the platform", () => {
  it("leaves at least 25% after card fees with every credit used, and at least 60% at typical use", () => {
    for (const p of paid) {
      for (const interval of ["month", "year"] as const) {
        expect(contribution(p, interval, 1).margin, `${p.id} ${interval} at full use`).toBeGreaterThanOrEqual(0.25);
        expect(contribution(p, interval, 0.5).margin, `${p.id} ${interval} at half use`).toBeGreaterThanOrEqual(0.6);
      }
    }
  });

  it("covers the fixed bills with a realistic number of subscribers", () => {
    // At typical use, the platform's servers are paid by a few dozen subscribers on any one plan.
    for (const p of paid) expect(breakEven(p, DEFAULT_COSTS), p.id).toBeLessThanOrEqual(30);
    expect(fixedMonthly(DEFAULT_COSTS)).toBeCloseTo(166.44 + 46.72, 2);
  });

  it("prices credit packs above the best plan and keeps 20% on them", () => {
    const unlimited = PLANS.find((p) => p.id === "unlimited")!;
    for (const k of CREDIT_PACKS) expect(k.price / k.credits, k.id).toBeGreaterThan(unlimited.monthly / unlimited.credits);
    for (const m of packMargins()) expect(m.margin, m.id).toBeGreaterThanOrEqual(0.2);
  });

  it("prices every GPU job to keep 40% at the GPU's hourly rate, even on the cheapest credits", () => {
    expect(cheapestCreditDollars()).toBeGreaterThan(EST_COST_CENTS_PER_CREDIT / 100);
    for (const [action, seconds] of Object.entries(GPU_JOB_SECONDS)) {
      const margin = gpuJobMargin(CREDIT_COST[action as keyof typeof CREDIT_COST], seconds, DEFAULT_COSTS.gpuEngineHourly);
      expect(margin, `${action}: ${CREDIT_COST[action as keyof typeof CREDIT_COST]} credits for ${seconds} GPU seconds`).toBeGreaterThanOrEqual(0.4);
    }
  });

  it("counts every cost in the month's profit", () => {
    const r = profit({ mrr: 1000, charges: 20, creditsUsedPaid: 10_000, creditsUsedComp: 1_000, cpuEngineHours: 0, gpuEngineHours: 10 }, DEFAULT_COSTS);
    expect(r.fees).toBeCloseTo(1000 * 0.029 + 20 * 0.3, 2);
    expect(r.aiPaid).toBe(200);
    expect(r.aiComp).toBe(20);
    expect(r.engines).toBe(32);
    expect(r.profit).toBeCloseTo(1000 - r.fees - 200 - 20 - 32 - fixedMonthly(DEFAULT_COSTS), 1);
    expect(stripeFee(0)).toBe(0);
  });
});
