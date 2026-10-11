import { cronAuthorized, fail, handle, ok } from "@/lib/http-api";
import { runPublish } from "@/lib/publisher";
import { forEachActiveUser } from "@/lib/tenants";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Publishes every due post, for every active account. */
export const GET = handle(async (req: Request) => {
  if (!cronAuthorized(req)) return fail("Unauthorized", 401);
  return ok(await forEachActiveUser(() => runPublish()));
});
