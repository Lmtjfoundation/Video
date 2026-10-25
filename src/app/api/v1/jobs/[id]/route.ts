import { apiKeyed, fail, ok } from "@/lib/http-api";
import { jobViews } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/** GET /api/v1/jobs/{id} → {"status": queued|running|done|failed, "message", "item_id"?} */
export const GET = apiKeyed(async (_req, _user, ctx) => {
  const { id } = await ctx.params;
  const j = (await jobViews()).find((x) => x.id === id);
  if (!j) return fail("No such job (finished jobs are kept for the 30 most recent).", 404);
  const item = j.href ? new URL(j.href, "http://x").searchParams.get("item") : null;
  return ok({ id: j.id, kind: j.kind, status: j.status, progress: j.progress, message: j.message, item_id: item, created_at: j.createdAt, updated_at: j.updatedAt });
});
