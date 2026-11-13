import "server-only";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { getCharacters, characterRef } from "./characters";
import { db } from "./db";
import { readFile, storeFile, storeFilePath } from "./media";
import { makeImage } from "./pictures";
import { loudnessFilter, MASTER_CHAIN } from "./mix";
import { mediaDuration, narrate, runCmd } from "./render";
import { kvGet, kvSet } from "./repo";
import type { MediaItem } from "./types";
import { nowIso, uid } from "./utils";
import { wasInterrupted, type JobFn } from "./jobs";
import { refundCredits } from "./auth";
import { filmSpec, picturePrompt, spokenText, type Grade, type MoviePlan } from "./movie-maker";

export interface MovieRecord {
  id: string;
  title: string;
  scenes: number;
  seconds: number;
  mediaId: string;
  createdAt: string;
}

const ROW = "movie-maker";
export const listMovies = async () => (await kvGet<MovieRecord[]>(ROW)) ?? [];

export interface RenderInput {
  plan: MoviePlan;
  grade: Grade;
  characterIds: string[];
  voice: boolean;
  /** A song or score from the library; without one, a low cinematic drone is drawn under the voice. */
  musicMediaId?: string;
  endCard: string;
  fiction: boolean;
}

const TITLE_SECONDS = 2.5;
const engineScript = () => path.join(process.cwd(), "scripts", "movie-motion", "engine.py");
const python = () => process.env.MOVIE_PYTHON || "python3";

/** Whether this server can run the motion engine (Python with OpenCV, NumPy and Pillow). */
export async function motionEngineReady(): Promise<boolean> {
  try {
    await runCmd(python(), ["-c", "import cv2, numpy, PIL"], 30_000);
    await fs.access(engineScript());
    return true;
  } catch {
    return false;
  }
}

/** Where a job keeps its finished steps, so a run cut off by a restart carries on without paying twice. */
export const movieWorkDir = (jobId: string) => path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "movie-jobs", jobId.replace(/[^\w-]/g, ""));

const exists = (f: string) => fs.access(f).then(() => true, () => false);
/** Write via a temporary name, so a file cut off half-way is never mistaken for a finished one. */
async function writeDone(file: string, bytes: Buffer | string) {
  await fs.writeFile(`${file}.part`, bytes);
  await fs.rename(`${file}.part`, file);
}

