import { promises as fs } from "fs";
import path from "path";
import { authed, body, fail, ok } from "@/lib/http-api";
import { spendCredits } from "@/lib/auth";
import { azureSpeechReady } from "@/lib/azure-speech";
import { foundryReady } from "@/lib/azure-foundry";
import { mediaKey } from "@/lib/gemini-media";
import { startJob } from "@/lib/jobs";
import { signedUrl } from "@/lib/media";
import { engineFor, ownClipEngineInfo } from "@/lib/own-video";
import { CREDIT_COST } from "@/lib/plans";
import { ffmpegAvailable, runCmd } from "@/lib/render";
import { allShots, EPISODE_ASPECTS, EPISODE_LENGTHS, type EpisodeAspect, type EpisodeLength } from "@/lib/episode-studio/plan";
import { deleteEpisode, episodeDir, episodeJob, getEpisode, listEpisodes, newEpisode, STEP_LABEL, type EpisodeRecord, type FilmEngine } from "@/lib/episode-studio/run";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const cost = (length: EpisodeLength, engine: FilmEngine) => CREDIT_COST.filmPlan + (engine === "gemini" ? CREDIT_COST.omni4kSecond : CREDIT_COST.ownSecond) * EPISODE_LENGTHS[length].seconds;

const pythonReady = async () => {
  try {
    await runCmd("python3", ["-c", "import cv2, numpy, PIL, scipy"], 20_000);
    return true;
  } catch {
    return false;
  }
};

/** An episode as the page shows it: progress, cast and frame previews, the finished video. */
async function view(r: EpisodeRecord, userId: string) {
  const file = (f: string) => `/api/episodes/file?id=${encodeURIComponent(r.id)}&f=${encodeURIComponent(f)}`;
  const dir = episodeDir(r.id);
  const has = (f: string) => fs.stat(path.join(dir, f)).then(() => true, () => false);
  const shots = r.plan ? allShots(r.plan) : [];
  return {
    id: r.id,
    prompt: r.prompt,
    length: r.length,
    aspect: r.aspect,
    engine: r.engine ?? null,
    step: r.step,
    stepLabel: STEP_LABEL[r.step],
    message: r.message,
    progress: r.progress,
    error: r.error ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    series: r.plan?.series ?? null,
    title: r.plan?.title ?? null,
    logline: r.plan?.logline ?? null,
    seconds: r.timeline ? Math.round(r.timeline.total) : null,
    cast: r.plan ? await Promise.all(r.plan.cast.map(async (c) => ({ key: c.key, name: c.name, role: c.role, voice: c.voice, image: (await has(`cast/${c.key}.png`)) ? file(`cast/${c.key}.png`) : null }))) : [],
    frames: (await Promise.all(shots.slice(0, 60).map(async (s) => ((await has(`stills/${s.id}.png`)) ? { id: s.id, image: file(`stills/${s.id}.png`), done: !!r.clips[s.id]?.done, verdict: r.clips[s.id]?.verdict ?? null } : null)))).filter(Boolean),
    shots: shots.length,
    filmed: shots.filter((s) => r.clips[s.id]?.done).length,
    videoUrl: r.mediaId ? signedUrl(userId, r.mediaId, 6 * 3600) : null,
  };
}

/** Your episodes, and whether this server can make them. */
export const GET = authed(async (_req, user) => {
  const all = (await listEpisodes()).filter((r) => r.owner === user.id || user.role === "admin");
  const [gemini, clips, lipsync, pictures, voices, ffmpeg, python] = await Promise.all([
    mediaKey().then((k) => !!k, () => false),
    engineFor("clips").then((e) => !!e, () => false),
    engineFor("lipsync").then((e) => !!e, () => false),
    foundryReady().catch(() => false),
    azureSpeechReady().catch(() => false),
    ffmpegAvailable(),
    pythonReady(),
  ]);
  return ok({
    episodes: await Promise.all(all.map((r) => view(r, user.id))),
    ready: { gemini, clips, lipsync, pictures, voices, ffmpeg, python },
    lengths: Object.entries(EPISODE_LENGTHS).map(([id, l]) => ({ id, label: l.label, seconds: l.seconds, shots: l.maxShots, credits: cost(id as EpisodeLength, "gemini"), gpuCredits: cost(id as EpisodeLength, "own") })),
  });
});

