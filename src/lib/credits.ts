import "server-only";
import { QuotaError, getUser, refundCredits, spendCredits, type User } from "./auth";
import { currentUserId } from "./db";
import { planById, type Plan } from "./plans";

/** Charges credits up front and refunds them if the AI action fails. */
export async function withCredits<T>(n: number, fn: () => Promise<T>, userId = currentUserId()): Promise<T> {
  if (!userId) throw new Error("No signed-in user.");
  if (n <= 0) return fn();
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
