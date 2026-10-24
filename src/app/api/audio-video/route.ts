import { authed, body, fail, ok } from "@/lib/http-api";
import { credentialStatuses, getSettings, log, savePosts } from "@/lib/repo";
import { PLACEMENTS, PLATFORMS, VIDEO_VISUALS, type Placement, type Platform, type VideoVisuals } from "@/lib/types";
import { withCredits } from "@/lib/credits";
import { spendCredits } from "@/lib/auth";
import { enqueueRender, ffmpegAvailable } from "@/lib/render";
import { renderCredits, videoCredits } from "@/lib/video-spec";
import { audioCuts, lengthForSeconds } from "@/lib/audio-scenes";
import { AudioVideoError, audioLengthProblem, planAudioVideo, readAudio } from "@/lib/audio-video";
import { nowIso } from "@/lib/utils";
import { LLMError } from "@/lib/llm";
import type { Post } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Audio to video: an uploaded recording (podcast, voice note, song, sermon…) becomes a video whose pictures follow
 * what is said. The recording is transcribed on the server for free, Claude picks a picture for every moment
 * (video plan credits), and with "render now" it is made into an MP4 with the recording as its soundtrack.
 */
export const POST = authed(async (req, user) => {
  const b = await body<{ mediaId: string; platform: Platform; landscape?: boolean; visuals?: VideoVisuals; about?: string; renderNow?: boolean; autoPost?: boolean; placement?: Placement; account?: string }>(req);
  if (!PLATFORMS.includes(b.platform)) return fail("Choose a platform.");
  if (!b.mediaId) return fail("Choose a recording.");
  if (!(await ffmpegAvailable())) return fail("Audio to video needs ffmpeg on the server. Ask the admin to add it.", 503);
  const landscape = !!b.landscape;

  let audio;
  try {
    audio = await readAudio(b.mediaId);
  } catch (e) {
    if (e instanceof AudioVideoError) return fail(e.message);
    throw e;
  }
  const problem = audioLengthProblem(audio.total, b.platform, landscape);
  if (problem) return fail(problem);
  const cuts = audioCuts(audio.lines, audio.total);
  const length = lengthForSeconds(audio.total, landscape)!;

  const s = await getSettings();
  const autoPost = typeof b.autoPost === "boolean" ? b.autoPost : s.autoPost.enabled;
  const opts = { mediaId: b.mediaId, platform: b.platform, landscape, visuals: VIDEO_VISUALS.includes(b.visuals as VideoVisuals) ? b.visuals : undefined, about: b.about?.trim().slice(0, 500) || undefined };
  let post: Post;
  let plain = false;
  try {
    post = await withCredits(videoCredits(length, "plan"), () => planAudioVideo(opts, { ...audio, cuts }, s));
  } catch (e) {
    // Claude unavailable (not connected, out of credits): still make the video, free, with each scene's own words
    // choosing its stock footage. The credits for planning were already put back.
    if (!(e instanceof LLMError)) throw e;
    post = await planAudioVideo({ ...opts, plain: true }, { ...audio, cuts }, s);
    plain = true;
  }
  if (PLACEMENTS.includes(b.placement as Placement)) post.placement = b.placement;
  if (b.account && (await credentialStatuses()).find((c) => c.platform === b.platform)?.accounts?.some((a) => a.id === b.account)) post.account = b.account;
  if (autoPost) post.autoPost = true;
  if (b.renderNow || autoPost) {
    const credits = renderCredits(post.video);
    try {
      await spendCredits(user.id, credits);
      post.render = { status: "queued", progress: 0, message: "Waiting to render…", credits, updatedAt: nowIso() };
    } catch {
      // Not enough credits to render: the plan is saved and can be rendered later.
    }
  }
  await savePosts([post]);
  if (post.render?.status === "queued") enqueueRender(user.id, post.id, post.render.credits ?? 0);
  await log("info", "generate", `Audio to video: “${post.hook}” (${Math.round(audio.total)}s, ${cuts.length} scenes${plain ? ", planned without Claude" : ""})`, { platform: b.platform, postId: post.id });
  return ok(post);
});
