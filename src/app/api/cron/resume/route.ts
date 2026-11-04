import { cronAuthorized, fail, handle, ok } from "@/lib/http-api";
import { resumeInterrupted } from "@/lib/jobs";
import { sweepMovieWork } from "@/lib/movie-maker-render";
import { forEachActiveUser } from "@/lib/tenants";
import "@/lib/resumers";

export const dynamic = "force-dynamic";

/** Called by the server as it starts: carries on jobs a restart cut off, and clears old saved work. */
export const GET = handle(async (req: Request) => {
  if (!cronAuthorized(req)) return fail("Unauthorized", 401);
  const resumed = await forEachActiveUser(() => resumeInterrupted());
  await sweepMovieWork().catch(() => {});
  return ok({ resumed: Object.values(resumed).reduce<number>((n, v) => n + (typeof v === "number" ? v : 0), 0) });
});
