import { cronAuthorized, fail, handle, ok } from "@/lib/http-api";
import { importInbox } from "@/lib/inbox";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Imports new drafts that Claude wrote in a scheduled cloud session (see src/lib/inbox.ts). */
export const GET = handle(async (req: Request) => {
  if (!cronAuthorized(req)) return fail("Unauthorized", 401);
  // This server was moved: the new one runs the schedule, so nothing is posted twice.
  if (await (await import("@/lib/migrate")).movedTo()) return ok({ skipped: "moved" });
  const result = await importInbox();
  if (result.imported || result.errors.length) console.log(`[inbox] imported ${result.imported}, skipped ${result.skipped}${result.errors.length ? `: ${result.errors.slice(0, 3).join(" | ")}` : ""}`);
  return ok(result);
});
