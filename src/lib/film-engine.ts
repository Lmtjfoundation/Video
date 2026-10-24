import "server-only";
import { makeImage } from "./pictures";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { asUser, db } from "./db";
import { claudeJson } from "./llm";
import { readFile, storeFile } from "./media";
import { kvGet, kvSet, log } from "./repo";
import { refundCredits } from "./auth";
import { geminiClip, MediaGenError } from "./gemini-media";
import { seedanceFilm, wanClip, type RefFile } from "./replicate-video";
import { ownClip } from "./own-video";
import { mediaDuration, narrate, renderSegment, runCmd } from "./render";
import { CREDIT_COST } from "./plans";
import type { MediaItem } from "./types";
import { nowIso, uid } from "./utils";

/**
 * Film Engine: Ghost Post's filmmaker, built around how Seedance 2.5 works.
 *  - A film is a sequence of segments (beats) of up to 30 seconds. Each segment is one generation holding several
 *    connected shots, written as a timestamped shot list in camera language ("0–8s: wide establishing shot…").
 *  - The reference library holds the cast, locations and style frames (up to 30 pictures), clips (10) and voice
 *    lines or music (10). Shot lists cite them as @Name; the engine turns those into Seedance's [Image1]… tokens.
 *  - Extend: a segment can continue from the last seconds of the one before it, so lighting, characters, camera
 *    language and sound carry across the cut. Fix: one segment's clip is edited by instruction, the rest untouched.
 *  - The edit room joins the segments, keeps the model's sound, adds an optional score and sets the loudness.
 * Engines: Seedance 2.5 (everything above), Gemini Omni Flash on the app's Gemini key (chains ~8-second clips with
 * their own sound), Wan 2.2 (low cost: chains ~5-second clips from each last frame), and a
 * free engine that films each shot from its reference picture with camera moves, the film finish and spoken lines.
 */
const ROW = "filmcuts";
export const MAX_CUTS = 20;
export const MAX_SEGMENTS = 40;
export const MAX_SEGMENT_SECONDS = 30;
export const REF_LIMITS = { image: 30, video: 10, audio: 10 } as const;
export const FILM_ENGINES = ["own", "gemini", "seedance", "wan", "free"] as const;
export type FilmEngineId = (typeof FILM_ENGINES)[number];
export const ENGINE_NAME: Record<FilmEngineId, string> = { own: "Ghost Post's video engine", gemini: "Gemini Omni Flash", seedance: "Seedance 2.5", wan: "Wan 2.2", free: "the free engine" };
export const FILM_ASPECTS = ["9:16", "16:9", "21:9", "1:1"] as const;
export type FilmAspect = (typeof FILM_ASPECTS)[number];
const SIZE: Record<FilmAspect, [number, number]> = { "9:16": [1080, 1920], "16:9": [1920, 1080], "21:9": [1920, 822], "1:1": [1080, 1080] };
/** Seconds of the previous segment handed to Seedance to continue from. */
const CONTINUE_TAIL = 5;
/** Wan 2.2 and Ghost Post's engine make about 5 seconds per clip. */
const CHAIN_CLIP = 5;
/** Gemini clips are planned as 8 seconds (4 or 6 for the last; Veo only makes those lengths), then trimmed. */
const VEO_CLIP = 8;
export function veoLengths(seconds: number): (4 | 6 | 8)[] {
  const out: (4 | 6 | 8)[] = [];
  for (let left = clampSeconds(seconds); left > 0; left -= VEO_CLIP) out.push(left <= 4 ? 4 : left <= 6 ? 6 : 8);
  return out;
}

export type RefKind = "image" | "video" | "audio";
export interface FilmRef {
  id: string;
  kind: RefKind;
  mediaId: string;
  /** How shot lists cite it: @Marcus, @Kitchen. */
  label: string;
}

export type JobStatus = "draft" | "queued" | "generating" | "done" | "failed";
export interface FilmSegment {
  id: string;
  title: string;
  seconds: number;
  /** Timestamped shot list: "0–8s: wide establishing shot of @Marcus…", dialogue in double quotes. */
  shots: string;
  /** Continue from the end of the segment before (Seedance: as a reference clip; Wan: from its last frame). */
  continueFrom: boolean;
  status: JobStatus;
  message?: string;
  clipMediaId?: string;
  /** Earlier clips of this segment, newest last, so a fix can be undone. */
  history?: string[];
  credits?: number;
  updatedAt: string;
}

