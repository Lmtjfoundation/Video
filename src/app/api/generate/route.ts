import { body, fail, authed, ok } from "@/lib/http-api";
import { generatePosts } from "@/lib/generate";
import { credentialStatuses, getSettings, log, savePosts } from "@/lib/repo";
import type { Format, Pillar, Placement, Platform } from "@/lib/types";
import { FORMATS, PILLARS, PLACEMENTS, PLATFORMS } from "@/lib/types";
import { autoPublish } from "@/lib/publisher";
import { clamp } from "@/lib/utils";
import { withCredits } from "@/lib/credits";
import { CREDIT_COST } from "@/lib/plans";
import { generateVideoPosts } from "@/lib/video";
import { lengthAllowed, renderCredits, videoCredits, VIDEO_LENGTHS, VIDEO_STYLES } from "@/lib/video-spec";
import type { Platform as P, Post, Settings, VideoPlan } from "@/lib/types";
import { LLMError } from "@/lib/llm";
import { takeFromBank } from "@/lib/inbox";
import { genreById } from "@/lib/genres";
import { spendCredits } from "@/lib/auth";
import { enqueueRender, ffmpegAvailable } from "@/lib/render";
import { nowIso } from "@/lib/utils";

/**
 * When Claude's API can't write (no credits, key problem), hand out finished pieces Claude already wrote
 * in the daily batch instead of failing. Only the account that receives the daily batch has a reserve.
 */
async function withBankFallback(platform: P, kind: "text" | "video", count: number, s: Settings, run: () => Promise<Post[]>) {
  try {
    return { posts: await run(), fromBank: false };
  } catch (e) {
    if (!(e instanceof LLMError)) throw e;
    const posts = await takeFromBank(platform, kind, count, s);
    if (!posts.length) {
      const more = `Claude's daily batch has no ${kind === "video" ? "video plans" : "posts"} left in reserve for this platform; more arrive every morning around 6 AM Central.`;
      throw new LLMError(e.message, e.ownerMessage ? `${e.ownerMessage} ${more}` : more);
    }
    return { posts, fromBank: true };
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = authed(async (req: Request, user) => {
  const b = await body<{ kind?: "text" | "video"; platform: Platform; pillar?: Pillar | "auto"; format?: Format | "auto"; topic?: string; count?: number; imageUrl?: string; mediaIds?: string[]; mature?: boolean; niche?: string; style?: VideoPlan["style"]; length?: VideoPlan["length"]; genre?: string; sourceText?: string; faceless?: boolean; renderNow?: boolean; autoPost?: boolean; placement?: Placement; account?: string }>(req);
  const genre = genreById(b.genre) ? b.genre : undefined;
  // Text to video / text to post: build only from pasted material.
  const sourceText = typeof b.sourceText === "string" && b.sourceText.trim().length >= 40 ? b.sourceText.trim().slice(0, 15000) : undefined;
  if (!PLATFORMS.includes(b.platform)) return fail("Choose a platform.");
  if (b.kind !== "text" && b.kind !== "video") return fail("Choose Text post or Video post.");
  const s = await getSettings();
  // "Post automatically": text posts publish as soon as they're written, videos as soon as they're rendered.
  const autoPost = typeof b.autoPost === "boolean" ? b.autoPost : s.autoPost.enabled;
  const placement = PLACEMENTS.includes(b.placement as Placement) ? b.placement : undefined;
  // An extra account on this network (Platforms tab). Unknown ids fall back to the main account.
  const account = b.account && (await credentialStatuses()).find((c) => c.platform === b.platform)?.accounts?.some((a) => a.id === b.account) ? b.account : undefined;

  if (b.kind === "video") {
    const length = b.length && b.length in VIDEO_LENGTHS ? b.length : "s60";
    if (!lengthAllowed(length, b.platform)) {
      return fail(length === "long" ? "16:9 long-form is for YouTube and Facebook. Pick another length for this platform." : length === "m10" ? "10-minute videos are for TikTok, Facebook and YouTube. Pick a shorter length for this platform." : "X allows videos up to 2 minutes 20 seconds. Pick a shorter length for X.");
    }
    const style = b.style && b.style in VIDEO_STYLES ? b.style : "true";
    const n = clamp(Number(b.count) || 1, 1, 3);
    const mediaIds = Array.isArray(b.mediaIds) ? b.mediaIds.slice(0, 10) : undefined;
    const { posts: videos, fromBank } = await withBankFallback(b.platform, "video", n, s, () =>
      withCredits(n * videoCredits(length, "plan"), () =>
        generateVideoPosts({ platform: b.platform, count: n, niche: String(b.niche ?? (genre ? "auto" : "edu")), style, length, topic: b.topic?.slice(0, 500), mediaIds, genre, sourceText, faceless: typeof b.faceless === "boolean" ? b.faceless : undefined }, s),
      ),
    );
    if (fromBank && mediaIds?.length) videos.forEach((p) => (p.mediaIds = mediaIds));
    for (const v of videos) {
      if (placement) v.placement = placement;
      if (account) v.account = account;
      if (autoPost) v.autoPost = true;
    }
    // "Render it now": turn the plan straight into an MP4 (render credits as usual). Auto-posted videos always render.
    if ((b.renderNow || autoPost) && (await ffmpegAvailable())) {
      for (const v of videos) {
        const credits = renderCredits(v.video);
        try {
          await spendCredits(user.id, credits);
        } catch {
          break; // not enough credits to render: the plan is still saved and can be rendered later
        }
        v.render = { status: "queued", progress: 0, message: "Waiting to render…", credits, updatedAt: nowIso() };
      }
    }
    await savePosts(videos);
    for (const v of videos) if (v.render?.status === "queued") enqueueRender(user.id, v.id, v.render.credits ?? 0);
    await log("info", "generate", `${fromBank ? "From Claude's daily batch (API out of credits): " : ""}Video plan${videos.length > 1 ? "s" : ""}: ${videos.map((p) => `“${p.hook}”`).join(", ")}`, { platform: b.platform });
    return ok(videos);
  }
  const count = clamp(Number(b.count) || 1, 1, 5);
  const pillars = b.pillar && b.pillar !== "auto" && PILLARS.includes(b.pillar) ? Array(count).fill(b.pillar) : undefined;
  const format = b.format && b.format !== "auto" && FORMATS.includes(b.format) ? b.format : undefined;

  const { posts, fromBank } = await withBankFallback(b.platform, "text", count, s, () =>
    withCredits(count * CREDIT_COST.post, () =>
      generatePosts({ platform: b.platform, count, pillars: genre ? undefined : pillars, format, topic: b.topic?.slice(0, 500), mature: b.mature, genre, sourceText }, s),
    ),
  );
  if (b.imageUrl) posts.forEach((p) => (p.imageUrl = b.imageUrl));
  if (Array.isArray(b.mediaIds) && b.mediaIds.length) posts.forEach((p) => (p.mediaIds = b.mediaIds!.slice(0, 10)));
  if (placement) posts.forEach((p) => (p.placement = placement));
  if (account) posts.forEach((p) => (p.account = account));
  await savePosts(posts);
  await log("info", "generate", fromBank ? `Gave ${posts.length} ${b.platform} draft(s) from Claude's daily batch (API out of credits)` : `Generated ${posts.length} ${b.platform} draft(s)`, { platform: b.platform, topic: b.topic });
  if (autoPost) {
    for (const p of posts) await autoPublish(p, { requireApproval: user.requireApproval });
  }
  return ok(posts);
});
