import { authed, body, fail, ok, RequestError } from "@/lib/http-api";
import { spendCredits, refundCredits } from "@/lib/auth";
import { CHARACTER_LOOK_GROUPS, getCharacters, listCharacters } from "@/lib/characters";
import { withCredits } from "@/lib/credits";
import { db } from "@/lib/db";
import { getSession } from "@/lib/director";
import { startJob } from "@/lib/jobs";
import { isSpeechLanguage, SPEECH_LANGUAGES } from "@/lib/languages";
import { signedUrl } from "@/lib/media";
import { ownEngineReady } from "@/lib/own-video";
import { picturesReady } from "@/lib/pictures";
import { CREDIT_COST } from "@/lib/plans";
import { enqueueRender, ffmpegAvailable } from "@/lib/render";
import { getPost, getSettings, log, savePost } from "@/lib/repo";
import { listStories, makeThumbnail, sourceText, startStory, storyPackage, type StoryInput } from "@/lib/story-video";
import { STORY_TEMPLATES, storyTemplate, type StorySourceKind } from "@/lib/story-templates";
import { PLATFORMS, type MediaItem, type Platform } from "@/lib/types";
import { nowIso } from "@/lib/utils";
import { checkVoice } from "@/lib/voice-lab";
import { lengthAllowed, MOVIE_LENGTHS, MOVIE_SHAPE, renderCredits, videoCredits, type MovieLength } from "@/lib/video-spec";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const KINDS: StorySourceKind[] = ["idea", "script", "media", "link", "file"];
const asked = <T>(p: Promise<T>) =>
  p.catch((e: Error) => {
    throw new RequestError(e.message);
  });

