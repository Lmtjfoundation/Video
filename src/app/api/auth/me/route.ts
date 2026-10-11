import { authed, ok } from "@/lib/http-api";
import { publicUser } from "@/lib/auth";
import { planById } from "@/lib/plans";

export const dynamic = "force-dynamic";

export const GET = authed(async (_req, user) => {
  const plan = planById(user.plan);
  return ok({
    user: publicUser(user),
    plan,
    creditsLeft: Math.max(0, plan.credits - user.usage.credits),
    postsLeft: plan.postsPerMonth === null ? null : Math.max(0, plan.postsPerMonth - user.usage.posts),
  });
});
