import "server-only";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { db } from "./db";
import { isSpeechLanguage } from "./languages";
import { readFile, storeFile } from "./media";
import { ownDesignVoice, ownIsolate, ownLipsync } from "./own-video";
import { CREDIT_COST } from "./plans";
import { runCmd } from "./render";
import { kvGet, kvSet } from "./repo";
import { captionLines, parseScript, stripTags, toSrt, type TimedText } from "./speech-text";
import type { MediaItem } from "./types";
import { nowIso, uid } from "./utils";
import { DESIGN_SAMPLE_TEXT, STOCK_VOICES, type VoiceChoice } from "./voice-catalog";
import { chunks, pcm, SR, speak, wavBytes } from "./voice-studio";
import { listVoices } from "./voices";

/**
 * Voice Lab: Ghost Post's own text to speech with emotion tags, voice design, a voice library, speech to text,
 * a voice isolator, Audio Studio (long-form narration in chapters) and voice to video. Free voices and speech to
 * text run on Ghost Post's server; cloned and designed voices, the 23 languages, isolation and lip sync run on
 * the engine. Every result goes to the Media Library.
 */

async function tmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ghost-post-lab-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
const ff = (args: string[], ms = 20 * 60_000) => runCmd("ffmpeg", ["-hide_banner", "-y", ...args], ms);
const probe = async (file: string, entries: string, stream?: string) =>
  (await runCmd("ffprobe", ["-v", "error", ...(stream ? ["-select_streams", stream] : []), "-show_entries", entries, "-of", "csv=p=0", file], 60_000)).trim();
const duration = async (file: string) => Number(await probe(file, "format=duration")) || 0;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "audio";

