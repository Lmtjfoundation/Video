import "server-only";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { db } from "./db";
import { claudeJson } from "./llm";
import { readFile, storeFile } from "./media";
import { ENGINE_CLIP_SECONDS, ownClip, ownImage, ownVideoEdit, type VideoEditTask } from "./own-video";
import { CREDIT_COST } from "./plans";
import { runCmd } from "./render";
import type { MediaItem } from "./types";
import { pcm, SR } from "./voice-studio";

/**
 * Video tools: Smart Shot (one idea filmed as 3–5 camera cuts of the same scene), Music Video (pictures or clips
 * cut on the song's beat) and video edits on the engine (restyle, relight, motion control, new background,
 * inpaint). Every result goes to the Media Library.
 */

async function tmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ghost-post-vt-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
const ff = (args: string[], ms = 20 * 60_000) => runCmd("ffmpeg", ["-hide_banner", "-y", ...args], ms);
const duration = async (f: string) => Number((await runCmd("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], 60_000)).trim()) || 0;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "video";
export const frameSize = (aspect: string): [number, number] => (aspect === "16:9" ? [1920, 1080] : aspect === "1:1" ? [1080, 1080] : [1080, 1920]);

async function media(id: string, kinds: MediaItem["kind"][], what: string) {
  const m = await db().get<MediaItem>("media", id);
  if (!m || !kinds.includes(m.kind)) throw new Error(`Choose ${what} from your Media Library.`);
  return m;
}

/** One finished segment: a clip (looped or trimmed to `seconds`) or a still with a slow push-in. */
async function segment(dir: string, i: number, src: { file: string; still: boolean }, seconds: number, W: number, H: number) {
  const out = path.join(dir, `seg${i}.mp4`);
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
  if (src.still) {
    const frames = Math.max(1, Math.round(seconds * 30));
    // Alternate push-in and pull-out so a run of pictures doesn't feel mechanical.
    const z = i % 2 ? `'max(1.0,1.08-0.08*on/${frames})'` : `'min(1.08,1+0.08*on/${frames})'`;
    await ff(["-loop", "1", "-i", src.file, "-t", seconds.toFixed(3), "-vf", `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z=${z}:x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${W}x${H}:fps=30,setsar=1`, "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", out]);
  } else await ff(["-stream_loop", "-1", "-i", src.file, "-t", seconds.toFixed(3), "-vf", `${fit},fps=30`, "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", out]);
  return out;
}

/** Joins segments with hard cuts and lays `audio` under them (or keeps it silent). */
async function join(dir: string, parts: string[], audio: string | undefined, total: number) {
  const list = path.join(dir, "list.txt");
  await fs.writeFile(list, parts.map((p) => `file '${p}'`).join("\n"));
  const out = path.join(dir, "out.mp4");
  const audioIn = audio ? ["-i", audio] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"];
  await ff(["-f", "concat", "-safe", "0", "-i", list, ...audioIn, "-map", "0:v", "-map", "1:a", "-t", total.toFixed(3), "-c:v", "copy", "-af", audio ? `afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5,loudnorm=I=-14:TP=-1.5` : "anull", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", out]);
  return out;
}

// ---------- Smart Shot ----------

export interface SmartShotInput {
  prompt: string;
  shots: number;
  secondsPerShot: number;
  aspect: string;
  /** A picture to start from (its people and place are kept in every shot). */
  imageId?: string;
}

/** Camera set-ups for a scene, in the order an editor would cut them. */
export const SHOT_PLAN = [
  { camera: "Wide establishing shot, the whole scene and its setting", move: "slow push in" },
  { camera: "Medium shot of the main subject, waist up", move: "gentle handheld drift" },
  { camera: "Close-up on the main subject's face or hands, shallow depth of field", move: "very slow push in" },
  { camera: "Over-the-shoulder or reaction angle from the other side of the scene", move: "slow lateral move" },
  { camera: "Detail insert: one telling object or gesture in extreme close-up", move: "slow tilt" },
];

export const smartShotCredits = (o: Pick<SmartShotInput, "shots" | "secondsPerShot" | "imageId">) =>
  CREDIT_COST.aiImage * (o.shots - 1 + (o.imageId ? 0 : 1)) + CREDIT_COST.ownSecond * Math.ceil(o.secondsPerShot) * o.shots;

/** The shots for one idea: the writer's own coverage when it's available, else the standard coverage above. */
export async function planShots(prompt: string, shots: number): Promise<{ camera: string; action: string; move: string }[]> {
  const base = SHOT_PLAN.slice(0, shots).map((s) => ({ camera: s.camera, action: prompt, move: s.move }));
  try {
    const r = await claudeJson<{ shots: { camera: string; action: string; move: string }[] }>({
      system: "You are a film director planning camera coverage for one moment. Answer with JSON only.",
      user: `Plan ${shots} shots that cover this one moment from different camera set-ups, so they cut together as one scene (same people, place, light and time):\n\n${prompt}\n\nFor each shot give the camera set-up (framing and angle), what happens in it (one sentence, continuing the moment), and one slow camera move.\nJSON: {"shots": [{"camera": "...", "action": "...", "move": "..."}]}`,
      maxTokens: 1200,
      temperature: 0.6,
    });
    const list = (r.shots ?? []).filter((s) => s?.camera && s?.action).slice(0, shots);
    return list.length === shots ? list.map((s) => ({ camera: String(s.camera).slice(0, 200), action: String(s.action).slice(0, 400), move: String(s.move || "slow push in").slice(0, 80) })) : base;
  } catch {
    return base;
  }
}

/**
 * Smart Shot: the moment is filmed as several camera cuts of one scene. A keyframe is made for each camera set-up by
 * editing one master picture (so faces, clothes, place and light match), each keyframe becomes a clip, and the clips
 * are cut together.
 */
export async function smartShot(userId: string, o: SmartShotInput, onStep?: (msg: string) => void): Promise<MediaItem> {
  const shots = Math.max(3, Math.min(5, Math.round(o.shots)));
  const secs = Math.max(2, Math.min(ENGINE_CLIP_SECONDS, o.secondsPerShot));
  const plan = await planShots(o.prompt.trim().slice(0, 1500), shots);
  const [W, H] = frameSize(o.aspect);
  let master: { bytes: Buffer; mime: string };
  if (o.imageId) {
    const m = await media(o.imageId, ["image"], "the starting picture");
    master = { bytes: await readFile(m), mime: m.type };
  } else {
    onStep?.("Making the master shot…");
    master = { bytes: await ownImage({ prompt: `${plan[0].camera}. ${o.prompt}. Cinematic film still, natural light, rich detail.`, aspect: o.aspect }), mime: "image/png" };
  }
  return tmp(async (dir) => {
    const parts: string[] = [];
    for (const [i, s] of plan.entries()) {
      onStep?.(`Shot ${i + 1} of ${plan.length}: ${s.camera.split(",")[0].toLowerCase()}…`);
      const key = i === 0 ? master : { bytes: await ownImage({ prompt: `The same moment as picture 1, filmed from a different camera set-up: ${s.camera}. ${s.action} Keep the same people, faces, clothes, place, light and time of day.`, refs: [master], aspect: o.aspect }), mime: "image/png" };
      const f = path.join(dir, `clip${i}.mp4`);
      await fs.writeFile(f, await ownClip({ prompt: `${s.action} Camera: ${s.camera}, ${s.move}. Cinematic, natural motion.`, start: key, aspect: o.aspect, seconds: secs }));
      parts.push(await segment(dir, i, { file: f, still: false }, secs, W, H));
    }
    const out = await join(dir, parts, undefined, secs * parts.length);
    return storeFile(userId, { name: `smart-shot-${slug(o.prompt.split(/\s+/).slice(0, 6).join(" "))}.mp4`, type: "video/mp4", bytes: await fs.readFile(out) }, { uncapped: true });
  });
}

// ---------- Music Video ----------

/**
 * Beat-aligned cut points for a song: an onset envelope (rises in short-time energy), the tempo by autocorrelation
 * (70–180 BPM), the beat phase that lands on the strongest onsets, then a cut every bar or two so each shot lasts
 * about `target` seconds. Returns the cut times in seconds, starting at 0 and ending at the song's end.
 */
export function beatCuts(x: Float32Array, sr: number, target = 3): { cuts: number[]; bpm: number } {
  const hop = 512;
  const win = 1024;
  const n = Math.max(0, Math.floor((x.length - win) / hop));
  const total = x.length / sr;
  const env = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let j = 0; j < win; j++) e += x[i * hop + j] ** 2;
    e = Math.log1p(e);
    env[i] = Math.max(0, e - prev);
    prev = e;
  }
  const fps = sr / hop;
  // A rise in energy first shows in the window that just reaches the sound: frame i is at about (i·hop + win − hop/2).
  const timeOf = (i: number) => (i * hop + win - hop / 2) / sr;
  const at = (f: number) => env[Math.round(f)] ?? 0;
  // How well a beat grid (period in frames, phase in frames) lines up with the onsets.
  const comb = (lag: number, phase: number) => {
    let s = 0;
    for (let k = phase; k < n; k += lag) s += Math.max(at(k - 1), at(k), at(k + 1));
    return s;
  };
  const bestPhase = (lag: number) => {
    let phase = 0;
    let top = -1;
    for (let p = 0; p < lag; p += 0.5) {
      const v = comb(lag, p);
      if (v > top) {
        top = v;
        phase = p;
      }
    }
    return { phase, score: top };
  };
  // Coarse tempo by autocorrelation (70–180 BPM), then refined to 0.05 BPM so the grid doesn't drift over a song.
  let coarse = 120;
  let best = -1;
  for (let bpm = 70; bpm <= 180; bpm++) {
    const lag = Math.round((fps * 60) / bpm);
    let v = 0;
    for (let i = 0; i + lag < n; i++) v += env[i] * env[i + lag];
    // A mild preference for 90–130 BPM settles double- and half-tempo ties the way a listener would.
    v *= bpm >= 90 && bpm <= 130 ? 1.05 : 1;
    if (v > best) {
      best = v;
      coarse = bpm;
    }
  }
  let bpm = coarse;
  let phase = 0;
  best = -1;
  for (let b = coarse - 1.5; b <= coarse + 1.5; b += 0.05) {
    const r = bestPhase((fps * 60) / b);
    if (r.score > best) {
      best = r.score;
      bpm = b;
      phase = r.phase;
    }
  }
  const lag = (fps * 60) / bpm;
  const period = 60 / bpm;
  // Each cut lands on the strongest onset within 70 ms of its grid position.
  const snap = (f: number) => {
    let i = Math.round(f);
    for (let k = Math.round(f - 0.07 * fps); k <= Math.round(f + 0.07 * fps); k++) if (k >= 0 && k < n && env[k] > env[i]) i = k;
    return timeOf(i);
  };
  const beatsPerCut = Math.max(2, Math.round(target / period / 2) * 2);
  const cuts = [0];
  for (let f = phase + lag * beatsPerCut; timeOf(f) < total - period; f += lag * beatsPerCut) {
    const t = snap(f);
    if (t - cuts.at(-1)! > 1) cuts.push(Math.round(t * 1000) / 1000);
  }
  if (total - cuts.at(-1)! < 1 && cuts.length > 1) cuts.pop();
  cuts.push(Math.round(total * 1000) / 1000);
  return { cuts, bpm: Math.round(bpm) };
}

export interface MusicVideoInput {
  audioId: string;
  /** The look and story of the video. */
  idea: string;
  aspect: string;
  /** "pictures": stills with movement (cheaper); "clips": every shot filmed by the engine. */
  motion: "pictures" | "clips";
}
export const MUSIC_VIDEO_MAX_SECONDS = 240;

export function musicVideoCredits(o: Pick<MusicVideoInput, "motion">, cuts: number[]) {
  const shots = cuts.length - 1;
  const filmed = o.motion === "clips" ? cuts.slice(1).reduce((n, t, i) => n + Math.ceil(Math.min(ENGINE_CLIP_SECONDS, t - cuts[i])), 0) : 0;
  return CREDIT_COST.aiImage * shots + CREDIT_COST.ownSecond * filmed;
}

/** Reads a song from the Media Library and finds its cuts (for pricing before starting). */
export async function songCuts(audioId: string) {
  const m = await media(audioId, ["audio", "video"], "the song");
  return tmp(async (dir) => {
    const f = path.join(dir, `song.${m.storagePath.split(".").pop()}`);
    await fs.writeFile(f, await readFile(m));
    const seconds = await duration(f);
    if (seconds > MUSIC_VIDEO_MAX_SECONDS) throw new Error(`Music videos take songs of up to ${MUSIC_VIDEO_MAX_SECONDS / 60} minutes.`);
    if (seconds < 8) throw new Error("The song needs to be at least 8 seconds.");
    return { ...beatCuts(await pcm(f), SR), seconds };
  });
}

/** The pictures of a music video, one per cut: the writer's when it's available, else variations on the idea. */
export async function musicVideoScenes(idea: string, shots: number, lyrics: string): Promise<string[]> {
  const fallback = Array.from({ length: shots }, (_, i) => `${idea}. ${["Wide shot", "Close-up", "Medium shot", "Detail shot", "Silhouette against the light", "Low angle"][i % 6]}.`);
  try {
    const r = await claudeJson<{ scenes: string[] }>({
      system: "You are a music video director. Answer with JSON only.",
      user: `Write ${shots} shot descriptions for a music video, in order, one per cut. Keep one consistent look, cast and color palette; vary the framing; build energy toward the end.\nIdea: ${idea}\n${lyrics ? `Lyrics heard (for meaning, don't put text on screen): ${lyrics.slice(0, 2500)}\n` : ""}JSON: {"scenes": ["..."]}`,
      maxTokens: 3000,
      temperature: 0.8,
    });
    const list = (r.scenes ?? []).map((s) => String(s).slice(0, 400)).filter(Boolean);
    return list.length >= shots ? list.slice(0, shots) : fallback;
  } catch {
    return fallback;
  }
}

/** Music Video: a picture (or filmed clip) for every cut, each exactly as long as its stretch of beats, over the song. */
export async function musicVideo(userId: string, o: MusicVideoInput, deps: { hear?: (file: string) => Promise<{ text: string }[]> } = {}, onStep?: (msg: string) => void): Promise<MediaItem> {
  const song = await media(o.audioId, ["audio", "video"], "the song");
  const [W, H] = frameSize(o.aspect);
  return tmp(async (dir) => {
    const src = path.join(dir, `input.${song.storagePath.split(".").pop()}`);
    await fs.writeFile(src, await readFile(song));
    const audio = path.join(dir, "song.wav");
    await ff(["-i", src, "-vn", "-ac", "2", "-ar", "48000", audio]);
    const { cuts } = beatCuts(await pcm(audio), SR);
    onStep?.("Listening to the words…");
    const words = await (deps.hear ?? (async (f: string) => (await import("./transcribe")).transcribe(f)))(audio).catch(() => [] as { text: string }[]);
    const scenes = await musicVideoScenes(o.idea.trim().slice(0, 1500), cuts.length - 1, words.map((w) => w.text).join(" "));
    const parts: string[] = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      onStep?.(`Shot ${i + 1} of ${cuts.length - 1}…`);
      const len = cuts[i + 1] - cuts[i];
      const pic = path.join(dir, `pic${i}.png`);
      await fs.writeFile(pic, await ownImage({ prompt: `${scenes[i]} Music video still, cinematic, ${o.idea.slice(0, 200)}. No text.`, aspect: o.aspect }));
      if (o.motion === "clips") {
        const clip = path.join(dir, `clip${i}.mp4`);
        await fs.writeFile(clip, await ownClip({ prompt: `${scenes[i]} Moves with the rhythm of the music, cinematic camera.`, start: { bytes: await fs.readFile(pic), mime: "image/png" }, aspect: o.aspect, seconds: Math.min(ENGINE_CLIP_SECONDS, Math.ceil(len)) }));
        parts.push(await segment(dir, i, { file: clip, still: false }, len, W, H));
      } else parts.push(await segment(dir, i, { file: pic, still: true }, len, W, H));
    }
    const out = await join(dir, parts, audio, cuts.at(-1)!);
    return storeFile(userId, { name: `music-video-${slug(song.name.replace(/\.[a-z0-9]+$/i, ""))}.mp4`, type: "video/mp4", bytes: await fs.readFile(out) }, { uncapped: true });
  });
}

// ---------- Video edits ----------

export interface VideoEditInput {
  task: VideoEditTask;
  videoId: string;
  prompt: string;
  /** motion: who performs the clip's motion; background/inpaint: optional look reference. */
  imageId?: string;
  box?: [number, number, number, number];
}

export async function videoEditSeconds(videoId: string) {
  const m = await media(videoId, ["video"], "a video");
  return tmp(async (dir) => {
    const f = path.join(dir, `v.${m.storagePath.split(".").pop()}`);
    await fs.writeFile(f, await readFile(m));
    return Math.min(ENGINE_CLIP_SECONDS, await duration(f));
  });
}
export const videoEditCredits = (seconds: number) => CREDIT_COST.editSecond * Math.max(1, Math.ceil(seconds));

/** A video edit on the engine (up to its first 5 seconds); the clip's own sound is put back under the result. */
export async function editVideo(userId: string, o: VideoEditInput): Promise<MediaItem> {
  const v = await media(o.videoId, ["video"], "a video");
  if (o.task === "motion" && !o.imageId) throw new Error("Choose a picture of who (or what) performs the motion.");
  const pic = o.imageId ? await media(o.imageId, ["image"], "a picture") : undefined;
  return tmp(async (dir) => {
    const src = path.join(dir, `src.${v.storagePath.split(".").pop()}`);
    await fs.writeFile(src, await readFile(v));
    const [w, h] = (await runCmd("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", src], 60_000)).trim().split(",").map(Number);
    const aspect = w / h > 1.25 ? "16:9" : w / h < 0.8 ? "9:16" : "1:1";
    const seconds = Math.min(ENGINE_CLIP_SECONDS, await duration(src));
    const edited = path.join(dir, "edited.mp4");
    await fs.writeFile(edited, await ownVideoEdit({ task: o.task, video: await fs.readFile(src), prompt: o.prompt, image: pic ? { bytes: await readFile(pic), mime: pic.type } : undefined, box: o.box, aspect, seconds }));
    const out = path.join(dir, "out.mp4");
    const [W, H] = frameSize(aspect);
    const len = await duration(edited);
    const hasSound = !!(await runCmd("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", src], 60_000)).trim();
    await ff([
      "-i", edited, ...(hasSound ? ["-i", src] : []),
      "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},fps=30,setsar=1`, "-map", "0:v", ...(hasSound ? ["-map", "1:a", "-c:a", "aac", "-b:a", "192k"] : []),
      "-t", len.toFixed(3), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out,
    ]);
    return storeFile(userId, { name: `edit-${o.task}-${slug(v.name.replace(/\.[a-z0-9]+$/i, ""))}.mp4`, type: "video/mp4", bytes: await fs.readFile(out) }, { uncapped: true });
  });
}
