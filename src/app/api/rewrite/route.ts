import { body, fail, authed, ok } from "@/lib/http-api";
import { maximizeMoney } from "@/lib/generate";
import { getPost, getSettings, log, savePost } from "@/lib/repo";
import { withCredits } from "@/lib/credits";
import { CREDIT_COST } from "@/lib/plans";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/** One-click "Maximize Money Potential". */
export const POST = authed(async (req: Request) => {
  const { id } = await body<{ id: string }>(req);
  const post = await getPost(id);
  if (!post) return fail("Post not found", 404);
  if (post.status === "published") return fail("Already published.");
  const before = post.moneyScore;
  const s = await getSettings();
  const next = await withCredits(CREDIT_COST.maximize, () => maximizeMoney(post, s));
  await savePost(next);
  await log("info", "generate", `Money rewrite: score ${before} → ${next.moneyScore}`, { platform: next.platform, postId: next.id });
  return ok(next);
});
