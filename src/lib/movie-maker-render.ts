import "server-only";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { getCharacters, characterRef } from "./characters";
import { db } from "./db";
import { readFile, storeFile } from "./media";
import { makeImage } from "./pictures";
import { mediaDuration, narrate, runCmd } from "./render";
import { kvGet, kvSet } from "./repo";
import type { MediaItem } from "./types";
import { nowIso, uid } from "./utils";
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

/** Make the movie: pictures, voices, the motion render, the sound mix. Returns the saved video. */
export async function renderMovie(userId: string, input: RenderInput, say: (m: string) => void): Promise<MovieRecord> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gp-movie-"));
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
      const m = s.mediaId ? await db().get<MediaItem>("media", s.mediaId) : null;
      if (m && m.kind === "image") await fs.writeFile(file, await readFile(m));
      else {
        const img = await makeImage({ prompt: picturePrompt(s, look), refs, aspect: "9:16" });
        await fs.writeFile(file, img.bytes);
      }
      images.push(file);
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
        say(`Voice ${i + 1} of ${plan.scenes.length}…`);
        const file = await narrate(text, path.join(dir, `v${i}`));
        lines.push(file);
        seconds[i] = Math.max(seconds[i], Math.min(20, (await mediaDuration(file)) + 0.45));
      }
    }

    // 3. The motion render.
    const title = plan.title.trim();
    const spec = filmSpec({ scenes: plan.scenes.map((s, i) => ({ ...s, image: images[i], seconds: seconds[i] })), grade: input.grade, title, endCard: input.endCard.trim(), fiction: input.fiction });
    const total = spec.scenes.reduce((n, s) => n + Number(s.dur), 0);
    await fs.writeFile(path.join(dir, "film.json"), JSON.stringify(spec));
    say(`Animating ${plan.scenes.length} scenes (about ${Math.ceil((total * 30 * 0.5) / 60)} min)…`);
    const silent = path.join(dir, "silent.mp4");
    await runCmd(python(), [engineScript(), path.join(dir, "film.json"), silent], Math.max(20 * 60_000, total * 30 * 2000));

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
      parts.push(`${voiced.join("")}amix=inputs=${voiced.length}:normalize=0[voice]`, `[bed][voice]sidechaincompress=threshold=0.05:ratio=6:attack=20:release=400[ducked]`, `[ducked][voice]amix=inputs=2:normalize=0[mix]`);
    } else parts.push("[bed]anull[mix]");
    parts.push(`[mix]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[out]`);
    const audio = path.join(dir, "mix.m4a");
    await runCmd("ffmpeg", [...args, "-filter_complex", parts.join(";"), "-map", "[out]", "-c:a", "aac", "-b:a", "192k", "-t", total.toFixed(2), audio], 10 * 60_000);
    const out = path.join(dir, "movie.mp4");
    await runCmd("ffmpeg", ["-y", "-i", silent, "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "copy", "-shortest", "-movflags", "+faststart", out], 10 * 60_000);

    // 5. Save it to the library.
    const item = await storeFile(userId, { name: `${title || "Movie"}.mp4`, type: "video/mp4", bytes: await fs.readFile(out) }, { uncapped: true });
    const rec: MovieRecord = { id: uid("mov"), title: title || "Movie", scenes: plan.scenes.length, seconds: Math.round(total), mediaId: item.id, createdAt: nowIso() };
    await kvSet(ROW, [rec, ...(await listMovies())].slice(0, 50));
    return rec;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
