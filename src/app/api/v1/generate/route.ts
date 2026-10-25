import { apiKeyed, body, ok } from "@/lib/http-api";
import { startGeneration, type GenerationRequest } from "@/lib/generation";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/generate {"kind": "music"|"sfx"|"footage", "prompt", "seconds", …} → {"job": {"id"}, "credits"}.
 * Poll GET /api/v1/jobs/{id}; when it's done, "item_id" is the new Library item.
 */
export const POST = apiKeyed(async (req, user) => {
  const r = await startGeneration(user, await body<GenerationRequest>(req));
  return ok({ job: { id: r.job.id, status: r.job.status }, credits: r.credits }, 202);
});
