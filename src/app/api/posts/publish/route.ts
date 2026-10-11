import { body, fail, authed, ok } from "@/lib/http-api";
import { getPost, getSettings } from "@/lib/repo";
import { publishOne } from "@/lib/publisher";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** "Post now" — still respects the kill switch, safety filter and rate limits. */
export const POST = authed(async (req: Request) => {
  const { id } = await body<{ id: string }>(req);
  const post = await getPost(id);
  if (!post) return fail("Post not found", 404);
  const s = await getSettings();
  if (s.killSwitch) return fail("Kill switch is on.");
  const r = await publishOne(post, s, true);
  return ok({ ...r, post: await getPost(id) });
});