type Body = { action?: "create" | "resume" | "delete" | "gpu"; id?: string; prompt?: string; length?: EpisodeLength; aspect?: EpisodeAspect; engine?: FilmEngine };

export const POST = authed(async (req, user) => {
  const b = await body<Body>(req);
  if (b.action === "gpu") {
    // The GPU's queue and speed, for the time estimate on the page (wakes the machine if it's asleep).
    try {
      const i = await ownClipEngineInfo();
      return ok({ gpu: { ready: i.ready, queue: i.queue, device: i.device, quality: i.quality } });
    } catch (e) {
      return ok({ gpu: null, error: (e as Error).message });
    }
  }
  if (b.action === "delete" || b.action === "resume") {
    const r = b.id ? await getEpisode(b.id) : null;
    if (!r || (r.owner !== user.id && user.role !== "admin")) return fail("Episode not found.", 404);
    if (b.action === "delete") {
      if (!["done", "failed"].includes(r.step)) return fail("This episode is still being made. Wait for it to finish or stop.");
      await deleteEpisode(r.id);
      return ok({ deleted: true });
    }
    if (r.step !== "failed") return fail("Only a stopped episode can be resumed.");
    const credits = cost(r.length, r.engine ?? "own");
    await spendCredits(user.id, credits);
    r.credits = credits;
    r.step = "queued";
    r.error = undefined;
    r.message = "Resuming from the last finished step…";
    const { kvSet } = await import("@/lib/repo");
    await kvSet(`episode-studio:${r.id}`, r);
    await startJob(user.id, { kind: "film", title: r.plan?.title ?? "Episode", resume: { kind: "episode-studio", input: { id: r.id } } }, episodeJob(user.id, { id: r.id }));
    return ok({ episode: await view(r, user.id) });
  }
  // Create.
  const prompt = (b.prompt ?? "").trim();
  if (prompt.length < 12) return fail("Describe the series in a sentence or two: who, where, and what goes wrong.");
  if (prompt.length > 4000) return fail("Keep the premise under 4,000 characters.");
  const length: EpisodeLength = b.length && b.length in EPISODE_LENGTHS ? b.length : "short";
  const aspect: EpisodeAspect = b.aspect && (EPISODE_ASPECTS as readonly string[]).includes(b.aspect) ? b.aspect : "9:16";
  const [hasGemini, hasGpu] = await Promise.all([mediaKey().then((k) => !!k, () => false), engineFor("clips").then((e) => !!e, () => false)]);
  // Gemini films in 4K when the app has its key; the GPU engine when asked for, or when there's no Gemini key.
  const engine: FilmEngine = b.engine === "own" || (!b.engine && !hasGemini) ? "own" : "gemini";
  const missing: string[] = [];
  if (engine === "gemini" && !hasGemini) missing.push("the 4K cinema camera (the admin adds the Gemini key in Admin → App settings → Integrations → Gemini)");
  if (engine === "own" && !hasGpu) missing.push("Vueio's GPU engine (Admin → Integrations)");
  if (!(await foundryReady().catch(() => false))) missing.push("Azure AI pictures (Admin → Integrations)");
  if (!(await azureSpeechReady().catch(() => false))) missing.push("Azure voices (Admin → Integrations)");
  if (!(await ffmpegAvailable())) missing.push("ffmpeg on the server");
  if (!(await pythonReady())) missing.push("python3 with OpenCV, NumPy, Pillow and SciPy on the server");
  if (missing.length) return fail(`Episode Studio needs: ${missing.join("; ")}.`);
  const credits = cost(length, engine);
  await spendCredits(user.id, credits);
  const r = await newEpisode(user.id, { prompt, length, aspect, credits, engine });
  await startJob(user.id, { kind: "film", title: prompt.slice(0, 60), resume: { kind: "episode-studio", input: { id: r.id } } }, episodeJob(user.id, { id: r.id }));
  return ok({ episode: await view(r, user.id) });
});
