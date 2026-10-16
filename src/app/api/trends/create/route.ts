import { authed, body, fail, ok } from "@/lib/http-api";
import { createFromStory } from "@/lib/trend-autopilot";
import { genreById } from "@/lib/genres";
import { PLATFORMS, type Platform, type VideoPlan } from "@/lib/types";
import { lengthAllowed } from "@/lib/video-spec";
import { log } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** Turn a live story (or, without storyId, a fresh pick in the genre) into a draft post or video plan. */
export const POST = authed(async (req, user) => {
  const b = await body<{ genre?: string; storyId?: string; platform?: Platform; kind?: "text" | "video"; length?: VideoPlan["length"]; faceless?: boolean }>(req);
  if (!genreById(b.genre)) return fail("Choose a genre.");
  if (!b.platform || !PLATFORMS.includes(b.platform)) return fail("Choose a platform.");
  const kind = b.kind === "video" ? "video" : "text";
  if (kind === "video" && b.length && !lengthAllowed(b.length, b.platform)) return fail("That length isn't available on this platform.");
  const posts = await createFromStory({ genre: b.genre!, storyId: b.storyId, platform: b.platform, kind, length: b.length, faceless: b.faceless }, user.id);
  await log("info", "generate", `Trend Radar: ${kind === "video" ? "video plan" : "post"} for ${b.platform} — “${posts[0]?.hook ?? ""}”`, { platform: b.platform, genre: b.genre });
  return ok(posts);
});
