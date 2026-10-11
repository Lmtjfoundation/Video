import "server-only";
import { asUser } from "./db";
import { listUsers, rollUsage, type User } from "./auth";
import { planById } from "./plans";

/** Runs `fn` once per active user, each inside that user's data scope. Errors in one account never stop the rest. */
export async function forEachActiveUser<T>(fn: (u: User) => Promise<T>, filter: (u: User) => boolean = () => true) {
  const results: Record<string, T | { error: string }> = {};
  const users = (await listUsers()).filter((u) => u.status === "active" && filter(u));
  for (const u of users) {
    try {
      await rollUsage(u);
      results[u.id] = await asUser(u.id, () => fn(u));
    } catch (e) {
      results[u.id] = { error: (e as Error).message };
    }
  }
  return results;
}

export const hasAutoReplies = (u: User) => planById(u.plan).features.autoReplies;
