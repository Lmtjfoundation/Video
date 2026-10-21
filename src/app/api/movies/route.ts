import { authed, body, fail, ok } from "@/lib/http-api";
import { spendCredits } from "@/lib/auth";
import { CHARACTER_LOOKS, getCharacters } from "@/lib/characters";
import { withCredits } from "@/lib/credits";
import { mediaKey } from "@/lib/gemini-media";
import { isGraphicsLook } from "@/lib/looks";
import { writeMovie } from "@/lib/movie";
import { enqueueRender, ffmpegAvailable } from "@/lib/render";
import { getSettings, log, savePost } from "@/lib/repo";
import { ANIMATION_ENGINES, PLACEMENTS, PLATFORMS, type AnimationEngine, type Placement, type Platform } from "@/lib/types";
import { replicateReady } from "@/lib/replicate-video";
import { clamp, nowIso } from "@/lib/utils";
import { lengthAllowed, MAX_VEO_SCENES, MOVIE_LENGTHS, renderCredits, videoCredits, type MovieLength } from "@/lib/video-spec";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * Writes a movie or explainer video with AI visuals and saves it as a draft video post.
 * With `renderNow`, it also starts the render (pictures, Veo clips, voice and captions) straight away.
 */
export const POST = authed(async (req, user) => {
  const b = await body<{ kind?: "movie" | "explainer"; brief?: string; characterIds?: string[]; look?: string; platform?: Platform; length?: MovieLength; veoScenes?: number; engine?: AnimationEngine; voiceover?: boolean; renderNow?: boolean; autoPost?: boolean; placement?: Placement }>(req);
  const kind = b.kind === "explainer" ? "explainer" : "movie";
  const brief = String(b.brief ?? "").trim();
  if (brief.length < (kind === "movie" ? 10 : 40)) return fail(kind === "movie" ? "Describe the story in a sentence or two." : "Paste the text to explain (at least a few sentences).");
  const platform = PLATFORMS.includes(b.platform as Platform) && b.platform !== "webhook" ? (b.platform as Platform) : "tiktok";
  const length = MOVIE_LENGTHS.includes(b.length as MovieLength) ? (b.length as MovieLength) : "s60";
  if (!lengthAllowed(length, platform)) return fail("X allows videos up to 2 minutes 20 seconds. Pick a shorter length for X.");

  const engine: AnimationEngine = ANIMATION_ENGINES.includes(b.engine as AnimationEngine) ? (b.engine as AnimationEngine) : "veo";
  if (engine !== "veo" && Number(b.veoScenes) > 0 && !(await replicateReady())) {
    return fail(`${engine === "wan" ? "Wan 2.2" : "Seedance 2.5"} isn't connected yet. Ask the admin to add a Replicate API token in Admin → App settings → Integrations, or choose Gemini Omni Flash.`, 503);
  }
  const characters = await getCharacters(Array.isArray(b.characterIds) ? b.characterIds.slice(0, 6) : []);
  const look = String(b.look ?? "").trim().slice(0, 160) || characters[0]?.look || CHARACTER_LOOKS[0];
  // Graphics styles are drawn by the free motion-graphics engine; everything else needs Gemini for the pictures.
  if (!isGraphicsLook(look) && !(await mediaKey())) return fail("AI movies need the app's Gemini key for pictures and video clips. Ask the admin to add it in Admin → App settings → Integrations, or pick a Graphics style (free).", 503);
  const settings = await getSettings();

  const post = await withCredits(videoCredits(length, "plan"), () =>
    writeMovie({ kind, brief: brief.slice(0, 12_000), characters, look, platform, length, veoScenes: clamp(Number(b.veoScenes) || 0, 0, MAX_VEO_SCENES), engine }, settings),
  );
  if (PLACEMENTS.includes(b.placement as Placement)) post.placement = b.placement;
  if (b.voiceover === false && post.video) post.video.voiceover = false;
  // "Post automatically": the movie publishes itself as soon as its render finishes.
  const autoPost = typeof b.autoPost === "boolean" ? b.autoPost : settings.autoPost.enabled;
  if (autoPost) post.autoPost = true;
  let note = "";
  if (b.renderNow || autoPost) {
    if (!(await ffmpegAvailable())) note = "Saved. Video rendering isn't switched on for this server yet (ffmpeg missing).";
    else {
      const credits = renderCredits(post.video);
      try {
        await spendCredits(user.id, credits);
        post.render = { status: "queued", progress: 0, message: "Waiting to render…", credits, updatedAt: nowIso() };
      } catch (e) {
        note = `Saved as a draft, not rendered: ${(e as Error).message}`;
      }
    }
  }
  await savePost(post);
  if (post.render?.status === "queued") enqueueRender(user.id, post.id, post.render.credits ?? 0);
  await log("info", "generate", `${kind === "movie" ? "Movie" : "Explainer video"} written: “${post.hook}”`, { platform });
  return ok({ post, note });
});
