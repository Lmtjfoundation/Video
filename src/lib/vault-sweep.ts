import "server-only";
import { gdb } from "./db";
import { getUser, listUsers, rollVault } from "./auth";

const ID = "vault_sweep";
const EVERY_MS = 30 * 60_000;

/**
 * Keeps every vault current without waiting for the person to log in: expired lots move to the community pool and
 * each plan's credits for a new billing cycle are added. Runs from the scheduler, at most once every 30 minutes.
 */
export async function sweepVaults(now = Date.now(), force = false) {
  const row = await gdb().get<{ id: string; value: { at: number } }>("kv", ID);
  if (!force && row?.value?.at && now - row.value.at < EVERY_MS) return { skipped: true as const };
  await gdb().upsert("kv", { id: ID, value: { at: now } });
  let rolled = 0;
  let failed = 0;
  for (const u of await listUsers()) {
    try {
      // Re-read right before changing it, so a spend that happened while the sweep ran isn't overwritten.
      const fresh = await getUser(u.id);
      if (fresh) await rollVault(fresh, now);
      rolled++;
    } catch (e) {
      failed++;
      console.error(`[vault] ${u.id}:`, (e as Error).message);
    }
  }
  return { skipped: false as const, rolled, failed };
}
