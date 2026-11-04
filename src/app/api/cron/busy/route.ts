import { cronAuthorized, fail, handle, ok } from "@/lib/http-api";
import { liveJobCount } from "@/lib/jobs";
import { rendersInFlight } from "@/lib/render";

export const dynamic = "force-dynamic";

/** How much work this server is doing right now; the deploy waits for 0 before restarting. */
export const GET = handle(async (req: Request) => {
  if (!cronAuthorized(req)) return fail("Unauthorized", 401);
  const jobs = liveJobCount();
  const renders = rendersInFlight();
  return ok({ busy: jobs + renders, jobs, renders });
});
