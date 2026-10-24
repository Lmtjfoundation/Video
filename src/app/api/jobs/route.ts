import { authed, ok } from "@/lib/http-api";
import { clearFinished, jobViews } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/** The person's recent background jobs (newest first), with renders followed through. */
export const GET = authed(async () => ok({ jobs: await jobViews() }));

/** Clears finished and failed jobs from the tray. */
export const DELETE = authed(async () => {
  await clearFinished();
  return ok({ jobs: await jobViews() });
});
