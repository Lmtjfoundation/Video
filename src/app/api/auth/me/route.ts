import { authed, ok } from "@/lib/http-api";
import { publicUser, rollVault, vaultSummary } from "@/lib/auth";
import { planById } from "@/lib/plans";

export const dynamic = "force-dynamic";

export const GET = authed(async (_req, user) => {
  await rollVault(user);
  const plan = planById(user.plan);
  const vault = vaultSummary(user);
  return ok({
    user: publicUser(user),
    plan,
    creditsLeft: vault.balance,
    vault,
    postsLeft: plan.postsPerMonth === null ? null : Math.max(0, plan.postsPerMonth - user.usage.posts),
  });
});
