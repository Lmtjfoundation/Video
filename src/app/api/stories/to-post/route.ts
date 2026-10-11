import { authed, body, fail, ok } from "@/lib/http-api";
import { db } from "@/lib/db";
import { storyToPost } from "@/lib/stories";
import { getSettings, log, savePost } from "@/lib/repo";
import type { Story } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Saves a story script as a draft post (YouTube or TikTok) so it can be scheduled. */
export const POST = authed(async (req) => {
  const { id } = await body<{ id: string }>(req);
  const st = await db().get<Story>("stories", id);
  if (!st) return fail("Story not found", 404);
  const post = storyToPost(st, await getSettings());
  await savePost(post);
  await log("info", "generate", `Story saved as a ${post.platform} draft`, { platform: post.platform });
  return ok(post);
});
