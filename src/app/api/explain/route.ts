import { authed, body, fail, ok } from "@/lib/http-api";
import { withCredits } from "@/lib/credits";
import { CREDIT_COST } from "@/lib/plans";
import { EXPLAIN_LEVELS, cleanExplanation, explainText, explanationText, type ExplainLevel, type Explanation } from "@/lib/explain";
import { toPost } from "@/lib/generate";
import { getSettings, log, savePost } from "@/lib/repo";
import { PLATFORMS, type Platform } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * `explain`: writes a plain-language explanation of pasted text.
 * `save`: saves an explanation as a draft text post for one platform (no credits).
 */
export const POST = authed(async (req) => {
  const b = await body<{ action?: "explain" | "save"; text?: string; level?: ExplainLevel; explanation?: Explanation; platform?: Platform }>(req);
  if (b.action === "save") {
    if (!b.explanation) return fail("Nothing to save yet.");
    const platform = PLATFORMS.includes(b.platform as Platform) ? (b.platform as Platform) : "facebook";
    const e = cleanExplanation(b.explanation);
    const text = explanationText(e);
    const post = toPost({ pillar: "ai_leverage", format: platform === "x" ? "thread" : "short", topic: e.title, hook: e.title, body: text.slice(e.title.length).trim(), hashtags: [] }, platform, await getSettings());
    await savePost(post);
    await log("info", "generate", `Explanation saved as a ${platform} draft: “${e.title}”`, { platform });
    return ok(post);
  }
  const level: ExplainLevel = b.level && b.level in EXPLAIN_LEVELS ? b.level : "general";
  const text = String(b.text ?? "");
  const explanation = await withCredits(CREDIT_COST.explain * (text.length > 8000 ? 2 : 1), () => explainText(text, level));
  return ok({ explanation, text: explanationText(explanation) });
});
