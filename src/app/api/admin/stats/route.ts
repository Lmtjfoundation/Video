import { authed, body, ok } from "@/lib/http-api";
import { adminStats, saveOperatingCosts } from "@/lib/admin";
import type { OperatingCosts } from "@/lib/operating-costs";

export const dynamic = "force-dynamic";

export const GET = authed(async () => ok(await adminStats()), { admin: true });

/** Admin → Overview → Profit & operating costs: save the real monthly bills and hourly rates. */
export const PUT = authed(async (req) => {
  await saveOperatingCosts(await body<Partial<OperatingCosts>>(req));
  return ok(await adminStats());
}, { admin: true });
