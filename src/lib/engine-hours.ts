import "server-only";
import { gdb } from "./db";

/**
 * Hours each engine machine ran this month, estimated from the app's own use of it: the machines start when used and
 * stop themselves after IDLE_MINUTES without a request (engine/azure/idle-stop.sh), so a session is its boot time,
 * the time between requests, and the idle tail. The admin's profit card turns them into dollars.
 */
export const IDLE_MINUTES = 20;
const BOOT_MINUTES = 3;
const ROW = "engine-hours";
type Hours = { month: string; minutes: Record<string, number>; last: Record<string, number> };

/** The minutes a request at `now` adds, given the previous request at `last` (0 = none yet). Pure, for tests. */
export function addedMinutes(last: number, now: number) {
  const gap = (now - last) / 60_000;
  return last && gap >= 0 && gap <= IDLE_MINUTES ? gap : BOOT_MINUTES + IDLE_MINUTES;
}

const seen = new Map<string, number>();

/** Records that `kind` answered a request. Writes at most once a minute per engine (jobs poll every few seconds). */
export async function recordEngineUse(kind: string, now = Date.now()) {
  if (now - (seen.get(kind) ?? 0) < 60_000) return;
  seen.set(kind, now);
  const month = new Date(now).toISOString().slice(0, 7);
  try {
    const saved = (await gdb().get<{ id: string; value: Hours }>("kv", ROW))?.value;
    const h: Hours = saved?.month === month ? saved : { month, minutes: {}, last: saved?.last ?? {} };
    h.minutes[kind] = (h.minutes[kind] ?? 0) + addedMinutes(h.last[kind] ?? 0, now);
    h.last[kind] = now;
    await gdb().upsert("kv", { id: ROW, value: h });
  } catch {
    /* bookkeeping must never fail a job */
  }
}

/** This month's estimated hours per engine. */
export async function engineHours(now = Date.now()): Promise<Record<string, number>> {
  const h = (await gdb().get<{ id: string; value: Hours }>("kv", ROW).catch(() => null))?.value;
  if (h?.month !== new Date(now).toISOString().slice(0, 7)) return {};
  return Object.fromEntries(Object.entries(h.minutes).map(([k, m]) => [k, Math.round((m / 60) * 10) / 10]));
}

/** Tests only. */
export const resetEngineHours = () => seen.clear();
