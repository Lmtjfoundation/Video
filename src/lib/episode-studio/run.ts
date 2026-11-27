import "server-only";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { refundCredits } from "../auth";
import type { JobFn } from "../jobs";
import { azureSpeakActed } from "../azure-speech";
import { foundryImage } from "../azure-foundry";
import { geminiClip, mediaKey, MediaGenError, type RefImage } from "../gemini-media";
import { claudeJson } from "../llm";
import { storeFilePath } from "../media";
import { dataDir } from "../migrate";
import { engineFor, ownAudio, ownClipEngineInfo, ownClipFile, ownClipStatus, ownClipSubmit, ownLipsync } from "../own-video";
import { kvGet, kvSet, log } from "../repo";
import { mediaDuration, runCmd } from "../render";
import { nowIso, sleep, uid } from "../utils";
import { allShots, LAST_RESORT_TAKE, motionPrompt, nameTags, negativeFor, omniPrompt, portraitPrompt, shotMax, stillPrompt, type EpisodeAspect, type EpisodeLength, type EpisodePlan, type Shot } from "./plan";
import { buildTimeline, captions, type Timeline } from "./timeline";
import { writeEpisodePlan } from "./write";

/**
 * Episode Studio's production line. Every step saves its work in the episode's folder and its progress in the
 * database before the next one starts, so a restart (a deploy, a crash) picks up where it stopped:
 *   plan → cast portraits → first frames → acted voices → the edit → filmed shots (checked, retaken when frozen or
 *   broken, lips synced) → score, effects and mix → the finish (grade, titles, captions) → the Media Library.
 * Pictures: FLUX.2 pro on the owner's Azure AI (keeps every face from its portrait). Voices: Azure neural voices,
 * acted. Shots: Gemini Omni Flash in 4K on the app's Gemini key, or Vueio's GPU engine (480p-720p, upscaled in the
 * finish). Music, sound effects and lip sync: Vueio's GPU engine. Writing and the visual check: Claude. Every shot is
 * moving footage: a shot that can't be filmed borrows a neighbouring shot's footage, never a still picture.
 */
export type FilmEngine = "gemini" | "own";
/** The longest shot the writer may plan when Gemini films (it makes 3-15 second clips). */
const OMNI_SHOT_MAX = 8;
export type Step = "queued" | "planning" | "casting" | "stills" | "voices" | "filming" | "lipsync" | "sound" | "finishing" | "done" | "failed";
export const STEP_LABEL: Record<Step, string> = {
  queued: "Waiting to start",
  planning: "Writing the episode",
  casting: "Casting: portraits",
  stills: "First frames",
  voices: "Recording the voices",
  filming: "Filming the shots",
  lipsync: "Syncing lips",
  sound: "Score, effects and mix",
  finishing: "Grade, titles and captions",
  done: "Ready",
  failed: "Stopped",
};

interface ClipState {
  job?: string;
  submittedAt?: number;
  attempts: number;
  lost: number;
  done?: boolean;
  verdict?: string;
  note?: string;
}

