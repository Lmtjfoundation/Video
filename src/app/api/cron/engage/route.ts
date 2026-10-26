import { cronAuthorized, fail, handle, ok } from "@/lib/http-api";
import { runEngage } from "@/lib/engage";
import { forEachActiveUser, hasAutoReplies } from "@/lib/tenants";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Checks comments and drafts/sends replies for every account whose plan includes automatic replies. */
export const GET = handle(async (req: Request) => {
  if (!cronAuthorized(req)) return fail("Unauthorized", 401);
  // This server was moved: the new one runs the schedule, so nothing is posted twice.
  if (await (await import("@/lib/migrate")).movedTo()) return ok({ skipped: "moved" });
  return ok(await forEachActiveUser(() => runEngage(), hasAutoReplies));
});
