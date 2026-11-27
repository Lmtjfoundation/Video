import "server-only";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { refundCredits } from "../auth";
import type { JobFn } from "../jobs";
import { azureSpeakActed } from "../azure-speech";
import { foundryImage } from "../azure-foundry";
import { MediaGenError, type RefImage } from "../gemini-media";
import { claudeJson } from "../llm";
import { storeFilePath } from "../media";
import { dataDir } from "../migrate";
import { engineFor, ownAudio, ownClipEngineInfo, ownClipFile, ownClipStatus, ownClipSubmit, ownLipsync } from "../own-video";
import { kvGet, kvSet, log } from "../repo";
import { mediaDuration, runCmd } from "../render";
import { nowIso, sleep, uid } from "../utils";
import { allShots, motionPrompt, nameTags, negativeFor, portraitPrompt, shotMax, stillPrompt, type EpisodeAspect, type EpisodeLength, type EpisodePlan, type Shot } from "./plan";
import { buildTimeline, captions, type Timeline } from "./timeline";
import { writeEpisodePlan } from "./write";

/**
 * Episode Studio's production line. Every step saves its work in the episode's folder and its progress in the
 * database before the next one starts, so a restart (a deploy, a crash) picks up where it stopped:
 *   plan → cast portraits → first frames → acted voices → the edit → filmed shots (checked, retaken when frozen or
 *   broken, lips synced) → score, effects and mix → the finish (grade, titles, captions) → the Media Library.
 * Pictures: FLUX.2 pro on the owner's Azure AI (keeps every face from its portrait). Voices: Azure neural voices,
 * acted. Shots, music, effects and lip sync: Vueio's GPU engine. Writing and the visual check: Claude.
 */
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

export async function newEpisode(owner: string, o: { prompt: string; length: EpisodeLength; aspect: EpisodeAspect; credits: number }): Promise<EpisodeRecord> {
  const r: EpisodeRecord = { id: uid(), owner, prompt: o.prompt.trim().slice(0, 4000), length: o.length, aspect: o.aspect, step: "queued", message: STEP_LABEL.queued, progress: 0, clips: {}, credits: o.credits, createdAt: nowIso(), updatedAt: nowIso() };
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
function runFinish(spec: string, out: string, onItem: (k: number, n: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("python3", [path.join(SCRIPTS, "finish.py"), spec, out], { stdio: ["ignore", "pipe", "pipe"] });
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
      user: `Six frames in order from one 5-second shot. Intended action: ${shot.motion}${who ? `\nPeople: ${who}` : ""}`,
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
const MAX_ATTEMPTS = 3;

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
    // 1 · The plan. The shot length limit comes from the engine (it wakes the GPU, which is needed next anyway).
    let maxSeconds = 5.04;
    try {
      maxSeconds = Math.min(5.04, (await ownClipEngineInfo()).maxSeconds || 5.04);
    } catch (e) {
      if (e instanceof MediaGenError && e.kind === "config") throw e;
    }
    const maxShot = shotMax(maxSeconds);
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

    // 6 · Filming: shots go to the GPU a few at a time (a long queue would outlive the engine's job retention), each
    // downloaded as soon as it's ready, checked, and filmed again when it's frozen or visibly broken.
    await film(r, plan, tl, dir, maxSeconds, step);

    // 7 · Lip sync, where a speaking face is on screen and the engine has lip sync.
    const lipEngine = await engineFor("lipsync").catch(() => null);
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

    // 9 · The finish.
    const out = path.join(dir, "episode.mp4");
    if (!(await exists(out))) {
      await step("finishing", "Grading, titles and captions…", 90);
      const tags = nameTags(plan);
      const supers: Record<string, { title: string; sub?: string; seconds: number }> = {};
      for (const b of plan.beats) if (b.super && b.shots?.[0]) supers[b.shots[0].id] = { ...b.super, seconds: 3.2 };
      const byId = new Map(allShots(plan).map((s) => [s.id, s]));
      const [w, h] = r.aspect === "9:16" ? [1080, 1920] : [1920, 1080];
      const accent = [1, 3, 5].map((k) => parseInt(plan.accent.slice(k, k + 2), 16));
      const items = await Promise.all(
        tl.items.map(async (it) => {
          if (it.kind === "card") return { kind: "card", start: it.start, dur: it.dur, text: it.text, sub: it.sub, style: it.style };
          const lip = path.join(dir, "clips", `${it.id}.lip.mp4`);
          const clip = (await exists(lip)) ? lip : path.join(dir, "clips", `${it.id}.mp4`);
          return { kind: "shot", id: it.id, start: it.start, dur: it.dur, mood: it.mood, clip, still: path.join(dir, "stills", `${it.id}.png`), impacts: byId.get(it.id!)?.impacts ?? [] };
        }),
      );
      const spec = { w, h, fps: 24, total: tl.total, fonts: FONTS, mix, accent, note: "ORIGINAL FICTION  ·  MADE WITH VUEIO", items, captions: captions(plan, tl), supers, tags };
      const specFile = path.join(dir, "finish.json");
      await fs.writeFile(specFile, JSON.stringify(spec));
      await runFinish(specFile, out + ".part.mp4", (k, n) => {
        const p = 90 + (8 * k) / n;
        if (Math.round(p) !== r!.progress) void step("finishing", `Grading, titles and captions: ${k} of ${n}…`, p);
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
          // One shot the engine refuses doesn't stop the episode: it's tried again, then its still stands in.
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
        if (c.lost > 4) c.done = true; // the still's slow push-in stands in
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
      let verdict = "ok";
      try {
        verdict = (JSON.parse((await py("qc.py", [tmp, path.join(dir, "stills", `${id}.png`)], 120_000)).trim().split("\n").pop() || "{}") as { verdict?: string }).verdict ?? "ok";
      } catch {
        /* no check: keep the shot */
      }
      let problem = "";
      if (verdict === "ok") {
        const v = await visualCheck(plan, s, tmp, path.join(dir, "clips"));
        if (v && !v.ok) {
          verdict = "broken";
          problem = v.problem;
        }
      }
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
