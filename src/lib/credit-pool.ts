import "server-only";
import { gdb } from "./db";
import { utcDay } from "./vault-core";

/**
 * The community pool: credits that expired unused in anyone's vault. They are not lost. They top up any account
 * whose own vault has run out (a few credits a day each, see POOL_PER_USER_DAILY), so paid-for credits get used.
 *
 * The pool only ever holds credits somebody already paid for, so it never makes the total Claude usage larger than
 * the credits sold. A global daily ceiling stops a burst of new accounts from emptying it in one day.
 */

const ID = "credit_pool";

export interface PoolDoc {
  /** Credits available now. */
  balance: number;
  /** Lifetime credits that expired into the pool. */
  swept: number;
  /** Lifetime credits handed out from the pool. */
  drawn: number;
  /** Credits handed out on `day`. */
  day: string;
  drawnToday: number;
  updatedAt: string;
}

const blank = (): PoolDoc => ({ balance: 0, swept: 0, drawn: 0, day: "", drawnToday: 0, updatedAt: new Date().toISOString() });

/** The most the pool hands out across all accounts in one UTC day (COMMUNITY_POOL_DAILY_MAX overrides). */
export const poolDailyMax = () => {
  const n = Number(process.env.COMMUNITY_POOL_DAILY_MAX);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 500;
};

// One server process handles every request, so a promise chain serializes pool changes.
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

async function read(now: number): Promise<PoolDoc> {
  const row = await gdb().get<{ id: string; value: PoolDoc }>("kv", ID);
  const d = { ...blank(), ...(row?.value ?? {}) };
  if (d.day !== utcDay(now)) {
    d.day = utcDay(now);
    d.drawnToday = 0;
  }
  return d;
}

async function write(d: PoolDoc) {
  d.updatedAt = new Date().toISOString();
  await gdb().upsert("kv", { id: ID, value: d });
}

/** Adds credits that expired unused. */
export function addToPool(n: number, now = Date.now()) {
  if (!(n > 0)) return Promise.resolve();
  return locked(async () => {
    const d = await read(now);
    d.balance += n;
    d.swept += n;
    await write(d);
  });
}

/** Takes exactly `n` credits for one account, or nothing (false) when the pool or today's ceiling can't cover it. */
export function takeFromPool(n: number, now = Date.now()) {
  return locked(async () => {
    if (!(n > 0)) return false;
    const d = await read(now);
    if (d.balance < n || d.drawnToday + n > poolDailyMax()) return false;
    d.balance -= n;
    d.drawn += n;
    d.drawnToday += n;
    await write(d);
    return true;
  });
}

/** What the app shows: the balance, and how much of it can still go out today. */
export async function poolSnapshot(now = Date.now()) {
  const d = await read(now);
  return { balance: d.balance, availableToday: Math.max(0, Math.min(d.balance, poolDailyMax() - d.drawnToday)), swept: d.swept, drawn: d.drawn };
}