async function media(id: string, kinds: MediaItem["kind"][], what: string) {
  const m = await db().get<MediaItem>("media", id);
  if (!m || !kinds.includes(m.kind)) throw new Error(`Choose ${what} from your Media Library.`);
  return m;
}
async function toFile(m: MediaItem, dir: string, name: string) {
  const f = path.join(dir, `${name}.${m.storagePath.split(".").pop()}`);
  await fs.writeFile(f, await readFile(m));
  return f;
}
const joinPcm = (parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** Checks a voice choice: a known free voice, or an engine language (and, if named, one of My Voices). */
export async function checkVoice(v: unknown): Promise<VoiceChoice> {
  const c = (v ?? {}) as Partial<{ kind: string; id: string; speed: number; language: string; voiceId: string }>;
  if (c.kind === "free") {
    if (!STOCK_VOICES.some((s) => s.id === c.id)) throw new Error("Choose a voice from the Voice Library.");
    return { kind: "free", id: c.id!, speed: Math.min(1.3, Math.max(0.7, Number(c.speed) || 1)) };
  }
  if (c.kind === "engine") {
    if (!isSpeechLanguage(c.language)) throw new Error("Choose a language.");
    if (c.voiceId && !(await listVoices()).some((x) => x.id === c.voiceId)) throw new Error("That voice isn't in My Voices.");
    return { kind: "engine", language: c.language, voiceId: c.voiceId || undefined };
  }
  throw new Error("Choose a voice.");
}

/** Credits to voice `chars` characters: free voices cost the AI Voiceover rate, the engine the speech rate. */
export const voiceCredits = (chars: number, v: VoiceChoice) => (v.kind === "free" ? CREDIT_COST.voiceover : CREDIT_COST.speech) * Math.max(1, Math.ceil(chars / 1000));

/** A free voice reading a script: Kokoro can't act emotions, but pauses and loudness tags still apply. Mono WAV, 48 kHz. */
export async function freeSpeak(text: string, voice: string, speed = 1): Promise<Buffer> {
  const { freeVoice } = await import("./free-voice");
  return tmp(async (dir) => {
    const parts: Float32Array[] = [];
    let n = 0;
    for (const part of parseScript(text)) {
      if (part.pause) parts.push(new Float32Array(Math.round(SR * part.pause)));
      for (const c of part.text ? chunks(part.text, 900) : []) {
        const f = path.join(dir, `p${n++}.wav`);
        await freeVoice(c, f, undefined, { voice, speed });
        const x = await pcm(f);
        if (part.gain !== 1) for (let i = 0; i < x.length; i++) x[i] *= part.gain;
        parts.push(x, new Float32Array(Math.round(SR * 0.2)));
      }
    }
    if (!n) throw new Error("Type what the voice should say.");
    return wavBytes(joinPcm(parts));
  });
}

/** Any script in any voice choice, as a mono 48 kHz WAV. */
export const voiceWav = (text: string, v: VoiceChoice) => (v.kind === "free" ? freeSpeak(text, v.id, v.speed) : speak(text, v.language, v.voiceId));

async function mp3(wav: Buffer, extra: string[] = []) {
  return tmp(async (dir) => {
    await fs.writeFile(path.join(dir, "a.wav"), wav);
    await ff(["-i", path.join(dir, "a.wav"), ...extra, "-af", "loudnorm=I=-16:TP=-1.5", "-codec:a", "libmp3lame", "-b:a", "192k", path.join(dir, "a.mp3")]);
    return fs.readFile(path.join(dir, "a.mp3"));
  });
}

/** Text to speech in the Voice Lab: any voice choice, with emotion tags. Saved as an MP3. */
export async function labSpeech(userId: string, o: { text: string; voice: VoiceChoice }): Promise<MediaItem> {
  const audio = await mp3(await voiceWav(o.text, o.voice));
  const words = stripTags(o.text).split(/\s+/).slice(0, 6).join(" ");
  return storeFile(userId, { name: `speech-${slug(words)}.mp3`, type: "audio/mpeg", bytes: audio });
}

/** Voice design: the engine reads a sample in a new voice made from the description (saved to the Media Library as a WAV). */
export async function designVoice(userId: string, o: { description: string; text?: string; seed?: number }): Promise<MediaItem> {
  const description = o.description.trim();
  if (description.length < 10) throw new Error("Describe the voice in a sentence: age, tone, pace, accent, how close to the mic.");
  const wav = await ownDesignVoice({ description, text: o.text?.trim() || DESIGN_SAMPLE_TEXT, seed: o.seed });
  // The sample becomes the voice's reference for the speech engine: mono, 24 kHz, level.
  const clean = await tmp(async (dir) => {
    await fs.writeFile(path.join(dir, "in.wav"), wav);
    await ff(["-i", path.join(dir, "in.wav"), "-ac", "1", "-ar", "24000", "-af", "loudnorm=I=-18:TP=-2", path.join(dir, "out.wav")]);
    return fs.readFile(path.join(dir, "out.wav"));
  });
  return storeFile(userId, { name: `designed-voice-${slug(description.split(/\s+/).slice(0, 5).join(" "))}.wav`, type: "audio/wav", bytes: clean });
}

/** A transcript from Speech to Text, kept so it can be downloaded again as SRT, VTT or text. */
export interface Transcript {
  id: string;
  name: string;
  mediaId: string;
  seconds: number;
  lines: TimedText[];
  createdAt: string;
}
const TRANSCRIPTS = "transcripts";
export const MAX_TRANSCRIPTS = 50;
export const listTranscripts = async () => (await kvGet<Transcript[]>(TRANSCRIPTS)) ?? [];

/** Speech to text on Ghost Post's own server (Whisper): every line with its timing, in any language Whisper knows. */
export async function transcribeMedia(o: { mediaId: string }, deps: { hear?: (file: string) => Promise<TimedText[]> } = {}): Promise<Transcript> {
  const m = await media(o.mediaId, ["audio", "video"], "a recording or video");
  const t = await tmp(async (dir) => {
    const src = await toFile(m, dir, "src");
    const wav = path.join(dir, "sound.wav");
    await ff(["-i", src, "-vn", "-ac", "1", "-ar", "16000", wav]);
    const lines = deps.hear ? await deps.hear(wav) : await (await import("./transcribe")).transcribe(wav);
    return { seconds: await duration(wav), lines: lines.filter((l) => l.text.trim()).map((l) => ({ start: l.start, end: l.end, text: l.text.trim() })) };
  });
  if (!t.lines.length) throw new Error("No speech was heard in that file.");
  const tr: Transcript = { id: uid("trn"), name: m.name, mediaId: m.id, seconds: Math.round(t.seconds * 10) / 10, lines: t.lines, createdAt: nowIso() };
  await kvSet(TRANSCRIPTS, [tr, ...(await listTranscripts())].slice(0, MAX_TRANSCRIPTS));
  return tr;
}

export async function deleteTranscript(id: string) {
  await kvSet(TRANSCRIPTS, (await listTranscripts()).filter((t) => t.id !== id));
}

/** Voice isolator: keeps the voice (or everything but the voice). A video keeps its picture. */
export async function isolateVoice(userId: string, o: { mediaId: string; stem: "vocals" | "background" }): Promise<MediaItem> {
  const m = await media(o.mediaId, ["audio", "video"], "a recording or video");
  return tmp(async (dir) => {
    const src = await toFile(m, dir, "src");
    const wav = path.join(dir, "pcm.wav");
    await ff(["-i", src, "-vn", "-ac", "2", "-ar", "44100", wav]);
    const out = path.join(dir, "iso.wav");
    await fs.writeFile(out, await ownIsolate({ source: await fs.readFile(wav), stem: o.stem }));
    const name = `${o.stem === "vocals" ? "voice-only" : "no-voice"}-${slug(m.name)}`;
    if (m.kind === "video") {
      const mp4 = path.join(dir, "out.mp4");
      await ff(["-i", src, "-i", out, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", mp4]);
      return storeFile(userId, { name: `${name}.mp4`, type: "video/mp4", bytes: await fs.readFile(mp4) }, { uncapped: true });
    }
    return storeFile(userId, { name: `${name}.mp3`, type: "audio/mpeg", bytes: await mp3(await fs.readFile(out)) });
  });
}

// ---------- Audio Studio: long-form narration (audiobooks, podcasts) in chapters ----------

export interface AudioBlock {
  id: string;
  text: string;
  voice: VoiceChoice;
}
export interface AudioChapter {
  id: string;
  title: string;
  blocks: AudioBlock[];
}
export interface AudioProject {
  id: string;
  title: string;
  chapters: AudioChapter[];
  createdAt: string;
  updatedAt: string;
  /** The last finished render in the Media Library. */
  renderId?: string;
}
const PROJECTS = "audio-projects";
export const AUDIO_LIMITS = { projects: 30, chapters: 50, blocks: 400, chars: 100_000 };
export const listAudioProjects = async () => (await kvGet<AudioProject[]>(PROJECTS)) ?? [];

/** Checks and saves a project (new when it has no id). Empty paragraphs are dropped. */
export async function saveAudioProject(p: Partial<AudioProject>): Promise<AudioProject> {
  const title = String(p.title ?? "").trim().slice(0, 80);
  if (!title) throw new Error("Name the project.");
  const raw = Array.isArray(p.chapters) ? p.chapters : [];
  if (raw.length > AUDIO_LIMITS.chapters) throw new Error(`A project can have up to ${AUDIO_LIMITS.chapters} chapters.`);
  const chapters: AudioChapter[] = [];
  let blocks = 0;
  let chars = 0;
  for (const [i, c] of raw.entries()) {
    const list: AudioBlock[] = [];
    for (const b of Array.isArray(c?.blocks) ? c.blocks : []) {
      const text = String(b?.text ?? "").trim().slice(0, 5000);
      if (!text) continue;
      list.push({ id: typeof b.id === "string" && b.id ? b.id.slice(0, 40) : uid("blk"), text, voice: await checkVoice(b.voice) });
      chars += text.length;
    }
    blocks += list.length;
    chapters.push({ id: typeof c?.id === "string" && c.id ? c.id.slice(0, 40) : uid("chp"), title: String(c?.title ?? "").trim().slice(0, 80) || `Chapter ${i + 1}`, blocks: list });
  }
  if (blocks > AUDIO_LIMITS.blocks) throw new Error(`A project can have up to ${AUDIO_LIMITS.blocks} paragraphs.`);
  if (chars > AUDIO_LIMITS.chars) throw new Error(`A project can have up to ${AUDIO_LIMITS.chars.toLocaleString()} characters.`);
  const all = await listAudioProjects();
  const old = p.id ? all.find((x) => x.id === p.id) : undefined;
  if (p.id && !old) throw new Error("That project wasn't found.");
  if (!old && all.length >= AUDIO_LIMITS.projects) throw new Error(`You can keep up to ${AUDIO_LIMITS.projects} projects.`);
  const proj: AudioProject = { id: old?.id ?? uid("aud"), title, chapters, createdAt: old?.createdAt ?? nowIso(), updatedAt: nowIso(), renderId: old?.renderId };
  await kvSet(PROJECTS, [proj, ...all.filter((x) => x.id !== proj.id)]);
  return proj;
}

export async function deleteAudioProject(id: string) {
  await kvSet(PROJECTS, (await listAudioProjects()).filter((x) => x.id !== id));
}

export const audioProjectCredits = (p: AudioProject) => p.chapters.flatMap((c) => c.blocks).reduce((n, b) => n + voiceCredits(stripTags(b.text).length, b.voice), 0);

/** Pauses between paragraphs and chapters, in seconds. */
const GAP = { block: 0.45, chapter: 1.6 };

/**
 * Renders a project to one MP3 with chapter markers (ID3 chapters, which podcast and audiobook players show).
 * `voice` makes each paragraph's audio (the real voices by default; tests pass a stand-in).
 */
export async function renderAudioProject(userId: string, id: string, deps: { voice?: typeof voiceWav } = {}): Promise<MediaItem> {
  const proj = (await listAudioProjects()).find((x) => x.id === id);
  if (!proj) throw new Error("That project wasn't found.");
  const chapters = proj.chapters.filter((c) => c.blocks.length);
  if (!chapters.length) throw new Error("Write at least one paragraph first.");
  const say = deps.voice ?? voiceWav;
  const item = await tmp(async (dir) => {
    const parts: Float32Array[] = [];
    const marks: { title: string; start: number; end: number }[] = [];
    let at = 0;
    let n = 0;
    for (const [ci, c] of chapters.entries()) {
      const start = at;
      for (const b of c.blocks) {
        const f = path.join(dir, `b${n++}.wav`);
        await fs.writeFile(f, await say(b.text, b.voice));
        const x = await pcm(f);
        parts.push(x, new Float32Array(Math.round(SR * GAP.block)));
        at += x.length + Math.round(SR * GAP.block);
      }
      if (ci < chapters.length - 1) {
        parts.push(new Float32Array(Math.round(SR * GAP.chapter)));
        at += Math.round(SR * GAP.chapter);
      }
      marks.push({ title: c.title, start: start / SR, end: at / SR });
    }
    const wav = path.join(dir, "all.wav");
    await fs.writeFile(wav, wavBytes(joinPcm(parts)));
    const esc = (s: string) => s.replace(/([=;#\\\n])/g, "\\$1");
    const meta = [";FFMETADATA1", `title=${esc(proj.title)}`, ...marks.map((m) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(m.start * 1000)}\nEND=${Math.round(m.end * 1000)}\ntitle=${esc(m.title)}`)].join("\n");
    await fs.writeFile(path.join(dir, "meta.txt"), meta);
    const out = path.join(dir, "out.mp3");
    await ff(["-i", wav, "-i", path.join(dir, "meta.txt"), "-map", "0:a", "-map_metadata", "1", "-map_chapters", "1", "-af", "loudnorm=I=-18:TP=-1.5", "-codec:a", "libmp3lame", "-b:a", "160k", "-id3v2_version", "3", out]);
    return storeFile(userId, { name: `${slug(proj.title)}.mp3`, type: "audio/mpeg", bytes: await fs.readFile(out) }, { uncapped: true });
  });
  const all = await listAudioProjects();
  await kvSet(PROJECTS, all.map((x) => (x.id === proj.id ? { ...x, renderId: item.id, updatedAt: nowIso() } : x)));
  return item;
}

// ---------- Voice to video ----------

export interface VoiceToVideoOptions {
  videoId: string;
  /** A recording from the Media Library, or a script read in a voice. */
  voice: { mediaId: string } | { text: string; choice: VoiceChoice };
  /** "replace": only the new voice; "duck": the video's own sound continues, lowered whenever the voice speaks. */
  mix: "replace" | "duck";
  captions: boolean;
  lipsync: boolean;
  /** Seconds into the video where the voice starts (a recording made while the video played from there). */
  offset?: number;
  /** Clean up a home recording: cut rumble and steady background noise, even out the level. */
  cleanup?: boolean;
}

/** Voice clean-up for home recordings: rumble below 80 Hz, steady noise, a gentle compressor, broadcast loudness. */
/** A hard ceiling at about −1.5 dBFS after loudness normalising: one-pass loudnorm can let a sudden loud word overshoot. */
const CEILING = `aresample=${SR},alimiter=limit=0.84:level=0:attack=1:release=50`;
export const VOICE_CLEANUP = "highpass=f=80,afftdn=nf=-25,acompressor=threshold=-20dB:ratio=3:attack=10:release=200,loudnorm=I=-16:TP=-1.5";

/** Caption style for libass: Poppins Bold, white with a black outline, low in the frame. */
const captionStyle = (portrait: boolean) =>
  `FontName=Poppins,Bold=1,Fontsize=${portrait ? 15 : 18},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2.2,Shadow=0,Alignment=2,MarginV=${portrait ? 46 : 24}`;

/**
 * Voice to video: puts a voice on a video (a recording, or a script in any voice), replacing its sound or ducking
 * it under the voice, with optional burned-in captions (timed by Whisper) and lip sync. If the voice runs longer
 * than the video, the picture loops to the end of the voice.
 */
export async function voiceToVideo(userId: string, o: VoiceToVideoOptions, deps: { hear?: (file: string) => Promise<TimedText[]>; speak?: typeof voiceWav } = {}): Promise<MediaItem> {
  const v = await media(o.videoId, ["video"], "a video");
  return tmp(async (dir) => {
    let src = await toFile(v, dir, "src");
    let voice = path.join(dir, "voice.wav");
    if ("mediaId" in o.voice) {
      const a = await media(o.voice.mediaId, ["audio", "video"], "the recording");
      await ff(["-i", await toFile(a, dir, "rec"), "-vn", "-ac", "1", "-ar", String(SR), voice]);
    } else await fs.writeFile(voice, await (deps.speak ?? voiceWav)(o.voice.text, o.voice.choice));
    const vSecs = await duration(src);
    if ((await duration(voice)) < 0.3) throw new Error("The voice is empty.");
    // One voice track that starts where it was spoken (silence before it) and, if asked, cleaned up: lip sync,
    // captions and the length then all follow it as they are.
    const offset = Math.min(Math.max(0, Number(o.offset) || 0), vSecs);
    if (offset > 0 || o.cleanup) {
      const placed = path.join(dir, "placed.wav");
      const af = [o.cleanup ? VOICE_CLEANUP : "", offset > 0 ? `adelay=${Math.round(offset * 1000)}:all=1` : ""].filter(Boolean).join(",");
      await ff(["-i", voice, "-af", af, "-ac", "1", "-ar", String(SR), placed]);
      voice = placed;
    }
    const aSecs = await duration(voice);
    const hadSound = !!(await probe(src, "stream=index", "a"));
    if (o.lipsync) {
      const synced = path.join(dir, "synced.mp4");
      await fs.writeFile(synced, await ownLipsync({ video: await fs.readFile(src), audio: await fs.readFile(voice) }));
      src = synced;
    }
    const total = o.lipsync ? await duration(src) : Math.max(vSecs, aSecs + 0.4);
    const [w, h] = (await probe(src, "stream=width,height", "v:0")).split(",").map(Number);
    const filters: string[] = [];
    let vf = "[0:v]setpts=PTS-STARTPTS";
    if (o.captions) {
      const lines = deps.hear ? await deps.hear(voice) : await (await import("./transcribe")).transcribe(voice);
      const srt = path.join(dir, "captions.srt");
      await fs.writeFile(srt, toSrt(captionLines(lines.filter((l) => l.text.trim()), h > w ? 28 : 42)));
      const fonts = path.join(process.cwd(), "assets", "fonts");
      vf += `,subtitles=filename=${srt}:fontsdir=${fonts}:force_style='${captionStyle(h > w)}'`;
    }
    filters.push(`${vf},format=yuv420p[v]`);
    // The original sound only when it should stay (duck) and the picture wasn't replaced by lip sync's own track.
    if (o.mix === "duck" && hadSound) {
      filters.push(`[2:a]aresample=${SR},apad,asplit=2[vo][sc]`, `[1:a]aresample=${SR},volume=0.9[bg0]`, `[bg0][sc]sidechaincompress=threshold=0.015:ratio=10:attack=15:release=450:makeup=1[bg]`, `[bg][vo]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-14:TP=-1.5,${CEILING}[a]`);
    } else filters.push(`[2:a]aresample=${SR},apad,loudnorm=I=-14:TP=-1.5,${CEILING}[a]`);
    const out = path.join(dir, "out.mp4");
    await ff([
      "-stream_loop", "-1", "-i", src,
      ...(hadSound ? ["-stream_loop", "-1", "-i", path.join(dir, `src.${v.storagePath.split(".").pop()}`)] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono"]),
      "-i", voice,
      "-filter_complex", filters.join(";"),
      "-map", "[v]", "-map", "[a]", "-t", total.toFixed(3),
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-ar", String(SR), "-movflags", "+faststart", out,
    ]);
    return storeFile(userId, { name: `voiced-${slug(v.name)}.mp4`, type: "video/mp4", bytes: await fs.readFile(out) }, { uncapped: true });
  });
}

/** Credits for voice to video: the voice (when it's typed), plus lip sync by the second. Captions and mixing are free. */
export function voiceToVideoCredits(o: VoiceToVideoOptions, voiceSeconds: number) {
  const words = "text" in o.voice ? voiceCredits(stripTags(o.voice.text).length, o.voice.choice) : 0;
  return words + (o.lipsync ? CREDIT_COST.lipsyncSecond * Math.max(1, Math.ceil(voiceSeconds)) : 0);
}
