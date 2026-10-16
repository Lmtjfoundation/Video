import type { Plan } from "./plans";

/**
 * Credit vault: the pure rules. Every credit a person receives sits in their own vault as a "lot" that expires
 * 30 days after it was added. Spending always uses the lot that expires first. Credits that expire unused move to the
 * community pool (credit-pool.ts), which tops up anyone whose own vault runs out. Nothing here touches storage.
 */

export const VAULT_DAYS = 30;
const DAY = 86_400_000;

/** From the community pool, one account can receive at most this many credits a day (every plan, including Free). */
export const POOL_PER_USER_DAILY = 8;
/** Credits taken from the pool stay in the vault this long; whatever isn't used goes back to the pool. */
export const POOL_LOT_DAYS = 2;
/** Credits restored after a failed AI action when the original lot is gone. */
export const REFUND_LOT_DAYS = 7;

export type LotSource = "plan" | "migration" | "pool" | "refund" | "bonus";

export interface CreditLot {
  id: string;
  /** Credits still unspent in this lot. */
  credits: number;
  /** Credits the lot started with. */
  granted: number;
  source: LotSource;
  grantedAt: string;
  expiresAt: string;
}

export interface Vault {
  lots: CreditLot[];
  /** The billing cycle the plan credits were last added for, and how many of them. */
  cycle: { key: string; granted: number };
  /** Credits taken from the community pool today (UTC day). */
  poolDay?: { day: string; credits: number };
}

export const emptyVault = (): Vault => ({ lots: [], cycle: { key: "", granted: 0 } });

const ms = (iso: string) => Date.parse(iso);
export const isLive = (l: CreditLot, now: number) => l.credits > 0 && ms(l.expiresAt) > now;

export const liveLots = (lots: CreditLot[], now: number) => lots.filter((l) => isLive(l, now)).sort((a, b) => ms(a.expiresAt) - ms(b.expiresAt));
export const balance = (lots: CreditLot[], now: number) => lots.reduce((s, l) => s + (isLive(l, now) ? l.credits : 0), 0);

/** Splits a vault into what can still be spent and the credits that expired unused (those go to the community pool). */
export function splitExpired(lots: CreditLot[], now: number) {
  const live: CreditLot[] = [];
  let expired = 0;
  for (const l of lots) {
    if (l.credits <= 0) continue;
    if (isLive(l, now)) live.push(l);
    else expired += l.credits;
  }
  return { live, expired };
}

/** Takes `n` credits from the lots that expire first. Returns null when the vault doesn't hold that many. */
export function debit(lots: CreditLot[], n: number, now: number): CreditLot[] | null {
  if (balance(lots, now) < n) return null;
  let need = n;
  const next = lots.map((l) => ({ ...l }));
  for (const l of next.filter((x) => isLive(x, now)).sort((a, b) => ms(a.expiresAt) - ms(b.expiresAt))) {
    if (need <= 0) break;
    const take = Math.min(l.credits, need);
    l.credits -= take;
    need -= take;
  }
  return next.filter((l) => l.credits > 0);
}

/** Puts credits back after a failed action: into the lot that expires last, or a short new lot when the vault is empty. */
export function restore(lots: CreditLot[], n: number, now: number, id: string): CreditLot[] {
  const next = lots.map((l) => ({ ...l }));
  const last = next.filter((l) => isLive(l, now)).sort((a, b) => ms(b.expiresAt) - ms(a.expiresAt))[0];
  if (last) {
    last.credits += n;
    return next;
  }
  next.push(newLot(id, n, "refund", now, now + REFUND_LOT_DAYS * DAY));
  return next;
}

export function newLot(id: string, credits: number, source: LotSource, now: number, expiresAtMs: number): CreditLot {
  return { id, credits, granted: credits, source, grantedAt: new Date(now).toISOString(), expiresAt: new Date(expiresAtMs).toISOString() };
}

export interface CycleUser {
  createdAt: string;
  status?: string;
  billing?: { subscriptionId?: string; status?: string; interval?: "month" | "year"; currentPeriodEnd?: string };
}

export interface Cycle {
  /** Changes once per billing cycle; the plan's credits are added once for each key. */
  key: string;
  /** When this cycle started. Its credits expire VAULT_DAYS later. */
  start: number;
  /** When the next cycle starts. */
  next: number;
  credits: number;
}

const addMonths = (t: number, m: number) => {
  const d = new Date(t);
  d.setUTCMonth(d.getUTCMonth() + m);
  return d.getTime();
};

/**
 * The cycle a person is in and how many credits their plan adds for it, or null when the plan adds none right now
 * (a trial before the first paid month, or a payment that is overdue).
 * - Free and plans an admin assigned without Stripe: 30-day cycles counted from the day the account was created.
 * - Monthly subscription: one cycle per paid billing period.
 * - Yearly subscription: twelve 30-day cycles inside the paid year, so credits still arrive monthly.
 */
export function planCycle(u: CycleUser, plan: Pick<Plan, "id" | "monthly" | "credits">, now: number): Cycle | null {
  if (u.status === "suspended") return null;
  const created = ms(u.createdAt) || now;
  const fixed = (prefix: string): Cycle => {
    const idx = Math.max(0, Math.floor((now - created) / (VAULT_DAYS * DAY)));
    const start = created + idx * VAULT_DAYS * DAY;
    return { key: `${prefix}:${idx}`, start, next: start + VAULT_DAYS * DAY, credits: plan.credits };
  };
  if (plan.monthly === 0) return fixed("free");
  if (!u.billing?.subscriptionId) return fixed("comp");
  if (u.billing.status !== "active") return null;
  const end = u.billing.currentPeriodEnd ? ms(u.billing.currentPeriodEnd) : NaN;
  if (!Number.isFinite(end)) return null;
  if (u.billing.interval === "year") {
    const periodStart = addMonths(end, -12);
    const idx = Math.min(11, Math.max(0, Math.floor((now - periodStart) / (VAULT_DAYS * DAY))));
    const start = periodStart + idx * VAULT_DAYS * DAY;
    return { key: `y:${u.billing.currentPeriodEnd}:${idx}`, start, next: idx === 11 ? end : start + VAULT_DAYS * DAY, credits: plan.credits };
  }
  return { key: `m:${u.billing.currentPeriodEnd}`, start: addMonths(end, -1), next: end, credits: plan.credits };
}

/** When a plan grant expires: 30 days after its cycle began, but never sooner than 3 days from now (late arrivals still get use). */
export const planLotExpiry = (cycle: Cycle, now: number) => Math.max(cycle.start + VAULT_DAYS * DAY, now + 3 * DAY);

export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Credits this account can still take from the community pool today. */
export function poolAllowanceLeft(v: Vault, now: number) {
  const used = v.poolDay?.day === utcDay(now) ? v.poolDay.credits : 0;
  return Math.max(0, POOL_PER_USER_DAILY - used);
}
