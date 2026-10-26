import { cronAuthorized, fail, handle, ok } from "@/lib/http-api";
import { runPublish } from "@/lib/publisher";
import { forEachActiveUser } from "@/lib/tenants";
import { sweepVaults } from "@/lib/vault-sweep";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Publishes every due post, for every active account, then keeps credit vaults current (at most every 30 minutes). */
export const GET = handle(async (req: Request) => {
  if (!cronAuthorized(req)) return fail("Unauthorized", 401);
  // This server was moved: the new one runs the schedule, so nothing is posted twice.
  if (await (await import("@/lib/migrate")).movedTo()) return ok({ skipped: "moved" });
  const result = await forEachActiveUser((u) => runPublish(u));
  await sweepVaults().catch((e) => console.error("[vault] sweep failed:", (e as Error).message));
  return ok(result);
});
