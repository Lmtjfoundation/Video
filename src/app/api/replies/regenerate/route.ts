import { body, fail, authed, ok } from "@/lib/http-api";
import { regenerateReply } from "@/lib/engage";
import { getReply } from "@/lib/repo";
import type { ReplyMode } from "@/lib/types";
import { REPLY_MODES } from "@/lib/types";
import { withCredits } from "@/lib/credits";
import { CREDIT_COST } from "@/lib/plans";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = authed(async (req: Request) => {
  const { id, mode } = await body<{ id: string; mode: ReplyMode }>(req);
  const r = await getReply(id);
  if (!r) return fail("Reply not found", 404);
  if (r.status === "sent") return fail("Already sent.");
  return ok(await withCredits(CREDIT_COST.regen, () => regenerateReply(r, REPLY_MODES.includes(mode) ? mode : "auto")));
});
