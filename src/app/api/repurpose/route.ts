import { authed, body, fail, ok } from "@/lib/http-api";
import { db } from "@/lib/db";
import { requireFeature, withCredits } from "@/lib/credits";
import { CREDIT_COST } from "@/lib/plans";
import { repurpose, storyText } from "@/lib/stories";
import { copyText } from "@/lib/compose";
import { getPost, getSettings, log, savePosts } from "@/lib/repo";
import { PLATFORMS, type Platform, type Story } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** One story or post → a native draft for each chosen platform. */
export const POST = authed(async (req, user) => {
  requireFeature(user, "repurpose", "Repurpose everywhere");
  const b = await body<{ storyId?: string; postId?: string; text?: string; platforms: Platform[] }>(req);
  const platforms = [...new Set((b.platforms ?? []).filter((p) => PLATFORMS.includes(p)))];
  if (!platforms.length) return fail("Choose at least one platform.");
  const s = await getSettings();
  let source = "";
  if (b.storyId) {
    const st = await db().get<Story>("stories", b.storyId);
    if (!st) return fail("Story not found", 404);
    source = storyText(st);
  } else if (b.postId) {
    const p = await getPost(b.postId);
    if (!p) return fail("Post not found", 404);
    source = copyText(p, s);
  } else source = String(b.text ?? "");
  if (source.trim().length < 40) return fail("Give at least a few sentences to repurpose.");
  const posts = await withCredits(platforms.length * CREDIT_COST.repurposePerPlatform, () => repurpose(source, platforms, s));
  await savePosts(posts);
  await log("info", "generate", `Repurposed into ${posts.length} drafts (${posts.map((p) => p.platform).join(", ")})`);
  return ok(posts);
});
