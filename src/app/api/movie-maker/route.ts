import { authed, body, fail, ok } from "@/lib/http-api";
import { spendCredits } from "@/lib/auth";
import { listCharacters } from "@/lib/characters";
import { startJob } from "@/lib/jobs";
import { signedUrl } from "@/lib/media";
import {
  EFFECT_LABELS,
  FRAME_LABELS,
  GRADE_LABELS,
  GRADES,
  MAX_SCENES,
  MOVE_LABELS,
  movieCredits,
  parsePlan,
  sceneFrom,
  TITLE_LABELS,
  type Grade,
  type MoviePlan,
  type MovieScene,
} from "@/lib/movie-maker";
import { listMovies, motionEngineReady, movieJob, type RenderInput } from "@/lib/movie-maker-render";
import { picturesReady } from "@/lib/pictures";
import { CREDIT_COST } from "@/lib/plans";
import { ffmpegAvailable } from "@/lib/render";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Options for the editor, and the person's finished movies. */
export const GET = authed(async (_req, user) => {
  return ok({
    movies: (await listMovies()).map((m) => ({ ...m, videoUrl: signedUrl(user.id, m.mediaId, 6 * 3600) })),
    characters: (await listCharacters()).map((c) => ({ id: c.id, name: c.name, imageUrl: signedUrl(user.id, c.imageMediaId, 6 * 3600) })),
    options: { moves: MOVE_LABELS, effects: EFFECT_LABELS, frames: FRAME_LABELS, titles: TITLE_LABELS, grades: GRADE_LABELS },
    cost: { aiImage: CREDIT_COST.aiImage, speech: CREDIT_COST.speech },
    ready: { pictures: await picturesReady(), engine: (await motionEngineReady()) && (await ffmpegAvailable()) },
  });
});

const cleanPlan = (raw: unknown): MoviePlan => {
  const p = (raw ?? {}) as Partial<MoviePlan>;
  const scenes = (Array.isArray(p.scenes) ? p.scenes : []).slice(0, MAX_SCENES).map((s, i) => sceneFrom(s as Partial<MovieScene>, i));
  return { title: String(p.title ?? "").slice(0, 120), look: String(p.look ?? "").slice(0, 300), voice: String(p.voice ?? "").slice(0, 200), music: String(p.music ?? "").slice(0, 200), caption: String(p.caption ?? "").slice(0, 2000), scenes };
};

/** `parse` turns pasted text into a scene list; `render` makes the movie in the background. */
export const POST = authed(async (req, user) => {
  const b = await body<Record<string, unknown>>(req);
  if (b.action === "parse") {
    const text = String(b.text ?? "");
    if (text.trim().length < 10) return fail("Paste a plan or a story first.");
    const plan = parsePlan(text.slice(0, 60_000));
    if (!plan.scenes.length) return fail("No scenes were found in that text.");
    return ok({ plan });
  }
  if (b.action !== "render") return fail("Unknown action.");
  const plan = cleanPlan(b.plan);
  if (!plan.scenes.length) return fail("Add at least one scene.");
  if (plan.scenes.some((s) => !s.mediaId && !s.visual && !s.narration)) return fail("Every scene needs a picture description or a picture from your library.");
  if (!(await motionEngineReady()) || !(await ffmpegAvailable())) return fail("The motion engine isn't installed on this server yet.", 503);
  if (plan.scenes.some((s) => !s.mediaId) && !(await picturesReady())) return fail("Scene pictures can't be made right now. Pick pictures from your library for each scene, or ask the admin to connect pictures.", 503);
  const grade: Grade = GRADES.includes(b.grade as Grade) ? (b.grade as Grade) : "cadmium_purple";
  const voice = b.voice !== false;
  const credits = movieCredits(plan, CREDIT_COST, voice);
  await spendCredits(user.id, credits);
  const input: RenderInput = {
    plan,
    grade,
    characterIds: Array.isArray(b.characterIds) ? b.characterIds.map(String).slice(0, 3) : [],
    voice,
    musicMediaId: b.musicMediaId ? String(b.musicMediaId) : undefined,
    endCard: String(b.endCard ?? "").slice(0, 60),
    fiction: b.fiction === true,
  };
  // Resumable: if the server restarts mid-render, it carries on from the last finished step (src/lib/resumers.ts).
  const job = await startJob(user.id, { kind: "movie", title: `Movie: ${plan.title || "Untitled"}`, resume: { kind: "movie-maker", input: { ...input, credits } } }, movieJob(user.id, { ...input, credits }));
  return ok({ job, credits });
});