export interface FilmCut {
  id: string;
  title: string;
  logline: string;
  /** Look and tone, applied to every segment: "Photorealistic, anamorphic, teal and amber, rain-soaked Houston nights". */
  style: string;
  aspect: FilmAspect;
  engine: FilmEngineId;
  /** Seedance makes the sound (dialogue, effects, music) with the picture. */
  nativeAudio: boolean;
  /** A low score bed under the finished film, ducked under speech. */
  score: boolean;
  refs: FilmRef[];
  segments: FilmSegment[];
  filmId?: string;
  final?: { status: JobStatus; mediaId?: string; message?: string; updatedAt: string };
  createdAt: string;
  updatedAt: string;
}

/* ───────────── Storage ───────────── */

export const listCuts = async () => (await kvGet<FilmCut[]>(ROW)) ?? [];
export const getCut = async (id: string) => (await listCuts()).find((c) => c.id === id) ?? null;
export async function saveCut(cut: FilmCut) {
  const all = await listCuts();
  cut.updatedAt = nowIso();
  await kvSet(ROW, [cut, ...all.filter((c) => c.id !== cut.id)].slice(0, MAX_CUTS));
  return cut;
}
export async function deleteCut(id: string) {
  await kvSet(ROW, (await listCuts()).filter((c) => c.id !== id));
}
/** Re-reads the cut before writing, so a background job never overwrites edits made while it ran. */
async function patchSegment(cutId: string, segId: string, patch: Partial<FilmSegment>) {
  const cut = await getCut(cutId);
  const seg = cut?.segments.find((s) => s.id === segId);
  if (!cut || !seg) return null;
  Object.assign(seg, patch, { updatedAt: nowIso() });
  await saveCut(cut);
  return seg;
}
async function patchFinal(cutId: string, patch: Partial<NonNullable<FilmCut["final"]>>) {
  const cut = await getCut(cutId);
  if (!cut) return;
  cut.final = { status: "draft", ...(cut.final ?? {}), ...patch, updatedAt: nowIso() };
  await saveCut(cut);
}

export function newSegment(o: Partial<FilmSegment> = {}): FilmSegment {
  return {
    id: uid("seg"),
    title: o.title?.slice(0, 120) || "New beat",
    seconds: clampSeconds(o.seconds ?? 15),
    shots: (o.shots ?? "").slice(0, 4000),
    continueFrom: o.continueFrom ?? true,
    status: "draft",
    updatedAt: nowIso(),
  };
}
export const clampSeconds = (n: number) => Math.max(3, Math.min(MAX_SEGMENT_SECONDS, Math.round(Number(n) || 15)));

/* ───────────── Shot lists and references ───────────── */

export type Shot = { start: number; end: number; text: string };

