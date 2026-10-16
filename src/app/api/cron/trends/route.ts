import { cronAuthorized, fail, handle, ok } from "@/lib/http-api";
import { forEachActiveUser } from "@/lib/tenants";
import { runTrendAutopilot } from "@/lib/trend-autopilot";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Trend Autopilot for every account that has it on (each account runs at most every 2 hours). */
export const GET = handle(async (req: Request) => {
  if (!cronAuthorized(req)) return fail("Unauthorized", 401);
  return ok(await forEachActiveUser((u) => runTrendAutopilot(u)));
});
