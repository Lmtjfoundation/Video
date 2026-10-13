import { body, fail, authed, ok } from "@/lib/http-api";
import { generatePosts } from "@/lib/generate";
import { getSettings, log, savePosts } from "@/lib/repo";
import type { Format, Pillar, Platform } from "@/lib/types";
import { FORMATS, PILLARS, PLATFORMS } from "@/lib/types";
import { clamp } from "@/lib/utils";
import { withCredits } from "@/lib/credits";
import { CREDIT_COST } from "@/lib/plans";
import { generateVideoPosts } from "@/lib/video";
import { lengthAllowed, videoCredits, VIDEO_LENGTHS, VIDEO_STYLES } from "@/lib/video-spec";
import type { Platform as P, Post, Settings, VideoPlan } from "@/lib/types";
import { LLMError } from "@/lib/llm";
import { takeFromBank } from "@/lib/inbox";

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
export const maxDuration = 120;

export const POST = authed(async (req: Request) => {
  const b = await body<{ kind?: "text" | "video"; platform: Platform; pillar?: Pillar | "auto"; format?: Format | "auto"; topic?: string; count?: number; imageUrl?: string; mediaIds?: string[]; mature?: boolean; niche?: string; style?: VideoPlan["style"]; length?: VideoPlan["length"] }>(req);
  if (!PLATFORMS.includes(b.platform)) return fail("Choose a platform.");
  if (b.kind !== "text" && b.kind !== "video") return fail("Choose Text post or Video post.");
  const s = await getSettings();

  if (b.kind === "video") {
    const length = b.length && b.length in VIDEO_LENGTHS ? b.length : "s60";
    if (!lengthAllowed(length, b.platform)) {
      return fail(length === "long" ? "Long-form videos are for YouTube. Pick a shorter length for this platform." : "X allows videos up to 2 minutes 20 seconds. Pick a shorter length for X.");
    }
    const style = b.style && b.style in VIDEO_STYLES ? b.style : "true";
    const n = clamp(Number(b.count) || 1, 1, 3);
    const mediaIds = Array.isArray(b.mediaIds) ? b.mediaIds.slice(0, 10) : undefined;
    const { posts: videos, fromBank } = await withBankFallback(b.platform, "video", n, s, () =>
      withCredits(n * videoCredits(length, "plan"), () =>
        generateVideoPosts({ platform: b.platform, count: n, niche: String(b.niche ?? "edu"), style, length, topic: b.topic?.slice(0, 500), mediaIds }, s),
      ),
    );
    if (fromBank && mediaIds?.length) videos.forEach((p) => (p.mediaIds = mediaIds));
    await savePosts(videos);
    await log("info", "generate", `${fromBank ? "From Claude's daily batch (API out of credits): " : ""}Video plan${videos.length > 1 ? "s" : ""}: ${videos.map((p) => `“${p.hook}”`).join(", ")}`, { platform: b.platform });
    return ok(videos);
  }
  const count = clamp(Number(b.count) || 1, 1, 5);
  const pillars = b.pillar && b.pillar !== "auto" && PILLARS.includes(b.pillar) ? Array(count).fill(b.pillar) : undefined;
  const format = b.format && b.format !== "auto" && FORMATS.includes(b.format) ? b.format : undefined;

  const { posts, fromBank } = await withBankFallback(b.platform, "text", count, s, () =>
    withCredits(count * CREDIT_COST.post, () =>
      generatePosts({ platform: b.platform, count, pillars, format, topic: b.topic?.slice(0, 500), mature: b.mature }, s),
    ),
  );
  if (b.imageUrl) posts.forEach((p) => (p.imageUrl = b.imageUrl));
  if (Array.isArray(b.mediaIds) && b.mediaIds.length) posts.forEach((p) => (p.mediaIds = b.mediaIds!.slice(0, 10)));
  await savePosts(posts);
  await log("info", "generate", fromBank ? `Gave ${posts.length} ${b.platform} draft(s) from Claude's daily batch (API out of credits)` : `Generated ${posts.length} ${b.platform} draft(s)`, { platform: b.platform, topic: b.topic });
  return ok(posts);
});