/** "0–8s: …" lines into timed shots. Lines without a time join the shot above; no times at all means one shot. */
export function parseShots(text: string, seconds: number): Shot[] {
  const shots: Shot[] = [];
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^(\d+(?:\.\d+)?)\s*(?:s|sec)?\s*[–—-]\s*(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)?\s*[:.)\]-]\s*(.+)$/i);
    if (m) shots.push({ start: Number(m[1]), end: Number(m[2]), text: m[3].trim() });
    else if (shots.length) shots[shots.length - 1].text += ` ${line}`;
    else shots.push({ start: 0, end: seconds, text: line });
  }
  if (!shots.length) return [{ start: 0, end: seconds, text: "" }];
  // Keep the times inside the segment and in order.
  return shots
    .map((s) => ({ ...s, start: Math.max(0, Math.min(s.start, seconds)), end: Math.max(0, Math.min(s.end, seconds)) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
}

/** Lines in double quotes are dialogue. */
export const dialogueOf = (text: string) => [...text.matchAll(/["“]([^"”]{2,400})["”]/g)].map((m) => m[1].trim());

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** @mentions: any label in the library (longest first, so "@Rain plate" beats "@Rain"), @Image2-style positions, or a single word. */
const mentions = (refs: FilmRef[]) =>
  new RegExp(`@(${[...refs.map((r) => r.label).filter(Boolean).sort((a, b) => b.length - a.length).map(escape), "(?:image|video|audio)\\d+", "[A-Za-z][\\w'-]*"].join("|")})(?![\\w'-])`, "gi");

/** The reference an @mention means: its label (any case or spacing), or @Image2-style position in the library. */
export function findRef(refs: FilmRef[], name: string): FilmRef | undefined {
  const idx = name.match(/^(image|video|audio)(\d+)$/i);
  if (idx) return refs.filter((r) => r.kind === idx[1].toLowerCase())[Number(idx[2]) - 1];
  const n = norm(name);
  return refs.find((r) => norm(r.label) === n);
}

/**
 * The references a segment uses, in the order Seedance will number them, and the prompt text with each @Name (or
 * @Image2-style index into the library) replaced by [Image1]/[Video1]/[Audio1]. A segment that cites no pictures gets
 * every picture in the library, so the cast stays recognisable.
 */
export function resolveRefs(refs: FilmRef[], text: string) {
  const byKind = (k: RefKind) => refs.filter((r) => r.kind === k);
  const used: Record<RefKind, FilmRef[]> = { image: [], video: [], audio: [] };
  const find = (name: string) => findRef(refs, name);
  const tag = (r: FilmRef) => {
    const list = used[r.kind];
    if (!list.includes(r)) list.push(r);
    return `[${r.kind[0].toUpperCase()}${r.kind.slice(1)}${list.indexOf(r) + 1}]`;
  };
  const prompt = text.replace(mentions(refs), (whole, name: string) => {
    const r = find(name);
    return r ? `${tag(r)} (${r.label})` : whole.slice(1);
  });
  if (!used.image.length) for (const r of byKind("image")) used.image.push(r);
  return { prompt, images: used.image.slice(0, REF_LIMITS.image), videos: used.video.slice(0, REF_LIMITS.video), audios: used.audio.slice(0, REF_LIMITS.audio) };
}

/** The Seedance production brief for one segment, and which references go with it. Pure, so it is tested directly. */
export function seedanceBrief(cut: Pick<FilmCut, "refs" | "style" | "aspect" | "nativeAudio">, seg: Pick<FilmSegment, "seconds" | "shots" | "title">, o: { continuing?: boolean; fix?: string } = {}) {
  const r = resolveRefs(cut.refs, seg.shots);
  // A continuation or an edit passes a clip of our own as [Video1]; the user's clips follow it.
  const lead = o.continuing || o.fix ? 1 : 0;
  const prompt = (lead ? r.prompt.replace(/\[Video(\d+)\]/g, (_, n) => `[Video${Number(n) + 1}]`) : r.prompt).trim();
  const cast = r.images.map((ref, i) => `[Image${i + 1}] is ${ref.label}`).join("; ");
  const lines = o.fix
    ? [
        `Edit [Video1]: ${o.fix.trim()}`,
        "Change only what this asks; keep every other moment, the framing, the characters, the lighting and the sound exactly as they are.",
        cast && `References: ${cast}. Keep each character's exact appearance from their reference image.`,
      ]
    : [
        `Production brief — ${seg.title}. ${cut.style}`.trim(),
        o.continuing && "Extend [Video1]: continue seamlessly from its final moment, matching the characters' positions and poses, the lighting, the camera language and the sound.",
        `Shot list (${seg.seconds} seconds, one continuous scene with logical cuts):`,
        prompt,
        cast && `References: ${cast}.`,
        "Maintain each character's exact appearance from their reference image: same face, hair, build and wardrobe; consistent identity, no deformation or drift.",
        cut.nativeAudio ? "Dialogue in double quotes is spoken on screen with accurate lip-sync; natural ambient sound and effects." : "",
        "Professional cinematography, intentional motion, consistent physics, no jitter, no floating, no warped hands, no on-screen text or watermarks.",
      ];
  return {
    prompt: lines.filter(Boolean).join("\n"),
    images: r.images,
    videos: r.videos,
    audios: r.audios,
    seconds: o.fix ? -1 : seg.seconds,
    // Extending and editing a clip need Seedance's adaptive framing; the edit room crops to the film's shape.
    aspect: o.continuing || o.fix ? "adaptive" : cut.aspect,
  };
}

/* ───────────── Credits ───────────── */

export function segmentCredits(engine: FilmEngineId, seconds: number) {
  if (engine === "seedance") return clampSeconds(seconds) * CREDIT_COST.seedanceSecond;
  if (engine === "gemini") return veoLengths(seconds).reduce((a, b) => a + b, 0) * CREDIT_COST.veoSecond;
  if (engine === "own") return Math.ceil(clampSeconds(seconds) / CHAIN_CLIP) * CHAIN_CLIP * CREDIT_COST.ownSecond;
  if (engine === "wan") return Math.ceil(clampSeconds(seconds) / CHAIN_CLIP) * CHAIN_CLIP * CREDIT_COST.wanSecond;
  return 0;
}

/* ───────────── Writing (Claude) ───────────── */

const DIRECTOR =
  "You are a film director and cinematographer writing production briefs for Seedance 2.5, a video model that makes up to 30 seconds of multi-shot, sound-on footage per generation. " +
  "You write coherent, cinematic beats: each beat is one continuous dramatic unit with a beginning, development, a turn and a resolution, broken into 3–5 timestamped shots that cut logically. " +
  "Use professional camera language (establishing wide, medium, close-up, push-in, tracking, orbit, rack focus, handheld, crane) and say what moves: people, light, weather, objects. " +
  "Cite every character, place or style reference with @ and its exact label (e.g. @Marcus), never describe their faces (the reference does that). " +
  "Dialogue goes in double quotes with the speaker named first, short and natural. Include sound: ambience, effects, music cues. No on-screen text. " +
  "Keep continuity across beats: each beat picks up where the last ended unless it is a deliberate cut to a new place or time.";

const BEAT_SHAPE = '{"title":"short beat name","seconds":20-30,"shots":"0–6s: …\\n6–14s: …\\n14–22s: …\\n22–28s: …"}';

export async function planCut(o: { title: string; story: string; style: string; aspect: FilmAspect; beats: number; seconds: number; labels: string[] }) {
  const beats = Math.max(1, Math.min(MAX_SEGMENTS, Math.round(o.beats)));
  const out = await claudeJson<{ title?: string; logline?: string; style?: string; segments?: { title?: string; seconds?: number; shots?: string }[] }>({
    system: DIRECTOR,
    user: [
      `Plan "${o.title || "an original film"}" as ${beats} beat${beats === 1 ? "" : "s"} of about ${clampSeconds(o.seconds)} seconds each, in ${o.aspect} framing.`,
      `Story / script:\n${o.story.slice(0, 12000)}`,
      o.style && `Look and tone: ${o.style}`,
      o.labels.length ? `References you can cite (use these exact @labels): ${o.labels.map((l) => `@${l}`).join(", ")}` : "There are no reference images yet; describe each character briefly the first time they appear.",
      `Return JSON: {"title":"…","logline":"one sentence","style":"one line of look and tone for every beat","segments":[${BEAT_SHAPE}, …]}. Timestamps start at 0 in every beat and end at the beat's seconds.`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxTokens: 8000,
  });
  return {
    title: String(out.title || o.title || "Untitled film").slice(0, 120),
    logline: String(out.logline || "").slice(0, 400),
    style: String(out.style || o.style || "").slice(0, 400),
    segments: (out.segments ?? []).slice(0, MAX_SEGMENTS).map((s) => newSegment({ title: s.title, seconds: s.seconds ?? o.seconds, shots: s.shots, continueFrom: true })),
  };
}

/** Writes the next beat, continuing from the end of the film so far. */
export async function writeNextBeat(cut: FilmCut, direction: string) {
  const recent = cut.segments.slice(-3).map((s) => `${s.title} (${s.seconds}s):\n${s.shots}`).join("\n\n");
  const out = await claudeJson<{ title?: string; seconds?: number; shots?: string }>({
    system: DIRECTOR,
    user: [
      `Film: ${cut.title}. ${cut.logline}`,
      cut.style && `Look and tone: ${cut.style}`,
      recent ? `The film so far ends with:\n${recent}` : "This is the opening beat.",
      direction && `What happens next: ${direction}`,
      cut.refs.length && `References (exact @labels): ${cut.refs.map((r) => `@${r.label} (${r.kind})`).join(", ")}`,
      `Write the next beat as JSON: ${BEAT_SHAPE}. Continue from the exact last moment unless the direction says to cut away.`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxTokens: 2000,
  });
  return newSegment({ title: out.title, seconds: out.seconds ?? 20, shots: out.shots, continueFrom: true });
}

/* ───────────── Making the footage (background) ───────────── */

let queue: Promise<unknown> = Promise.resolve();
const inFlight = new Set<string>();
const jobKey = (cutId: string, segId: string) => `${cutId}:${segId}`;

/** A job marked running that this server isn't working on was cut off by a restart: fail it and give the credits back. */
export async function releaseOrphans(userId: string, cut: FilmCut): Promise<boolean> {
  let changed = false;
  const stale = (s: { status: JobStatus; updatedAt: string }) => (s.status === "queued" || s.status === "generating") && Date.now() - Date.parse(s.updatedAt) > 30_000;
  for (const seg of cut.segments) {
    if (!stale(seg) || inFlight.has(jobKey(cut.id, seg.id))) continue;
    if (seg.credits) await refundCredits(userId, seg.credits);
    Object.assign(seg, { status: "failed", credits: 0, message: "The server restarted while this was being made, so your credits were returned. Press Generate again.", updatedAt: nowIso() });
    changed = true;
  }
  if (cut.final && stale(cut.final) && !inFlight.has(jobKey(cut.id, "final"))) {
    cut.final = { ...cut.final, status: "failed", message: "The server restarted while the film was being put together. Press Make the film again.", updatedAt: nowIso() };
    changed = true;
  }
  if (changed) await saveCut(cut);
  return changed;
}

function enqueue(userId: string, key: string, fn: () => Promise<void>) {
  inFlight.add(key);
  queue = queue.then(() => asUser(userId, fn).catch(() => {}).finally(() => inFlight.delete(key)));
  return queue;
}

const refFile = async (m: MediaItem, i: number): Promise<RefFile> => ({ bytes: await readFile(m), mime: m.type, name: `ref${i}.${m.storagePath.split(".").pop() || "bin"}` });
async function mediaFor(ids: string[]) {
  const out: MediaItem[] = [];
  for (const id of ids) {
    const m = await db().get<MediaItem>("media", id);
    if (m) out.push(m);
  }
  return out;
}

/** The last `seconds` of a clip, as a file of its own. */
async function tail(file: string, seconds: number, dir: string) {
  const out = path.join(dir, `tail-${path.basename(file)}`);
  await runCmd("ffmpeg", ["-hide_banner", "-y", "-sseof", `-${seconds}`, "-i", file, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-movflags", "+faststart", out]);
  return out;
}
async function lastFrame(file: string, dir: string) {
  const out = path.join(dir, `last-${path.basename(file)}.png`);
  await runCmd("ffmpeg", ["-hide_banner", "-y", "-sseof", "-0.1", "-i", file, "-frames:v", "1", "-update", "1", out]);
  return out;
}
/** Joins clips end to end at the film's size (crop to fill), 30 fps, keeping each clip's sound (or silence). */
async function joinClips(files: string[], W: number, H: number, dir: string, name: string) {
  const parts: string[] = [];
  for (const [i, f] of files.entries()) {
    const out = path.join(dir, `${name}-n${i}.mp4`);
    const hasAudio = (await runCmd("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", f])).trim().length > 0;
    await runCmd("ffmpeg", [
      "-hide_banner", "-y", "-i", f,
      ...(hasAudio ? [] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]),
      "-filter_complex", `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30,setsar=1,format=yuv420p[v];${hasAudio ? "[0:a]" : "[1:a]"}aresample=48000,aformat=channel_layouts=stereo[a]`,
      "-map", "[v]", "-map", "[a]", "-shortest",
      "-c:v", "libx264", "-preset", process.env.RENDER_PRESET || "veryfast", "-crf", "19", "-c:a", "aac", "-b:a", "192k", out,
    ]);
    parts.push(out);
  }
  const list = path.join(dir, `${name}-list.txt`);
  await fs.writeFile(list, parts.map((p) => `file '${p}'`).join("\n"));
  const out = path.join(dir, `${name}.mp4`);
  await runCmd("ffmpeg", ["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out]);
  return out;
}

async function saveClip(userId: string, file: string, name: string) {
  const item = await storeFile(userId, { name, type: "video/mp4", bytes: await fs.readFile(file) }, { uncapped: true });
  item.rendered = true;
  item.durationSec = Math.round(await mediaDuration(file));
  await db().upsert("media", item);
  return item;
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "film";

/** Queues one segment: a fresh generation, or (`fix`) an edit of its current clip. Credits are taken by the caller. */
export async function queueSegment(userId: string, cutId: string, segId: string, credits: number, fix?: string) {
  await patchSegment(cutId, segId, { status: "queued", message: fix ? "Waiting to fix this moment…" : "Waiting to film…", credits });
  return enqueue(userId, jobKey(cutId, segId), () => makeSegment(userId, cutId, segId, credits, fix));
}

async function makeSegment(userId: string, cutId: string, segId: string, credits: number, fix?: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "film-"));
  try {
    const cut = await getCut(cutId);
    const index = cut?.segments.findIndex((s) => s.id === segId) ?? -1;
    if (!cut || index < 0) return;
    const seg = cut.segments[index];
    await patchSegment(cutId, segId, { status: "generating", message: fix ? "Fixing the moment…" : "Filming…" });
    const prev = index > 0 ? cut.segments[index - 1] : null;
    const prevClip = seg.continueFrom && prev?.clipMediaId ? (await mediaFor([prev.clipMediaId]))[0] : undefined;
    const prevFile = prevClip ? path.join(dir, "prev.mp4") : null;
    if (prevClip && prevFile) await fs.writeFile(prevFile, await readFile(prevClip));
    const [W, H] = SIZE[cut.aspect];

    let out: string;
    if (cut.engine === "seedance") {
      const current = fix && seg.clipMediaId ? (await mediaFor([seg.clipMediaId]))[0] : undefined;
      if (fix && !current) throw new MediaGenError("There's no clip to fix yet. Generate this beat first.");
      const brief = seedanceBrief(cut, seg, { continuing: !fix && !!prevFile, fix });
      const lead: RefFile[] = [];
      if (current) lead.push(await refFile(current, 0));
      else if (prevFile) lead.push({ bytes: await fs.readFile(await tail(prevFile, CONTINUE_TAIL, dir)), mime: "video/mp4", name: "continue.mp4" });
      const files = async (refs: FilmRef[]) => Promise.all((await mediaFor(refs.map((r) => r.mediaId))).map(refFile));
      const bytes = await seedanceFilm({
        prompt: brief.prompt,
        images: await files(brief.images),
        videos: [...lead, ...(await files(brief.videos))],
        audios: await files(brief.audios),
        seconds: brief.seconds,
        aspect: brief.aspect,
        audio: cut.nativeAudio,
      });
      out = path.join(dir, "seedance.mp4");
      await fs.writeFile(out, bytes);
    } else if (cut.engine === "wan" || cut.engine === "own" || cut.engine === "gemini") {
      out = await chainSegment(cut.engine, cut, seg, prevFile, dir, fix);
    } else {
      out = await freeSegment(cut, seg, dir, W, H, index, fix);
    }
    const item = await saveClip(userId, out, `${slug(cut.title)}-${String(index + 1).padStart(2, "0")}-${slug(seg.title)}.mp4`);
    const latest = (await getCut(cutId))?.segments.find((s) => s.id === segId);
    await patchSegment(cutId, segId, {
      status: "done",
      clipMediaId: item.id,
      history: [...(latest?.history ?? []), ...(latest?.clipMediaId ? [latest.clipMediaId] : [])].slice(-5),
      credits: 0,
      message: fix ? "Fixed." : `Filmed with ${ENGINE_NAME[cut.engine]}.`,
    });
    await log("info", "generate", `Film Engine: “${cut.title}” beat ${index + 1} ${fix ? "fixed" : "filmed"}`);
  } catch (e) {
    if (credits) await refundCredits(userId, credits);
    const msg = (e as Error).message || "Filming failed.";
    await patchSegment(cutId, segId, { status: "failed", credits: 0, message: `${msg.slice(0, 300)}${credits ? " Your credits were returned." : ""}` });
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Wan 2.2 and Ghost Post's own engine make a beat as ~5-second clips. Each clip starts from the last frame of the one
 * before (continuous motion); a shot that cites a picture of its own starts from that picture instead (a cut to a new
 * place or person). Ghost Post's engine can also start from the prompt alone; Wan needs a picture. Gemini makes ~8-second
 * clips with their own sound (the dialogue too, when the film has native sound on); without a picture it starts from
 * one Gemini draws from the first shot and the cast portraits.
 */
async function chainSegment(engine: "wan" | "own" | "gemini", cut: FilmCut, seg: FilmSegment, prevFile: string | null, dir: string, fix?: string) {
  const shots = parseShots(seg.shots, seg.seconds);
  const r = resolveRefs(cut.refs, seg.shots);
  const picture = async (ref: FilmRef | undefined) => {
    const m = ref && (await mediaFor([ref.mediaId]))[0];
    if (!m) return null;
    const f = path.join(dir, `start-${m.id}.${m.storagePath.split(".").pop()}`);
    await fs.writeFile(f, await readFile(m));
    return f;
  };
  let start = prevFile ? await lastFrame(prevFile, dir) : await picture(shotImage(cut, shots[0]?.text ?? "") ?? r.images[0]);
  if (!start && engine === "gemini") start = await drawStart(cut, r.images, shots[0]?.text ?? seg.shots, dir);
  if (!start && engine === "wan") throw new MediaGenError("Wan starts from a picture: add a reference picture (a cast portrait or location) or continue from the beat before.");
  const clips: string[] = [];
  let current: Shot | undefined;
  const voiced = engine === "gemini" && cut.nativeAudio;
  // Gemini clips can come back a little shorter or longer than asked, so the next clip starts where the footage ends.
  for (let t = 0; t < seg.seconds - 0.25 && clips.length < 12; ) {
    const length = engine === "gemini" ? veoLengths(seg.seconds - t)[0] : CHAIN_CLIP;
    const shot = shots.find((x) => t >= x.start && t < x.end) ?? shots[shots.length - 1];
    if (current && shot !== current) start = (await picture(shotImage(cut, shot.text))) ?? start; // a cut
    current = shot;
    const action = resolveRefs(cut.refs, shot.text).prompt.replace(/\[(Image|Video|Audio)\d+\] /g, "");
    const prompt = [
      cut.style,
      engine === "gemini" && !voiced ? `${action.replace(/"[^"]*"/g, "").trim()} No one speaks; natural ambient sound only.` : action,
      fix && `Change: ${fix}`,
      "Consistent characters, smooth natural motion, cinematic.",
    ].filter(Boolean).join(" ");
    const seconds = Math.min(length, seg.seconds - t);
    const first = start ? { bytes: await fs.readFile(start), mime: start.endsWith(".png") ? "image/png" : start.endsWith(".webp") ? "image/webp" : "image/jpeg" } : undefined;
    const bytes =
      engine === "own"
        ? await ownClip({ prompt, start: first, aspect: cut.aspect, seconds })
        : engine === "gemini"
          ? await geminiClip({ prompt, start: { base64: first!.bytes.toString("base64"), mimeType: first!.mime }, aspect: cut.aspect === "9:16" ? "9:16" : "16:9", seconds: length as 4 | 6 | 8 })
          : await wanClip({ prompt, start: { base64: first!.bytes.toString("base64"), mimeType: first!.mime }, aspect: cut.aspect === "9:16" ? "9:16" : "16:9", seconds: CHAIN_CLIP });
    const clip = path.join(dir, `${engine}${clips.length}.mp4`);
    await fs.writeFile(clip, bytes);
    clips.push(clip);
    t += engine === "gemini" ? Math.max(1, await mediaDuration(clip)) : CHAIN_CLIP;
    start = await lastFrame(clip, dir);
  }
  const [W, H] = SIZE[cut.aspect];
  const joined = await joinClips(clips, W, H, dir, engine);
  const out = path.join(dir, `${engine}-cut.mp4`);
  await runCmd("ffmpeg", ["-hide_banner", "-y", "-i", joined, "-t", String(seg.seconds), "-c", "copy", out]);
  return voiced ? out : speakLines(out, shots, dir);
}

/** Gemini films start from a picture: without one, Gemini draws the opening frame, keeping the cast's faces. */
async function drawStart(cut: FilmCut, cast: FilmRef[], shot: string, dir: string) {
  const refs = await Promise.all(
    (await mediaFor(cast.slice(0, 4).map((r) => r.mediaId))).map(async (m) => ({ mimeType: m.type, base64: (await readFile(m)).toString("base64") })),
  );
  const prompt = [cut.style, "Opening frame of a film shot, photorealistic, cinematic lighting.", resolveRefs(cut.refs, shot).prompt.replace(/\[(Image|Video|Audio)\d+\] /g, "").replace(/"[^"]*"/g, "")].filter(Boolean).join(" ");
  const img = await makeImage({ prompt, refs, aspect: cut.aspect === "9:16" ? "9:16" : cut.aspect === "1:1" ? "1:1" : "16:9" });
  const f = path.join(dir, `start-drawn.${img.mimeType === "image/png" ? "png" : img.mimeType === "image/webp" ? "webp" : "jpg"}`);
  await fs.writeFile(f, img.bytes);
  return f;
}

/**
 * Engines without their own sound get the dialogue spoken by Ghost Post's voice (ElevenLabs, else the free voice),
 * each line starting with its shot. Without a voice on this server the footage is returned as it is.
 */
async function speakLines(video: string, shots: Shot[], dir: string) {
  const lines: { file: string; at: number }[] = [];
  for (const [k, shot] of shots.entries()) {
    const text = dialogueOf(shot.text).join(" ");
    if (!text) continue;
    try {
      lines.push({ file: await narrate(text, path.join(dir, `say${k}`)), at: shot.start });
    } catch {
      return video;
    }
  }
  if (!lines.length) return video;
  const out = video.replace(/\.mp4$/, "-voiced.mp4");
  const delayed = lines.map((l, i) => `[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(l.at * 1000)}:all=1[l${i}]`);
  await runCmd("ffmpeg", [
    "-hide_banner", "-y", "-i", video, ...lines.flatMap((l) => ["-i", l.file]),
    "-filter_complex", `${delayed.join(";")};[0:a]aresample=48000[base];[base]${lines.map((_, i) => `[l${i}]`).join("")}amix=inputs=${lines.length + 1}:normalize=0:duration=first[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", out,
  ]);
  return out;
}

/** The first picture a shot cites, if any. */
function shotImage(cut: FilmCut, text: string): FilmRef | undefined {
  for (const m of text.matchAll(mentions(cut.refs))) {
    const r = findRef(cut.refs, m[1]);
    if (r?.kind === "image") return r;
  }
  return undefined;
}

/** Free engine: each shot is filmed from its reference picture with a camera move and the film finish; lines are spoken. */
async function freeSegment(cut: FilmCut, seg: FilmSegment, dir: string, W: number, H: number, index: number, fix?: string) {
  const shots = parseShots(fix ? `${seg.shots}\n${fix}` : seg.shots, seg.seconds);
  const pictures = cut.refs.filter((r) => r.kind === "image");
  if (!pictures.length) throw new MediaGenError("The free engine films from pictures: add at least one reference picture (a cast portrait, a location or a frame).");
  const files: string[] = [];
  for (const [k, shot] of shots.entries()) {
    const ref = shotImage(cut, shot.text) ?? pictures[(index + k) % pictures.length];
    const m = (await mediaFor([ref.mediaId]))[0];
    if (!m) continue;
    const img = path.join(dir, `pic${k}.${m.storagePath.split(".").pop()}`);
    await fs.writeFile(img, await readFile(m));
    const line = dialogueOf(shot.text).join(" ");
    let audio: string | undefined;
    let dur = Math.max(1.5, shot.end - shot.start);
    if (line) {
      try {
        audio = await narrate(line, path.join(dir, `line${k}`));
        dur = Math.max(dur, (await mediaDuration(audio)) + 0.3);
      } catch {
        audio = undefined; // no voice on this server: the line stays as a subtitle
      }
    }
    files.push(
      await renderSegment({ scene: { time: "", narration: line, onScreen: "", visual: "", motion: "", sfx: "", cast: [] }, dur, audio, visual: { kind: "image", file: img } }, index * 10 + k, dir, W, H, true),
    );
  }
  if (!files.length) throw new MediaGenError("None of this beat's pictures could be read.");
  return joinClips(files, W, H, dir, `free${index}`);
}

/* ───────────── The edit room ───────────── */

export async function queueAssembly(userId: string, cutId: string) {
  await patchFinal(cutId, { status: "queued", message: "Waiting for the edit room…" });
  return enqueue(userId, jobKey(cutId, "final"), () => assemble(userId, cutId));
}

async function assemble(userId: string, cutId: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "film-final-"));
  try {
    const cut = await getCut(cutId);
    if (!cut) return;
    await patchFinal(cutId, { status: "generating", message: "Cutting the film together…" });
    const clips = await mediaFor(cut.segments.map((s) => s.clipMediaId).filter((x): x is string => !!x));
    if (!clips.length) throw new Error("Film at least one beat first.");
    const files: string[] = [];
    for (const [i, m] of clips.entries()) {
      const f = path.join(dir, `seg${i}.mp4`);
      await fs.writeFile(f, await readFile(m));
      files.push(f);
    }
    const [W, H] = SIZE[cut.aspect];
    const joined = await joinClips(files, W, H, dir, "joined");
    const D = await mediaDuration(joined);
    const out = path.join(dir, "final.mp4");
    const mix = cut.score
      ? // A low drone (A, E, a slightly sharp A) breathing slowly, ducked under the film's own sound.
        `[1][2][3]amix=inputs=3:normalize=0,tremolo=f=0.12:d=0.5,lowpass=f=300,volume=0.2,aformat=channel_layouts=stereo,afade=t=in:d=2.5,afade=t=out:st=${Math.max(0, D - 3).toFixed(2)}:d=3[bed];[bed][0:a]sidechaincompress=threshold=0.04:ratio=6:attack=20:release=400[duck];[0:a][duck]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]`
      : "[0:a]loudnorm=I=-14:TP=-1.5:LRA=11[a]";
    await runCmd("ffmpeg", [
      "-hide_banner", "-y", "-i", joined,
      ...(cut.score ? ["-f", "lavfi", "-t", D.toFixed(2), "-i", "sine=f=55:r=48000", "-f", "lavfi", "-t", D.toFixed(2), "-i", "sine=f=82.41:r=48000", "-f", "lavfi", "-t", D.toFixed(2), "-i", "sine=f=110.6:r=48000"] : []),
      "-filter_complex", mix, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", out,
    ]);
    const item = await saveClip(userId, out, `${slug(cut.title)}.mp4`);
    await patchFinal(cutId, { status: "done", mediaId: item.id, message: `${Math.round(D)} seconds · ${clips.length} beat${clips.length === 1 ? "" : "s"}${cut.score ? " · scored" : ""}` });
    await log("info", "generate", `Film Engine: “${cut.title}” cut together (${Math.round(D)}s)`);
  } catch (e) {
    await patchFinal(cutId, { status: "failed", message: ((e as Error).message || "The edit failed.").slice(0, 300) });
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** A character's line as an audio reference: Seedance lip-syncs to it. Uses ElevenLabs when set, else the free voice. */
export async function voiceLine(userId: string, text: string, note?: string): Promise<MediaItem> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "line-"));
  try {
    const file = await narrate(text.slice(0, 600), path.join(dir, "line"), note);
    const type = file.endsWith(".mp3") ? "audio/mpeg" : "audio/wav";
    return await storeFile(userId, { name: `line-${slug(text.slice(0, 30))}.${file.split(".").pop()}`, type, bytes: await fs.readFile(file) });
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