export interface EpisodeRecord {
  id: string;
  owner: string;
  prompt: string;
  length: EpisodeLength;
  aspect: EpisodeAspect;
  step: Step;
  message: string;
  progress: number;
  plan?: EpisodePlan;
  timeline?: Timeline;
  clips: Record<string, ClipState>;
  /** Who films the shots: Gemini Omni in 4K, or Vueio's GPU engine. Chosen when the episode starts. */
  engine?: FilmEngine;
  /** Shots dropped because their picture couldn't be made (e.g. a safety filter), so the episode still finishes. */
  dropped?: string[];
  mediaId?: string;
  credits: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

const INDEX = "episode-studio";
const row = (id: string) => `episode-studio:${id}`;
export const episodeDir = (id: string) => path.join(dataDir(), "episodes", id.replace(/[^\w-]/g, ""));
const SCRIPTS = path.join(process.cwd(), "scripts", "episode");
const FONTS = path.join(process.cwd(), "assets", "fonts");

export async function listEpisodes(): Promise<EpisodeRecord[]> {
  const ids = (await kvGet<string[]>(INDEX)) ?? [];
  const out: EpisodeRecord[] = [];
  for (const id of ids) {
    const r = await kvGet<EpisodeRecord>(row(id));
    if (r) out.push(r);
  }
  return out;
}
export const getEpisode = (id: string) => kvGet<EpisodeRecord>(row(id));
async function save(r: EpisodeRecord) {
  r.updatedAt = nowIso();
  await kvSet(row(r.id), r);
}

export async function newEpisode(owner: string, o: { prompt: string; length: EpisodeLength; aspect: EpisodeAspect; credits: number; engine?: FilmEngine }): Promise<EpisodeRecord> {
  const r: EpisodeRecord = { id: uid(), owner, prompt: o.prompt.trim().slice(0, 4000), length: o.length, aspect: o.aspect, engine: o.engine, step: "queued", message: STEP_LABEL.queued, progress: 0, clips: {}, credits: o.credits, createdAt: nowIso(), updatedAt: nowIso() };
  await save(r);
  const ids = (await kvGet<string[]>(INDEX)) ?? [];
  await kvSet(INDEX, [r.id, ...ids.filter((x) => x !== r.id)].slice(0, 50));
  return r;
}

export async function deleteEpisode(id: string) {
  await kvSet(INDEX, ((await kvGet<string[]>(INDEX)) ?? []).filter((x) => x !== id));
  await kvSet(row(id), null);
  await fs.rm(episodeDir(id), { recursive: true, force: true });
}

const exists = (f: string) => fs.stat(f).then((s) => s.size > 0, () => false);
const asRef = async (file: string): Promise<RefImage> => ({ base64: (await fs.readFile(file)).toString("base64"), mimeType: "image/png" });

/** Writes a picture, telling PNG from JPEG by its first bytes (FLUX.2 returns either). */
async function writePicture(file: string, img: { bytes: Buffer; mimeType: string }) {
  await fs.writeFile(file, img.bytes);
}

/** Runs a script under python3 with a long timeout; returns stdout. */
const py = (script: string, args: string[], timeoutMs = 30 * 60_000) => runCmd("python3", [path.join(SCRIPTS, script), ...args], timeoutMs);

/** The finish streams "item k/n" lines: shown as progress while it renders. */
function runFinish(spec: string, out: string, onItem: (k: number, n: number) => void, extra: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("python3", [path.join(SCRIPTS, "finish.py"), spec, out, ...extra], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stdout.on("data", (d: Buffer) => {
      for (const m of d.toString().matchAll(/item (\d+)\/(\d+)/g)) onItem(Number(m[1]), Number(m[2]));
    });
    p.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
    const t = setTimeout(() => p.kill("SIGKILL"), 4 * 3600_000);
    p.on("close", (code) => {
      clearTimeout(t);
      if (code === 0) resolve();
      else reject(new Error(`The finish failed: ${err.trim().split("\n").slice(-3).join(" ").slice(0, 400) || `exit ${code}`}`));
    });
  });
}

/* ───────────── the visual check ───────────── */

/** Six frames of a clip in one strip, for the visual check. */
async function strip(clip: string, out: string) {
  const d = (await mediaDuration(clip)) || 5;
  await runCmd("ffmpeg", ["-v", "error", "-y", "-i", clip, "-vf", `fps=6/${d.toFixed(3)},scale=-2:300,tile=6x1`, "-frames:v", "1", "-q:v", "5", out], 120_000);
}

/**
 * Claude looks at six frames of a shot and says whether it's usable. Only clear defects count: melted or distorted
 * faces, a person turning into someone else, broken hands in focus, the action not happening. Null when no visual
 * check is available (the shot is then judged on the numbers alone).
 */
async function visualCheck(plan: EpisodePlan, shot: Shot, clip: string, dir: string): Promise<{ ok: boolean; problem: string } | null> {
  const file = path.join(dir, `${shot.id}.strip.jpg`);
  try {
    await strip(clip, file);
    const who = shot.cast.map((k) => plan.cast.find((c) => c.key === k)).filter(Boolean).map((c) => `${c!.key}: ${c!.look}`).join("; ");
    const r = await claudeJson<{ ok?: boolean; problem?: string }>({
      system: "You check shots from an AI video model for a drama series. Be practical: motion blur, small background glitches and imperfect detail are fine. Reject only clear defects a viewer would notice: a melted, smeared or distorted face; one person morphing into another or two faces merging; extra or broken limbs or hands in focus; a person's identity changing; the shot frozen like a still photo; the described action plainly not happening. Answer JSON {\"ok\": true|false, \"problem\": \"one short sentence, empty if ok\"}.",
      user: `Six frames in order from one shot. Intended action: ${shot.motion}${who ? `\nPeople: ${who}` : ""}`,
      images: [{ mediaType: "image/jpeg", base64: (await fs.readFile(file)).toString("base64") }],
      maxTokens: 300,
      temperature: 0,
      json: true,
    });
    return { ok: r.ok !== false, problem: String(r.problem ?? "").slice(0, 200) };
  } catch (e) {
    console.warn(`[episodes] visual check skipped for ${shot.id}: ${(e as Error).message.slice(0, 160)}`);
    return null;
  }
}

