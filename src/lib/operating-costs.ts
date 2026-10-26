/**
 * What it costs to run Ghost Post, so the admin sees real profit and every plan is priced to pay for its share.
 *
 * Defaults are Azure list prices (East US, Linux, pay-as-you-go, Oct 2026, prices.azure.com):
 *   app server D4ads_v6 $0.228/h (≈ $166/month always on) · P10 disk $19.71/month · static IPv4 $0.005/h (≈ $3.65)
 *   CPU tools engine: on the app server (no extra hours) · GPU engine NV36ads_A10_v5 (one full A10, 24 GB) $3.20/h.
 * The admin replaces any of them with the real bill (Admin → Profit & operating costs).
 */
import { CREDIT_PACKS, EST_COST_CENTS_PER_CREDIT, PLANS, type Plan } from "./plans";

export interface OperatingCosts {
  /** Always-on app server, dollars a month. */
  appServerMonthly: number;
  /** Disks, IP addresses and backups, dollars a month (they're billed even while a VM is off). */
  storageNetworkMonthly: number;
  /** Domain, email and any other fixed monthly bills. */
  otherMonthly: number;
  /** Engine VMs, dollars an hour while they run (they stop themselves when idle). */
  cpuEngineHourly: number;
  gpuEngineHourly: number;
  /** Profit the admin aims for, as a fraction of revenue after card fees. */
  targetMargin: number;
}

export const DEFAULT_COSTS: OperatingCosts = {
  appServerMonthly: 166.44,
  // Two P10 disks (app server and GPU engine) and two static IPs.
  storageNetworkMonthly: 2 * 19.71 + 2 * 3.65,
  otherMonthly: 0,
  cpuEngineHourly: 0,
  gpuEngineHourly: 3.2,
  targetMargin: 0.4,
};

/** Stripe's standard card fee: 2.9% + 30¢ a charge. */
export const stripeFee = (dollars: number) => (dollars > 0 ? dollars * 0.029 + 0.3 : 0);

export const fixedMonthly = (c: OperatingCosts) => c.appServerMonthly + c.storageNetworkMonthly + c.otherMonthly;

/** Dollars a plan earns in a month after the card fee (a yearly plan is charged once a year, so its fee is spread). */
export function netMonthly(p: Plan, interval: "month" | "year") {
  if (interval === "year") return p.annual - stripeFee(p.annual * 12) / 12;
  return p.monthly - stripeFee(p.monthly);
}

/** What a subscriber leaves after card fees and their AI credits (`use` = share of the plan's credits used). */
export function contribution(p: Plan, interval: "month" | "year", use: number) {
  const net = netMonthly(p, interval);
  const ai = (p.credits * use * EST_COST_CENTS_PER_CREDIT) / 100;
  return { net, ai, left: net - ai, margin: net > 0 ? (net - ai) / net : 0 };
}

/** Subscribers of one plan alone that pay all fixed costs, at a given credit use. Infinity when a plan can't. */
export function breakEven(p: Plan, c: OperatingCosts, use = 0.5) {
  const left = contribution(p, "month", use).left;
  return left > 0 ? Math.ceil(fixedMonthly(c) / left) : Infinity;
}

/** Credit packs' margin when every credit goes to the most expensive writing. */
export const packMargins = () => CREDIT_PACKS.map((k) => ({ ...k, margin: (k.price - stripeFee(k.price) - (k.credits * EST_COST_CENTS_PER_CREDIT) / 100) / k.price }));

export interface ProfitInput {
  /** Monthly revenue from subscriptions that are paid up. */
  mrr: number;
  /** Number of paid charges behind that revenue (for the 30¢ part of the fee). */
  charges: number;
  creditsUsedPaid: number;
  creditsUsedComp: number;
  cpuEngineHours: number;
  gpuEngineHours: number;
}

/** This month's profit and loss. */
export function profit(i: ProfitInput, c: OperatingCosts) {
  const fees = i.mrr * 0.029 + i.charges * 0.3;
  const aiPaid = (i.creditsUsedPaid * EST_COST_CENTS_PER_CREDIT) / 100;
  const aiComp = (i.creditsUsedComp * EST_COST_CENTS_PER_CREDIT) / 100;
  const engines = i.cpuEngineHours * c.cpuEngineHourly + i.gpuEngineHours * c.gpuEngineHourly;
  const fixed = fixedMonthly(c);
  const costs = fees + aiPaid + aiComp + engines + fixed;
  const net = i.mrr - costs;
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    revenue: r(i.mrr),
    fees: r(fees),
    aiPaid: r(aiPaid),
    aiComp: r(aiComp),
    engines: r(engines),
    fixed: r(fixed),
    costs: r(costs),
    profit: r(net),
    margin: i.mrr > 0 ? Math.round((net / i.mrr) * 100) : null,
    breakEven: Object.fromEntries(PLANS.filter((p) => p.monthly > 0).map((p) => [p.id, breakEven(p, c)])),
  };
}

export function cleanCosts(v: Partial<OperatingCosts> | null | undefined): OperatingCosts {
  const n = (x: unknown, d: number, max: number) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= max ? x : d);
  return {
    appServerMonthly: n(v?.appServerMonthly, DEFAULT_COSTS.appServerMonthly, 100_000),
    storageNetworkMonthly: n(v?.storageNetworkMonthly, DEFAULT_COSTS.storageNetworkMonthly, 100_000),
    otherMonthly: n(v?.otherMonthly, DEFAULT_COSTS.otherMonthly, 100_000),
    cpuEngineHourly: n(v?.cpuEngineHourly, DEFAULT_COSTS.cpuEngineHourly, 1_000),
    gpuEngineHourly: n(v?.gpuEngineHourly, DEFAULT_COSTS.gpuEngineHourly, 1_000),
    targetMargin: n(v?.targetMargin, DEFAULT_COSTS.targetMargin, 0.95),
  };
}

/**
 * GPU seconds one unit of each GPU job takes on the GPU engine (one A10, 24 GB, ENGINE_QUALITY=fast, models moved
 * between GPU and system memory as needed). ESTIMATES from published speeds, scaled to the A10; replace them with
 * timings from the real machine (engine logs) once it runs. The margin test holds every price to them.
 *   clip / edit second: Wan 2.2 TI2V-5B, a 5-second 720p clip ≈ 20 minutes with offloading
 *   speech: Chatterbox, 1,000 characters ≈ 1 minute of speech at about real time · lip sync: MuseTalk ≈ 2× real time
 *   music: ACE-Step, a track ≈ 2 minutes · sound effect ≈ 1 minute · voice design ≈ 30 s · voice change ≈ 1 min/min
 */
export const GPU_JOB_SECONDS = {
  ownSecond: 240,
  editSecond: 240,
  speech: 60,
  lipsyncSecond: 2,
  aiMusic: 120,
  aiSfx: 60,
  voiceDesign: 30,
  voiceChangeMinute: 60,
  dubMinute: 120,
} as const;

/** The least a credit brings in: the cheapest way to buy one (Unlimited, billed yearly), after the card fee. */
export function cheapestCreditDollars() {
  const best = PLANS.filter((p) => p.annual > 0).reduce((a, b) => (b.annual / b.credits < a.annual / a.credits ? b : a));
  return netMonthly(best, "year") / best.credits;
}

/** Margin of one GPU job priced at `credits`, run for `seconds` on a GPU at `hourly` dollars. */
export const gpuJobMargin = (credits: number, seconds: number, hourly: number) => {
  const revenue = credits * cheapestCreditDollars();
  return (revenue - (seconds / 3600) * hourly) / revenue;
};
