import { body, fail, authed, ok } from "@/lib/http-api";
import { enabledPlatforms, fillDay } from "@/lib/scheduler";
import { getSettings } from "@/lib/repo";
import { refundCredits, spendCredits } from "@/lib/auth";
import { CREDIT_COST } from "@/lib/plans";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Fills ONE day. The UI calls this 7× for "Fill my entire week" so each request stays short. */
export const POST = authed(async (req, user) => {
  const { date, topic } = await body<{ date: string; topic?: string }>(req);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return fail("date must be YYYY-MM-DD");
  const s = await getSettings();
  const platforms = enabledPlatforms(s);
  if (!platforms.length) return fail("Enable at least one platform in Settings.");
  // Charge for the most posts this day could need, then refund what wasn't written.
  const estimate = platforms.length * s.postsPerDay * CREDIT_COST.post;
  await spendCredits(user.id, estimate);
  try {
    const { created, errors } = await fillDay(date, platforms, s, topic?.slice(0, 300), user.requireApproval ? "pending_review" : "scheduled", user.role === "admin");
    await refundCredits(user.id, estimate - created.length * CREDIT_COST.post);
    return ok({ created: created.length, errors, pendingReview: user.requireApproval });
  } catch (e) {
    await refundCredits(user.id, estimate);
    throw e;
  }
});