/* ───────────── the job ───────────── */

const QMAX = 5; // clips allowed to wait in the engine's queue: each finishes well inside the engine's job retention
/** Tries per shot; the last asks for the simplest motion (see LAST_RESORT_TAKE) so the shot still comes back moving. */
const MAX_ATTEMPTS = LAST_RESORT_TAKE + 1;
/** Gemini clips made at the same time. */
const OMNI_PARALLEL = 3;

export async function runEpisode(id: string, say: (m: string) => void): Promise<EpisodeRecord> {
  let r = await getEpisode(id);
  if (!r) throw new Error("That episode was deleted.");
  const dir = episodeDir(id);
  for (const sub of ["cast", "stills", "vo", "clips", "sound"]) await fs.mkdir(path.join(dir, sub), { recursive: true });
  const step = async (s: Step, message: string, progress: number) => {
    r!.step = s;
    r!.message = message;
    r!.progress = Math.round(progress);
    await save(r!);
    say(message);
  };

  try {
    // 1 · The plan. Gemini films 3-15 second clips in 4K; the GPU engine's limit comes from the engine (asking wakes
    // the GPU, which is needed next anyway).
    if (!r.engine) {
      r.engine = (await mediaKey()) ? "gemini" : "own";
      await save(r);
    }
    let maxSeconds = 5.04;
    if (r.engine === "own") {
      try {
        maxSeconds = Math.min(5.04, (await ownClipEngineInfo()).maxSeconds || 5.04);
      } catch (e) {
        if (e instanceof MediaGenError && e.kind === "config") throw e;
      }
    }
    const maxShot = r.engine === "gemini" ? OMNI_SHOT_MAX : shotMax(maxSeconds);
    if (!r.plan) {
      await step("planning", "Writing the episode: cast, script and shot list…", 2);
      r.plan = await writeEpisodePlan({ prompt: r.prompt, length: r.length, aspect: r.aspect, maxShot });
      await save(r);
      await log("info", "generate", `Episode Studio planned “${r.plan.series}: ${r.plan.title}” (${allShots(r.plan).length} shots)`);
    }
    const plan = r.plan;

    // 2 · Cast portraits: one reference per character, so every picture keeps the same face.
    for (const [i, c] of plan.cast.entries()) {
      const f = path.join(dir, "cast", `${c.key}.png`);
      if (await exists(f)) continue;
      await step("casting", `Casting ${c.name} (${i + 1} of ${plan.cast.length})…`, 4 + (6 * i) / plan.cast.length);
      await writePicture(f, await foundryImage({ prompt: portraitPrompt(plan, c), aspect: "1:1" }));
    }

    // 3 · First frames, with the cast's portraits as references. A picture a safety filter declines twice is dropped.
    const dropped = new Set(r.dropped ?? []);
    const shots = allShots(plan);
    for (const [i, s] of shots.entries()) {
      const f = path.join(dir, "stills", `${s.id}.png`);
      if (dropped.has(s.id) || (await exists(f))) continue;
      await step("stills", `First frames: ${i + 1} of ${shots.length}…`, 10 + (15 * i) / shots.length);
      const refs = await Promise.all(s.cast.map((k) => asRef(path.join(dir, "cast", `${k}.png`))));
      let made = false;
      for (const attempt of [0, 1]) {
        try {
          const prompt = attempt ? `A tasteful, non-graphic cinematic scene. ${stillPrompt(plan, s).replace(/\b(blood|bloody|gun|pistol|glock|weapon|shot|wound|dead|kill\w*)\b/gi, "")}` : stillPrompt(plan, s);
          await writePicture(f, await foundryImage({ prompt, refs, aspect: r.aspect }));
          made = true;
          break;
        } catch (e) {
          if (!(e instanceof MediaGenError && e.kind === "blocked")) throw e;
        }
      }
      if (!made) {
        dropped.add(s.id);
        r.dropped = [...dropped];
        await save(r);
      }
    }
    if (dropped.size) {
      for (const b of plan.beats) if (b.shots) b.shots = b.shots.filter((s) => !dropped.has(s.id));
      plan.beats = plan.beats.filter((b) => b.card || b.shots?.length);
      await save(r);
    }

    // 4 · Voices: every line acted by its character's Azure voice.
    const lines = allShots(plan).filter((s) => s.line);
    const seconds: Record<string, number> = {};
    for (const [i, s] of lines.entries()) {
      const f = path.join(dir, "vo", `${s.id}.wav`);
      if (!(await exists(f))) {
        await step("voices", `Recording line ${i + 1} of ${lines.length}…`, 25 + (5 * i) / Math.max(1, lines.length));
        const line = s.line!;
        const v = line.speaker === "N" ? plan.narrator : plan.cast.find((c) => c.key === line.speaker);
        if (!v) continue;
        await fs.writeFile(f, await azureSpeakActed(line.text, v.voice, { style: line.style, rate: v.rate }));
      }
      seconds[s.id] = await mediaDuration(f);
    }

    // 5 · The edit.
    r.timeline = buildTimeline(plan, seconds, maxShot);
    await save(r);
    const tl = r.timeline;

    // 6 · Filming. Each shot is checked when it arrives and filmed again when it's frozen or visibly broken.
    if (r.engine === "gemini") await filmOmni(r, plan, tl, dir, step);
    else await film(r, plan, tl, dir, maxSeconds, step);

    // 7 · Lip sync, where a speaking face is on screen and the engine has lip sync. Gemini's 4K shots are filmed
    // with the speaker talking; the GPU's lip sync works on its own lower-resolution clips only.
    const lipEngine = r.engine === "own" ? await engineFor("lipsync").catch(() => null) : null;
    if (lipEngine) {
      const talking = allShots(plan).filter((s) => s.talking && s.line);
      for (const [i, s] of talking.entries()) {
        const clip = path.join(dir, "clips", `${s.id}.mp4`);
        const out = path.join(dir, "clips", `${s.id}.lip.mp4`);
        if (!(await exists(clip)) || (await exists(out)) || r.clips[s.id]?.note === "nolip") continue;
        await step("lipsync", `Syncing lips: ${i + 1} of ${talking.length}…`, 80 + (4 * i) / talking.length);
        try {
          const item = tl.items.find((x) => x.id === s.id)!;
          const v = tl.voices.find((x) => x.id === s.id)!;
          const seg = path.join(dir, "vo", `${s.id}.lipseg.wav`);
          const clipLen = await mediaDuration(clip);
          // The line where it falls in this shot, silence around it, as long as the clip.
          const offset = Math.max(0, v.start - item.start);
          await runCmd("ffmpeg", ["-v", "error", "-y", "-i", path.join(dir, "vo", `${s.id}.wav`), "-af", `adelay=${Math.round(offset * 1000)}:all=1,apad`, "-t", clipLen.toFixed(3), "-ar", "16000", "-ac", "1", seg], 120_000);
          await fs.writeFile(out, await ownLipsync({ video: await fs.readFile(clip), audio: await fs.readFile(seg) }));
        } catch (e) {
          r.clips[s.id] = { ...(r.clips[s.id] ?? { attempts: 0, lost: 0 }), note: "nolip" };
          await save(r);
          console.warn(`[episodes] lip sync skipped for ${s.id}: ${(e as Error).message.slice(0, 160)}`);
        }
      }
    }

    // 8 · Sound: the voices, the score (the engine's music model, or the built-in score), effects, accents, the mix.
    const mix = path.join(dir, "sound", "mix.wav");
    if (!(await exists(mix))) await sound(r, plan, tl, dir, step);

    // 9 · The finish, in 4K: segments rendered side by side, joined, then the mix.
    const out = path.join(dir, "episode.mp4");
    if (!(await exists(out))) {
      await step("finishing", "Effects, grade, titles and captions in 4K…", 90);
      const tags = nameTags(plan);
      const supers: Record<string, { title: string; sub?: string; seconds: number }> = {};
      for (const b of plan.beats) if (b.super && b.shots?.[0]) supers[b.shots[0].id] = { ...b.super, seconds: 3.2 };
      const byId = new Map(allShots(plan).map((s) => [s.id, s]));
      const [w, h] = r.aspect === "9:16" ? [2160, 3840] : [3840, 2160];
      const accent = [1, 3, 5].map((k) => parseInt(plan.accent.slice(k, k + 2), 16));
      const footage = await shotFootage(r, tl, dir);
      const items = tl.items.map((it) => {
        if (it.kind === "card") return { kind: "card", start: it.start, dur: it.dur, text: it.text, sub: it.sub, style: it.style, transition: it.transition };
        const s = byId.get(it.id!);
        return { kind: "shot", id: it.id, start: it.start, dur: it.dur, mood: it.mood, clip: footage[it.id!], impacts: s?.impacts ?? [], fx: s?.fx ?? [], transition: s?.transition };
      });
      const spec = { w, h, fps: 24, total: tl.total, fonts: FONTS, mix, accent, note: "ORIGINAL FICTION  ·  MADE WITH VUEIO", items, captions: captions(plan, tl), supers, tags };
      const specFile = path.join(dir, "finish.json");
      await fs.writeFile(specFile, JSON.stringify(spec));
      await finishParallel(specFile, items, tl.total, mix, out + ".part.mp4", (k, n) => {
        const p = 90 + (8 * k) / n;
        if (Math.round(p) !== r!.progress) void step("finishing", `Effects, grade, titles and captions in 4K: ${k} of ${n}…`, p);
      });
      await fs.rename(out + ".part.mp4", out);
    }

    // 10 · Into the Media Library.
    if (!r.mediaId) {
      const item = await storeFilePath(r.owner, { name: `${plan.series} - ${plan.title}.mp4`.replace(/[\\/:*?"<>|]/g, ""), type: "video/mp4", path: out });
      r.mediaId = item.id;
    }
    await step("done", `“${plan.title}” is ready: ${Math.round(tl.total)} seconds, ${allShots(plan).length} shots.`, 100);
    return r;
  } catch (e) {
    r = (await getEpisode(id)) ?? r;
    r.step = "failed";
    r.error = (e as Error).message.slice(0, 500);
    r.message = r.error;
    await save(r);
    if (r.credits > 0) {
      await refundCredits(r.owner, r.credits);
      r.credits = 0;
      await save(r);
    }
    throw e;
  }
}

async function film(r: EpisodeRecord, plan: EpisodePlan, tl: Timeline, dir: string, maxSeconds: number, step: (s: Step, m: string, p: number) => Promise<void>) {
  const order = tl.items.filter((i) => i.kind === "shot").map((i) => i.id!);
  const byId = new Map(allShots(plan).map((s) => [s.id, s]));
  const clipFile = (id: string) => path.join(dir, "clips", `${id}.mp4`);
  for (const id of order) {
    r.clips[id] ??= { attempts: 0, lost: 0 };
    if (!r.clips[id].done && (await exists(clipFile(id))) && !r.clips[id].job) r.clips[id].done = true;
  }
  const submit = async (id: string) => {
    const s = byId.get(id)!;
    const c = r.clips[id];
    const still = await fs.readFile(path.join(dir, "stills", `${id}.png`));
    c.job = await ownClipSubmit({
      prompt: motionPrompt(s, c.attempts),
      negative: negativeFor(s),
      start: { bytes: still, mime: still[0] === 0xff ? "image/jpeg" : "image/png" },
      aspect: r.aspect,
      seconds: Math.min(maxSeconds, (tl.clips[id] ?? s.seconds) + 0.15),
      maxSeconds,
      steps: 26,
      seed: (Array.from(id).reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) + c.attempts * 1009) % 100000,
    });
    c.submittedAt = Date.now();
    await save(r);
  };
  let lastNote = "";
  let silentSince = 0; // when the engine last stopped answering
  for (;;) {
    const pending = order.filter((id) => !r.clips[id].done && !r.clips[id].job);
    const active = order.filter((id) => r.clips[id].job);
    const done = order.filter((id) => r.clips[id].done).length;
    if (!pending.length && !active.length) break;
    // Top up the engine's queue, a few at a time.
    const info = await ownClipEngineInfo().catch(() => null);
    if (info) silentSince = 0;
    else if (!silentSince) silentSince = Date.now();
    else if (Date.now() - silentSince > 60 * 60_000) throw new Error("Vueio's GPU engine stopped answering for an hour while filming. Check the GPU server, then press Resume: the shots already filmed are kept.");
    if (info?.ready) {
      let queue = info.queue;
      for (const id of pending) {
        if (queue >= QMAX || order.filter((x) => r.clips[x].job).length >= QMAX + 1) break;
        try {
          await submit(id);
          queue++;
        } catch (e) {
          // One shot the engine refuses doesn't stop the episode: it's tried again, then a neighbouring shot stands in.
          const c = r.clips[id];
          c.attempts++;
          c.note = (e as Error).message.slice(0, 160);
          if (c.attempts >= MAX_ATTEMPTS) c.done = true;
          await save(r);
        }
      }
    }
    // Check every shot in flight.
    for (const id of order.filter((x) => r.clips[x].job)) {
      const c = r.clips[id];
      const s = byId.get(id)!;
      let st: Awaited<ReturnType<typeof ownClipStatus>>;
      try {
        st = await ownClipStatus(c.job!);
      } catch {
        continue; // the engine didn't answer this time; asked again next round
      }
      if (st.status === "gone") {
        c.job = undefined;
        c.lost++;
        if (c.lost > 4) c.done = true; // a neighbouring shot's footage stands in
        await save(r);
        continue;
      }
      if (st.status === "failed") {
        c.job = undefined;
        c.attempts++;
        c.note = st.error?.slice(0, 160);
        if (c.attempts >= MAX_ATTEMPTS) c.done = true;
        await save(r);
        continue;
      }
      if (st.status !== "succeeded") continue;
      const tmp = clipFile(id) + ".new.mp4";
      try {
        await fs.writeFile(tmp, await ownClipFile(c.job!));
      } catch {
        continue; // the download failed this time; the engine keeps the clip, so it's fetched next round
      }
      c.job = undefined;
      // The numbers first (a frozen shot reads as a still picture), then a look at the frames.
      const { verdict, problem } = await checkShot(plan, s, tmp, dir);
      const keep = verdict === "ok" || c.attempts + 1 >= MAX_ATTEMPTS;
      if (keep && (verdict === "ok" || !(await exists(clipFile(id))))) await fs.rename(tmp, clipFile(id));
      else await fs.rm(tmp, { force: true });
      c.attempts++;
      c.verdict = verdict;
      c.note = problem || undefined;
      c.done = keep;
      await save(r);
    }
    const doneNow = order.filter((id) => r.clips[id].done).length;
    const note = `Filming: ${doneNow} of ${order.length} shots done${info ? ` · GPU queue ${info.queue}` : ""}…`;
    if (note !== lastNote || doneNow !== done) await step("filming", note, 30 + (50 * doneNow) / order.length);
    lastNote = note;
    await sleep(20_000);
  }
}

/** The shot's numbers, then Claude's look at its frames: "ok", "frozen" or "broken" (with what's wrong). */
async function checkShot(plan: EpisodePlan, s: Shot, clip: string, dir: string): Promise<{ verdict: string; problem: string }> {
  let verdict = "ok";
  try {
    verdict = (JSON.parse((await py("qc.py", [clip, path.join(dir, "stills", `${s.id}.png`)], 300_000)).trim().split("\n").pop() || "{}") as { verdict?: string }).verdict ?? "ok";
  } catch {
    /* no check: keep the shot */
  }
  if (verdict !== "ok") return { verdict, problem: "" };
  const v = await visualCheck(plan, s, clip, path.join(dir, "clips"));
  return v && !v.ok ? { verdict: "broken", problem: v.problem } : { verdict: "ok", problem: "" };
}

/**
 * Filming with Gemini Omni Flash in 4K: a few shots at a time, each starting on its first frame, checked when it
 * arrives and filmed again (a new take, then the simplest motion) when it's frozen or broken.
 */
async function filmOmni(r: EpisodeRecord, plan: EpisodePlan, tl: Timeline, dir: string, step: (s: Step, m: string, p: number) => Promise<void>) {
  const order = tl.items.filter((i) => i.kind === "shot").map((i) => i.id!);
  const byId = new Map(allShots(plan).map((s) => [s.id, s]));
  const clipFile = (id: string) => path.join(dir, "clips", `${id}.mp4`);
  for (const id of order) {
    r.clips[id] ??= { attempts: 0, lost: 0 };
    if (!r.clips[id].done && (await exists(clipFile(id)))) r.clips[id].done = true;
  }
  const todo = order.filter((id) => !r.clips[id].done);
  let filmed = order.length - todo.length;
  const report = () => step("filming", `Filming in 4K: ${filmed} of ${order.length} shots done…`, 30 + (50 * filmed) / order.length);
  await report();
  const one = async (id: string) => {
    const s = byId.get(id)!;
    const c = r.clips[id];
    while (!c.done) {
      const still = await fs.readFile(path.join(dir, "stills", `${id}.png`));
      const tmp = clipFile(id) + ".new.mp4";
      try {
        const clip = await geminiClip({
          prompt: omniPrompt(s, c.attempts),
          start: { base64: still.toString("base64"), mimeType: still[0] === 0xff ? "image/jpeg" : "image/png" },
          aspect: r.aspect,
          seconds: Math.ceil((tl.clips[id] ?? s.seconds) + 0.3),
          resolution: "4k",
        });
        await fs.writeFile(tmp, clip);
      } catch (e) {
        if (e instanceof MediaGenError && e.kind === "config") throw e; // the key or billing: every shot would fail
        c.attempts++;
        c.note = (e as Error).message.slice(0, 160);
        if (c.attempts >= MAX_ATTEMPTS) c.done = true;
        await save(r);
        continue;
      }
      const { verdict, problem } = await checkShot(plan, s, tmp, dir);
      const keep = verdict === "ok" || c.attempts + 1 >= MAX_ATTEMPTS;
      if (keep && (verdict === "ok" || !(await exists(clipFile(id))))) await fs.rename(tmp, clipFile(id));
      else await fs.rm(tmp, { force: true });
      c.attempts++;
      c.verdict = verdict;
      c.note = problem || undefined;
      c.done = keep;
      await save(r);
    }
    filmed++;
    await report();
  };
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(OMNI_PARALLEL, todo.length) }, async () => {
      while (next < todo.length) await one(todo[next++]);
    }),
  );
}

