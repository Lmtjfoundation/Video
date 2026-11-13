import { authed, fail, ok } from "@/lib/http-api";
import { cosmosReady } from "@/lib/azure-cosmos";
import { tenantUsage } from "@/lib/tenancy";

export const dynamic = "force-dynamic";

/** This month's usage for your tenant (AI-motion seconds, renders, cost, API calls) and your plan's limits. */
export const GET = authed(async (_req, user) => {
  if (!(await cosmosReady())) return fail("Usage tracking isn't set up on this server yet.", 503);
  return ok(await tenantUsage(user.id, user.plan));
});