/** The person's stories, with their render state; `?package=<id>` downloads one as a .zip. */
export const GET = authed(async (req, user) => {
  const pkg = new URL(req.url).searchParams.get("package");
  if (pkg) {
    const p = await asked(storyPackage(pkg));
    return new Response(new Uint8Array(p.bytes), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${p.name}"`, "Cache-Control": "no-store" } });
  }
  const stories = [];
  for (const s of await listStories()) {
    const [session, post] = [await getSession(s.id), await getPost(s.postId)];
    if (!session || !post?.video) continue;
    const video = post.render?.status === "done" && post.render.mediaId ? await db().get<MediaItem>("media", post.render.mediaId) : null;
    stories.push({
      id: s.id,
      title: post.video.titles[0] || session.title,
      template: s.template,
      language: s.language,
      scenes: post.video.scenes.length,
      render: post.render ? { status: post.render.status, progress: post.render.progress, message: post.render.message } : null,
      videoUrl: video ? signedUrl(user.id, video.id, 6 * 3600) : null,
      thumbnailUrl: s.thumbnailId ? signedUrl(user.id, s.thumbnailId, 6 * 3600) : null,
      createdAt: s.createdAt,
    });
  }
  return ok({
    stories,
    templates: STORY_TEMPLATES,
    lookGroups: CHARACTER_LOOK_GROUPS,
    languages: SPEECH_LANGUAGES,
    engine: await ownEngineReady(),
    characters: (await listCharacters()).map((c) => ({ id: c.id, name: c.name, imageUrl: signedUrl(user.id, c.imageMediaId, 6 * 3600) })),
    credits: {
      // The most a story of each length costs: the storyboard, and for a render its assembly, a picture per scene
      // (at the length's most scenes) and, with an engine narrator, the speech (about 6 characters a word).
      estimate: Object.fromEntries(
        MOVIE_LENGTHS.map((l) => {
          const plan = videoCredits(l, "plan");
          const render = videoCredits(l, "render") + CREDIT_COST.aiImage * MOVIE_SHAPE[l].max;
          const speech = CREDIT_COST.speech * Math.ceil((Number(MOVIE_SHAPE[l].words.split("–")[1]?.split(" ")[0]) * 6) / 1000);
          return [l, { plan, render, speech }];
        }),
      ),
      thumbnail: CREDIT_COST.aiImage,
    },
  });
});

/** Start a story (in the background), or make its thumbnail. */
export const POST = authed(async (req, user) => {
  const b = await body<Record<string, unknown>>(req);
  if (b.action === "thumbnail") {
    const id = String(b.id ?? "");
    if (!(await listStories()).some((s) => s.id === id)) return fail("That story wasn't found.", 404);
    if (!(await ownEngineReady())) return fail("Thumbnails are painted on Ghost Post's engine, which isn't connected yet.", 503);
    const credits = CREDIT_COST.aiImage;
    await spendCredits(user.id, credits);
    const job = await startJob(user.id, { kind: "director", title: "Story thumbnail" }, async () => {
      try {
        const item = await makeThumbnail(user.id, id);
        return { href: "/story-video", message: `Thumbnail ready: ${item.name}` };
      } catch (e) {
        await refundCredits(user.id, credits);
        throw e;
      }
    });
    return ok({ job, credits });
  }
  if (b.action !== "start") return fail("Unknown action.");
  const t = storyTemplate(String(b.template ?? "general"));
  const src = (b.source ?? {}) as StoryInput["source"];
  if (!KINDS.includes(src.kind)) return fail("Choose where the story comes from.");
  const language = isSpeechLanguage(b.language) ? b.language : "en";
  const secondLanguage = t.bilingual && isSpeechLanguage(b.secondLanguage) ? b.secondLanguage : undefined;
  if (t.bilingual && !secondLanguage) return fail("Choose the second language.");
  const narrator = await asked(checkVoice(b.narrator));
  if (narrator.kind === "free" && language !== "en") return fail("The free voices speak English. For other languages, choose the engine voice or one of My Voices.");
  if (narrator.kind === "engine") narrator.language = language;
  if (narrator.kind === "engine" && !(await ownEngineReady())) return fail("That narrator speaks on Ghost Post's engine, which isn't connected yet. Choose a free voice (English) for now.", 503);
  const platform = PLATFORMS.includes(b.platform as Platform) && b.platform !== "webhook" ? (b.platform as Platform) : "tiktok";
  const length = MOVIE_LENGTHS.includes(b.length as MovieLength) ? (b.length as MovieLength) : t.length;
  if (!lengthAllowed(length, platform)) return fail("X allows videos up to 2 minutes 20 seconds. Pick a shorter length for X.");
  const cast = await getCharacters(Array.isArray(b.characterIds) ? b.characterIds.map(String).slice(0, 6) : []);
  const look = String(b.look ?? "").trim().slice(0, 160) || (cast.length ? cast[0].look : t.look);
  if (!(await picturesReady())) return fail("Story pictures are painted on Ghost Post's engine. The admin connects it in Admin → App settings → Integrations.", 503);
  if (b.instant === true && !(await ffmpegAvailable())) return fail("Video rendering isn't switched on for this server yet (ffmpeg missing).", 503);
  // Text sources are checked now, so a typo is a message, not a failed job.
  if (src.kind !== "media" && src.kind !== "link") await asked(sourceText(src));
  const input: StoryInput = { template: t.id, source: src, language, secondLanguage, narrator, characterIds: cast.map((c) => c.id), look, platform, length, instant: b.instant === true };
  const job = await startJob(user.id, { kind: "director", title: `Story: ${t.name}` }, async (say) => {
    say(src.kind === "media" ? "Listening to the recording…" : src.kind === "link" ? "Reading the page…" : "Writing the story…");
    const source = { kind: src.kind, ...(await sourceText(src)) };
    say("Writing the storyboard…");
    const r = await withCredits(videoCredits(length, "plan"), async () => startStory(input, source, await getSettings()));
    await log("info", "generate", `Story to Video (${t.name}): “${r.post.hook}”`, { postId: r.post.id });
    if (input.instant && r.post.video) {
      const credits = renderCredits(r.post.video);
      await spendCredits(user.id, credits);
      r.post.render = { status: "queued", progress: 0, message: "Waiting to render…", credits, updatedAt: nowIso() };
      await savePost(r.post);
      enqueueRender(user.id, r.post.id, credits);
      return { post: r.post, href: `/story-video`, message: "Storyboard written, now rendering" };
    }
    return { post: r.post, href: `/director?id=${r.session.id}`, message: "Storyboard ready: edit any scene, then render" };
  });
  return ok({ job });
});