/**
 * The footage for every shot in the edit: its lip-synced take, its filmed take, or (when a shot couldn't be filmed
 * at all) the nearest filmed shot in the same scene, then anywhere. Never a still picture.
 */
async function shotFootage(r: EpisodeRecord, tl: Timeline, dir: string): Promise<Record<string, string>> {
  const shots = tl.items.filter((i) => i.kind === "shot");
  const own: Record<string, string | null> = {};
  for (const it of shots) {
    const lip = path.join(dir, "clips", `${it.id}.lip.mp4`);
    const clip = path.join(dir, "clips", `${it.id}.mp4`);
    own[it.id!] = (await exists(lip)) ? lip : (await exists(clip)) ? clip : null;
  }
  if (!Object.values(own).some(Boolean)) throw new Error("None of the shots could be filmed, so there's no footage to finish. Check the video engine, then press Resume.");
  const out: Record<string, string> = {};
  for (const [i, it] of shots.entries()) {
    if (own[it.id!]) {
      out[it.id!] = own[it.id!]!;
      continue;
    }
    const near = shots.map((x, j) => ({ x, d: Math.abs(j - i) + (x.beat === it.beat ? 0 : 1000) })).filter((o) => own[o.x.id!]).sort((a, b) => a.d - b.d)[0];
    out[it.id!] = own[near.x.id!]!;
    r.clips[it.id!] = { ...(r.clips[it.id!] ?? { attempts: 0, lost: 0 }), note: `not filmed: uses ${near.x.id}'s footage` };
  }
  await save(r);
  return out;
}