/** Remove saved work of movie jobs older than two days (finished ones remove their own). */
export async function sweepMovieWork(maxAgeMs = 2 * 86400_000) {
  const root = path.dirname(movieWorkDir("x"));
  for (const d of await fs.readdir(root).catch(() => [] as string[])) {
    const st = await fs.stat(path.join(root, d)).catch(() => null);
    if (st && Date.now() - st.mtimeMs > maxAgeMs) await fs.rm(path.join(root, d), { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Make the movie: pictures, voices, the motion render, the sound mix. Returns the saved video. With `workDir`, each
 * finished step is kept there and reused when the job is picked up again after a restart.
 */
/** Scenes per chapter of a long movie: each chapter is filmed and mixed on its own, then the chapters are joined. */
export const CHAPTER_SCENES = 30;
/** The longest movie Curbflix makes: 1 hour 30 minutes. */
export const MAX_MOVIE_SECONDS = 90 * 60;

export async function renderMovie(userId: string, input: RenderInput, say: (m: string) => void, workDir?: string, opts: { saveTo?: string } = {}): Promise<MovieRecord> {
  const dir = workDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), "gp-movie-")));
  await fs.mkdir(dir, { recursive: true });
  try {
    const { plan } = input;
    const cast = await getCharacters(input.characterIds);
    const refs = (await Promise.all(cast.map(characterRef))).filter((r) => r !== null).slice(0, 3);
    const look = [plan.look, cast.map((c) => `${c.name}: ${c.look}`).join("; ")].filter(Boolean).join(". ");

    // 1. Pictures: the library picture when the scene has one, otherwise one made from its Visual line.
    const images: string[] = [];
    for (const [i, s] of plan.scenes.entries()) {
      say(`Picture ${i + 1} of ${plan.scenes.length}…`);
      const file = path.join(dir, `s${i}.png`);
      images.push(file);
      if (await exists(file)) continue;
      const m = s.mediaId ? await db().get<MediaItem>("media", s.mediaId) : null;
      if (m && m.kind === "image") await writeDone(file, await readFile(m));
      else await writeDone(file, (await makeImage({ prompt: picturePrompt(s, look), refs, aspect: "9:16" })).bytes);
    }

    // 2. Voices: each scene lasts at least as long as its line.
    const lines: (string | null)[] = [];
    const seconds = plan.scenes.map((s) => s.seconds);
    if (input.voice) {
      for (const [i, s] of plan.scenes.entries()) {
        const text = spokenText(s);
        if (!text) {
          lines.push(null);
          continue;
        }
        const mark = path.join(dir, `v${i}.json`);
        let file = (await exists(mark)) ? (JSON.parse(await fs.readFile(mark, "utf8")) as { file: string }).file : "";
        if (!file || !(await exists(file))) {
          say(`Voice ${i + 1} of ${plan.scenes.length}…`);
          file = await narrate(text, path.join(dir, `v${i}`));
          await writeDone(mark, JSON.stringify({ file }));
        }
        lines.push(file);
        seconds[i] = Math.max(seconds[i], Math.min(20, (await mediaDuration(file)) + 0.45));
      }
    }

    // 3. The motion render.
    const title = plan.title.trim();
    const spec = filmSpec({ scenes: plan.scenes.map((s, i) => ({ ...s, image: images[i], seconds: seconds[i] })), grade: input.grade, title, endCard: input.endCard.trim(), fiction: input.fiction });
    const total = spec.scenes.reduce((n, s) => n + Number(s.dur), 0);
    await fs.writeFile(path.join(dir, "film.json"), JSON.stringify(spec));
    say(`Animating ${plan.scenes.length} scenes (about ${Math.ceil((total * 30 * 0.3) / 60)} min). You can close the app.`);
    const silent = path.join(dir, "silent.mp4");
    const specJson = JSON.stringify(spec);
    const renderedFor = path.join(dir, "silent.spec.json");
    // The finished animation is reused only if it was made from this exact film.
    if (!(await exists(silent)) || !(await exists(renderedFor)) || (await fs.readFile(renderedFor, "utf8")) !== specJson) {
      await runCmd(python(), [engineScript(), path.join(dir, "film.json"), `${silent}.part.mp4`], Math.max(20 * 60_000, total * 30 * 2000));
      await fs.rename(`${silent}.part.mp4`, silent);
      await writeDone(renderedFor, specJson);
    }

    // 4. Sound: voices at their scene's start, over the score (or a drone bed), loudness to -14 LUFS.
    say("Mixing the sound…");
    const args: string[] = ["-y"];
    const parts: string[] = [];
    let n = 0;
    const music = input.musicMediaId ? await db().get<MediaItem>("media", input.musicMediaId) : null;
    if (music && music.kind === "audio") {
      const f = path.join(dir, "music");
      await fs.writeFile(f, await readFile(music));
      args.push("-stream_loop", "-1", "-i", f);
      parts.push(`[${n++}:a]atrim=0:${total.toFixed(2)},volume=0.32,afade=t=out:st=${Math.max(0, total - 2).toFixed(2)}:d=2[bed]`);
    } else {
      args.push("-f", "lavfi", "-i", `sine=f=55:d=${total.toFixed(2)}`, "-f", "lavfi", "-i", `anoisesrc=c=brown:a=0.5:d=${total.toFixed(2)}`, "-f", "lavfi", "-i", `sine=f=82.4:d=${total.toFixed(2)}`);
      parts.push(
        `[${n}:a]volume=0.22,tremolo=f=0.15:d=0.5[d1];[${n + 1}:a]lowpass=f=220,volume=0.5[d2];[${n + 2}:a]volume=0.10,tremolo=f=0.11:d=0.6[d3];[d1][d2][d3]amix=inputs=3:normalize=0,afade=t=in:d=2,afade=t=out:st=${Math.max(0, total - 2.5).toFixed(2)}:d=2.5[bed]`,
      );
      n += 3;
    }
    let at = title ? TITLE_SECONDS : 0;
    const voiced: string[] = [];
    for (const [i, f] of lines.entries()) {
      if (f) {
        args.push("-i", f);
        const ms = Math.round((at + 0.25) * 1000);
        parts.push(`[${n++}:a]aresample=48000,adelay=${ms}|${ms},volume=1.0[v${i}]`);
        voiced.push(`[v${i}]`);
      }
      at += seconds[i];
    }
    if (voiced.length) {
      parts.push(`${voiced.join("")}amix=inputs=${voiced.length}:normalize=0,asplit=2[vkey][voice]`, `[bed]aresample=48000[bed48]`, `[vkey]apad[vkeyp]`, `[bed48][vkeyp]sidechaincompress=threshold=0.05:ratio=6:attack=20:release=400[ducked]`, `[ducked][voice]amix=inputs=2:normalize=0:duration=first[mix]`);
    } else parts.push("[bed]anull[mix]");
    const raw = path.join(dir, "mix.wav");
    parts.push(`[mix]${MASTER_CHAIN}[master]`);
    await runCmd("ffmpeg", [...args, "-filter_complex", parts.join(";"), "-map", "[master]", "-ar", "48000", "-t", total.toFixed(2), raw], 10 * 60_000);
    // Two-pass loudness: measure, then set it to -14 LUFS exactly (one pass undershoots on short films).
    const audio = path.join(dir, "mix.m4a");
    await runCmd("ffmpeg", ["-y", "-i", raw, "-af", await loudnessFilter(raw), "-ar", "48000", "-c:a", "aac", "-b:a", "192k", audio], 10 * 60_000);
    const out = path.join(dir, "movie.mp4");
    await runCmd("ffmpeg", ["-y", "-i", silent, "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "copy", "-shortest", "-movflags", "+faststart", out], 10 * 60_000);

    // A chapter of a long movie: kept on disk for the join, not saved to the library on its own.
    if (opts.saveTo) {
      await fs.rename(out, opts.saveTo).catch(async () => fs.copyFile(out, opts.saveTo!));
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      return { id: "", title, scenes: plan.scenes.length, seconds: Math.round(total), mediaId: "", createdAt: nowIso() };
    }
    // 5. Save it to the library.
    const item = await storeFile(userId, { name: `${title || "Movie"}.mp4`, type: "video/mp4", bytes: await fs.readFile(out) }, { uncapped: true });
    const rec: MovieRecord = { id: uid("mov"), title: title || "Movie", scenes: plan.scenes.length, seconds: Math.round(total), mediaId: item.id, createdAt: nowIso() };
    await kvSet(ROW, [rec, ...(await listMovies())].slice(0, 50));
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    return rec;
  } catch (e) {
    // Stopped by a server shutdown: keep the finished steps for the resumed run.
    if (!(workDir && wasInterrupted(e))) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

/**
 * A long movie (up to 1 h 30 min) in chapters: each chapter is filmed and mixed on its own and kept on disk, so a
 * restart carries on from the next unfinished chapter; then the chapters are joined (no re-encoding) and the movie is
 * sent to storage in blocks (Azure Blob when connected), never held in memory.
 */
export async function renderChaptered(userId: string, title: string, chapters: RenderInput[], say: (m: string) => void, workDir: string): Promise<MovieRecord> {
  await fs.mkdir(workDir, { recursive: true });
  const files: string[] = [];
  let seconds = 0;
  for (const [i, ch] of chapters.entries()) {
    const file = path.join(workDir, `chapter${i + 1}.mp4`);
    const done = path.join(workDir, `chapter${i + 1}.json`);
    if (!(await exists(file)) || !(await exists(done))) {
      const rec = await renderMovie(userId, ch, (m) => say(`Chapter ${i + 1} of ${chapters.length}: ${m}`), path.join(workDir, `ch${i + 1}`), { saveTo: file });
      await writeDone(done, JSON.stringify({ seconds: rec.seconds }));
    }
    seconds += (JSON.parse(await fs.readFile(done, "utf8")) as { seconds: number }).seconds;
    files.push(file);
  }
  say(`Joining ${chapters.length} chapters…`);
  const list = path.join(workDir, "chapters.txt");
  await fs.writeFile(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  const out = path.join(workDir, "movie.mp4");
  await runCmd("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out], 60 * 60_000);
  seconds = Math.round((await mediaDuration(out).catch(() => seconds)) || seconds);
  say("Saving the movie…");
  const item = await storeFilePath(userId, { name: `${title || "Movie"}.mp4`, type: "video/mp4", path: out });
  const rec: MovieRecord = { id: uid("mov"), title: title || "Movie", scenes: chapters.reduce((n, c) => n + c.plan.scenes.length, 0), seconds, mediaId: item.id, createdAt: nowIso() };
  await kvSet(ROW, [rec, ...(await listMovies())].slice(0, 50));
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  return rec;
}

/** Splits a long plan into chapters: the title card opens the first, the end card closes the last. */
export function chaptersOf(input: RenderInput): RenderInput[] {
  const { scenes } = input.plan;
  if (scenes.length <= CHAPTER_SCENES) return [input];
  const out: RenderInput[] = [];
  for (let i = 0; i < scenes.length; i += CHAPTER_SCENES) {
    const last = i + CHAPTER_SCENES >= scenes.length;
    out.push({ ...input, plan: { ...input.plan, title: i === 0 ? input.plan.title : "", scenes: scenes.slice(i, i + CHAPTER_SCENES) }, endCard: last ? input.endCard : "" });
  }
  return out;
}

const clock = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

/** The Movie Maker job: renders, refunds on a real failure (not on a shutdown, which resumes), and keeps its work. */
export function movieJob(userId: string, input: RenderInput & { credits: number }): JobFn {
  return async (say, ctx) => {
    try {
      const chapters = chaptersOf(input);
      const rec = chapters.length > 1 ? await renderChaptered(userId, input.plan.title, chapters, say, movieWorkDir(ctx.jobId)) : await renderMovie(userId, input, say, movieWorkDir(ctx.jobId));
      return { href: "/movie-maker", message: `Movie ready: ${rec.title} (${clock(rec.seconds)})` };
    } catch (e) {
      if (!wasInterrupted(e) && input.credits) await refundCredits(userId, input.credits);
      throw e;
    }
  };
}
