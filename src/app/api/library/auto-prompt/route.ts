import { authed, body, fail, ok } from "@/lib/http-api";
import { withCredits } from "@/lib/credits";
import { CREDIT_COST } from "@/lib/plans";
import { autoPrompt } from "@/lib/sound-studio";

export const dynamic = "force-dynamic";

/** Auto-prompt: a short idea becomes a full prompt for the music, sound-effect, footage or picture generator. */
export const POST = authed(async (req) => {
  const b = await body<{ kind?: string; idea?: string }>(req);
  const idea = String(b.idea ?? "").trim();
  if (!idea) return fail("Type an idea first.");
  const kind = (["music", "sfx", "footage", "image"].includes(String(b.kind)) ? b.kind : "music") as "music" | "sfx" | "footage" | "image";
  return ok({ prompt: await withCredits(CREDIT_COST.autoPrompt, () => autoPrompt(kind, idea)) });
});