/**
 * The 4K finish, split into contiguous runs of items rendered side by side (as many as the server's cores and
 * memory allow), joined without re-encoding, then the mix added and loudness-normalised.
 */
async function finishParallel(specFile: string, items: { dur: number }[], total: number, mix: string, out: string, onItem: (k: number, n: number) => void) {
  const n = items.length;
  const byCores = Math.floor(os.cpus().length / 2);
  // A 4K worker holds about 1.3 GB of frames plus two ffmpeg processes (decode and encode): measured about 2.5 GB,
  // so 3 GB each, keeping 4 GB for the app itself.
  const byMemory = Math.floor((os.totalmem() / 2 ** 30 - 4) / 3);
  const workers = Math.max(1, Math.min(6, byCores, byMemory, n));
  const ranges: [number, number][] = [];
  const all = items.reduce((a, it) => a + it.dur, 0);
  let at = 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += items[i].dur;
    if (acc >= (all * (ranges.length + 1)) / workers && ranges.length < workers - 1) {
      ranges.push([at, i + 1]);
      at = i + 1;
    }
  }
  if (at < n) ranges.push([at, n]);
  const done = new Array(ranges.length).fill(0);
  const segs = ranges.map((_, k) => `${out}.seg${k}.mp4`);
  await Promise.all(
    ranges.map(([a, b], k) =>
      runFinish(specFile, segs[k], () => {
        done[k] = Math.min(b - a, done[k] + 1);
        onItem(done.reduce((x, y) => x + y, 0), n);
      }, ["--items", `${a}:${b}`]),
    ),
  );
  const list = `${out}.txt`;
  await fs.writeFile(list, segs.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  const video = `${out}.video.mp4`;
  await runCmd("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", video], 30 * 60_000);
  await runCmd("ffmpeg", ["-v", "error", "-y", "-i", video, "-i", mix, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.85:level=false", "-c:a", "aac", "-b:a", "256k", "-t", total.toFixed(3), "-movflags", "+faststart", out], 30 * 60_000);
  await Promise.all([...segs, list, video].map((f) => fs.rm(f, { force: true })));
}

async function sound(r: EpisodeRecord, plan: EpisodePlan, tl: Timeline, dir: string, step: (s: Step, m: string, p: number) => Promise<void>) {
  const sd = path.join(dir, "sound");
  const byId = new Map(allShots(plan).map((s) => [s.id, s]));
  // Accents and (when the engine can't make music) the built-in score.
  await fs.writeFile(path.join(sd, "timeline.json"), JSON.stringify({ total: tl.total, items: tl.items.map((i) => ({ ...i, impacts: i.id ? byId.get(i.id)?.impacts ?? [] : [] })) }));
  await step("sound", "Composing the score…", 85);
  const music = path.join(sd, "music.wav");
  if (!(await exists(music))) {
    try {
      const moods = [...new Set(tl.items.filter((i) => i.kind === "shot").map((i) => i.mood))].join(", ");
      const made = await ownAudio({ kind: "music", prompt: `${plan.music} Instrumental film score for a drama episode, moods in order: ${moods}. No vocals.`, instrumental: true, seconds: Math.min(240, Math.ceil(tl.total) + 2), timeoutMs: 40 * 60_000 });
      await fs.writeFile(music, made.wav);
    } catch (e) {
      console.warn(`[episodes] engine music unavailable (${(e as Error).message.slice(0, 160)}); using the built-in score.`);
    }
  }
  const pad = path.join(sd, "pad.wav");
  await py("score.py", [path.join(sd, "timeline.json"), path.join(sd, "fx.wav"), ...((await exists(music)) ? [] : [pad])], 20 * 60_000);
  // Effects for shots that have a sound in their world.
  const fxShots = tl.items.filter((i) => i.kind === "shot" && byId.get(i.id!)?.sfx);
  for (const [k, it] of fxShots.entries()) {
    const f = path.join(sd, `sfx-${it.id}.wav`);
    if (await exists(f)) continue;
    await step("sound", `Sound effects: ${k + 1} of ${fxShots.length}…`, 86 + (2 * k) / Math.max(1, fxShots.length));
    try {
      await fs.writeFile(f, (await ownAudio({ kind: "sfx", prompt: byId.get(it.id!)!.sfx!, seconds: Math.min(30, Math.max(2, Math.ceil(it.dur + 1))), timeoutMs: 15 * 60_000 })).wav);
    } catch (e) {
      console.warn(`[episodes] effect skipped for ${it.id}: ${(e as Error).message.slice(0, 160)}`);
      break; // the engine's sound side isn't answering: the rest would fail the same way
    }
  }
  await step("sound", "Mixing…", 89);
  // Voices placed on the timeline; the score and effects ducked under them.
  const inputs: string[] = [];
  const parts: string[] = [];
  const add = (file: string, at: number, gainDb: number, label: string) => {
    inputs.push("-i", file);
    const n = inputs.length / 2 - 1;
    parts.push(`[${n}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${gainDb}dB,adelay=${Math.round(at * 1000)}:all=1[${label}${n}]`);
    return `[${label}${n}]`;
  };
  const voices = tl.voices.map((v) => add(path.join(dir, "vo", `${v.id}.wav`), v.start, 0, "v"));
  const bed: string[] = [];
  bed.push(add((await exists(music)) ? music : pad, 0, (await exists(music)) ? -7 : -4, "m"));
  for (const it of fxShots) if (await exists(path.join(sd, `sfx-${it.id}.wav`))) bed.push(add(path.join(sd, `sfx-${it.id}.wav`), it.start, -10, "s"));
  const accents = add(path.join(sd, "fx.wav"), 0, -3, "x");
  const filter = [
    ...parts,
    `${voices.join("")}amix=inputs=${Math.max(1, voices.length)}:normalize=0,asplit=2[vox][key]`,
    `${bed.join("")}amix=inputs=${bed.length}:normalize=0[bed]`,
    `[bed][key]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=350[ducked]`,
    `[vox][ducked]${accents}amix=inputs=3:normalize=0,alimiter=limit=0.9[out]`,
  ].join(";");
  if (!voices.length) throw new Error("This episode has no recorded lines to mix.");
  await runCmd("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", filter, "-map", "[out]", "-t", (tl.total + 0.5).toFixed(2), "-ar", "48000", "-ac", "2", path.join(sd, "mix.part.wav")], 20 * 60_000);
  await fs.rename(path.join(sd, "mix.part.wav"), path.join(sd, "mix.wav"));
}

/** The background job (resumable: after a restart it carries on from the last finished step). */
export const episodeJob =
  (_userId: string, input: { id: string }): JobFn =>
  async (say) => {
    const r = await runEpisode(input.id, say);
    return { href: `/episodes?id=${r.id}`, message: r.message };
  };
