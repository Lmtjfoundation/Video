import "server-only";
import { QuotaError, getUser, refundCredits, refundTrialFree, spendCredits, spendTrialFree, type User } from "./auth";
import { currentUserId } from "./db";
import { planById, type Plan } from "./plans";
import { getOwnAi } from "./ai-provider";

/**
 * Pays for an AI writing action, then runs it. In order:
 * 1. The subscriber connected their own AI (Settings → AI): their provider bills them, so no credits are used.
 * 2. They're on a free trial: the trial's free daily allowance is used instead of credits.
 * 3. Otherwise credits are charged up front and refunded if the AI action fails.
 */
export async function withCredits<T>(n: number, fn: () => Promise<T>, userId = currentUserId()): Promise<T> {
  if (!userId) throw new Error("No signed-in user.");
  if (n <= 0) return fn();
  if (await getOwnAi()) return fn();
  if (await spendTrialFree(userId, n)) {
    try {
      return await fn();
    } catch (e) {
      await refundTrialFree(userId, n);
      throw e;
    }
  }
  await spendCredits(userId, n);
  try {
    return await fn();
  } catch (e) {
    await refundCredits(userId, n);
    throw e;
  }
}

export function requireFeature(user: User, feature: keyof Plan["features"], label: string) {
  const plan = planById(user.plan);
  if (!plan.features[feature]) {
    throw new QuotaError(`${label} isn't included in ${plan.name}. Upgrade on the Plans page to unlock it.`);
  }
}

export async function currentPlan(userId = currentUserId()) {
  const u = userId ? await getUser(userId) : null;
  return planById(u?.plan);
}
