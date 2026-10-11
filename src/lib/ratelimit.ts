import "server-only";
import { db } from "./db";
import { kvGet, kvSet } from "./repo";
import { inQuietHours } from "./time";
import type { Platform, Settings } from "./types";
import { uid } from "./utils";

type Action = "post" | "reply";
interface RateEvent {
  id: string;
  platform: Platform;
  action: Action;
  at: number;
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;

async function recent(platform: Platform): Promise<RateEvent[]> {
  const all = await db().all<RateEvent>("rate_events", 5000);
  return all.filter((e) => e.platform === platform && Date.now() - e.at < DAY);
}

export interface Gate {
  ok: boolean;
  reason?: string;
}

/** Checks every guard before a write action. Order matters: cheapest/most important first. */
export async function canAct(platform: Platform, action: Action, settings: Settings): Promise<Gate> {
  if (settings.killSwitch) return { ok: false, reason: "Kill switch is on" };
  const now = new Date();
  if (settings.quietHours.enabled && inQuietHours(now, settings.timezone, settings.quietHours.start, settings.quietHours.end)) {
    return { ok: false, reason: "Quiet hours" };
  }
  const cooldowns = (await kvGet<Record<string, number>>("cooldowns")) ?? {};
  if ((cooldowns[platform] ?? 0) > Date.now()) {
    return { ok: false, reason: `Cooling down after a rate-limit response until ${new Date(cooldowns[platform]).toLocaleTimeString()}` };
  }

  const limits = settings.limits[platform];
  const events = await recent(platform);
  const last = events.reduce((m, e) => Math.max(m, e.at), 0);
  if (Date.now() - last < limits.minGapSec * 1000) return { ok: false, reason: "Minimum gap between actions" };

  if (action === "post") {
    const today = events.filter((e) => e.action === "post").length;
    if (today >= limits.postsPerDay) return { ok: false, reason: `Daily post cap (${limits.postsPerDay}) reached` };
  } else {
    const hour = events.filter((e) => e.action === "reply" && Date.now() - e.at < HOUR).length;
    const day = events.filter((e) => e.action === "reply").length;
    if (hour >= limits.repliesPerHour) return { ok: false, reason: `Hourly reply cap (${limits.repliesPerHour}) reached` };
    if (day >= limits.repliesPerDay) return { ok: false, reason: `Daily reply cap (${limits.repliesPerDay}) reached` };
  }
  return { ok: true };
}

export async function recordAction(platform: Platform, action: Action) {
  await db().upsert<RateEvent>("rate_events", { id: uid("re"), platform, action, at: Date.now() });
}

/** Called when a platform returns 429 / rate-limit errors. Exponential: 15m, 30m, 60m… capped at 6h. */
export async function coolDown(platform: Platform, retryAfterSec?: number) {
  const cooldowns = (await kvGet<Record<string, number>>("cooldowns")) ?? {};
  const strikes = (await kvGet<Record<string, number>>("strikes")) ?? {};
  strikes[platform] = (strikes[platform] ?? 0) + 1;
  const backoff = Math.min(15 * 60_000 * 2 ** (strikes[platform] - 1), 6 * HOUR);
  cooldowns[platform] = Date.now() + Math.max(backoff, (retryAfterSec ?? 0) * 1000);
  await kvSet("cooldowns", cooldowns);
  await kvSet("strikes", strikes);
  return cooldowns[platform];
}

export async function clearStrikes(platform: Platform) {
  const strikes = (await kvGet<Record<string, number>>("strikes")) ?? {};
  if (strikes[platform]) {
    strikes[platform] = 0;
    await kvSet("strikes", strikes);
  }
}

/** Random human-like delay (seconds) so actions never land on exact intervals. */
export const jitterMs = (minSec = 4, maxSec = 25) => (minSec + Math.random() * (maxSec - minSec)) * 1000;
