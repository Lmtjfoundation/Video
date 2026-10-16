import { body, fail, authed, ok } from "@/lib/http-api";
import { getCredential, getPost, getSettings, listPosts, log, savePost } from "@/lib/repo";
import { handoffCaption, handoffMedia } from "@/lib/handoff";
import { isProfileCred, normalizePostLink } from "@/lib/facebook-profile";
import { nowIso } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Everything the "Post to your Facebook profile" screen needs: the caption as it would be posted, a signed link to
 * the HD video (or image), where the profile is, and the other posts that are waiting.
 */
export const GET = authed(async (req, user) => {
  const id = new URL(req.url).searchParams.get("id");
  const post = id ? await getPost(id) : null;
  if (!post) return fail("Post not found", 404);
  if (post.platform !== "facebook") return fail("This screen is for Facebook posts.");
  const [settings, cred, posts] = await Promise.all([getSettings(), getCredential("facebook"), listPosts()]);
  const media = await handoffMedia(user.id, post).catch((e: Error) => {
    throw new Error(`The video couldn't be prepared: ${e.message}`);
  });
  const waiting = posts
    .filter((p) => p.id !== post.id && p.platform === "facebook" && p.status === "copy_ready" && p.handoff && !p.handoff.postedAt)
    .sort((a, b) => (a.handoff!.readyAt ?? "").localeCompare(b.handoff!.readyAt ?? ""))
    .slice(0, 10)
    .map((p) => ({ id: p.id, hook: p.hook, kind: p.kind === "video" || p.videoUrl ? "video" : p.mediaIds?.length ? "media" : "text" }));
  return ok({
    post,
    caption: handoffCaption(post, settings),
    media,
    profile: { connected: isProfileCred(cred), name: cred?.profileName ?? null, url: cred?.profileUrl ?? null },
    waiting,
  });
});

/** "I posted it": records the post as published (optionally with its Facebook link) so the calendar and stats stay right. */
export const POST = authed(async (req) => {
  const input = await body<{ id?: string; link?: string }>(req);
  const post = input.id ? await getPost(input.id) : null;
  if (!post) return fail("Post not found", 404);
  if (post.platform !== "facebook") return fail("This screen is for Facebook posts.");
  if (post.status === "published") return ok(post);
  if (post.status !== "copy_ready") return fail("This post isn't ready yet. Press Get it ready first.");
  let link: string | null = null;
  if (input.link?.trim()) {
    link = normalizePostLink(input.link);
    if (!link) return fail("That isn't a Facebook link. Copy the link from your post (… → Copy link), or leave it blank.");
  }
  const at = nowIso();
  post.status = "published";
  post.publishedAt = at;
  post.error = undefined;
  if (link) post.externalUrl = link;
  post.handoff = { to: "facebook_profile", readyAt: post.handoff?.readyAt ?? at, notifiedAt: post.handoff?.notifiedAt, postedAt: at };
  await savePost(post);
  await log("info", "post", `Posted on your Facebook profile — “${post.hook.slice(0, 80)}”`, { platform: "facebook", postId: post.id, url: link ?? undefined });
  return ok(post);
});
