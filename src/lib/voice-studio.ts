import "server-only";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { db } from "./db";
import { SPEECH_LANGUAGES } from "./languages";
import { claudeJson } from "./llm";
import { readFile, storeFile } from "./media";
import { ownClip, ownLipsync, ownSpeech, ownVoiceConvert } from "./own-video";
import { runCmd } from "./render";
import { parseScript } from "./speech-text";
import type { MediaItem } from "./types";
import { voiceSample } from "./voices";

/**
 * The voice tools in AI Studio, on Ghost Post's own engine: voiceovers in 23 languages (in a stock voice or one of
 * My Voices), voice-to-voice, dubbing a video into another language, lip sync, and avatars (a picture that speaks).
 * Every result is saved to the Media Library.
 */
export const SR = 48000;

async function tmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ghost-post-vs-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
const ff = (args: string[], ms = 10 * 60_000) => runCmd("ffmpeg", ["-hide_banner", "-y", ...args], ms);

/** Any audio (or a video's sound) as mono float samples at 48 kHz. */
export async function pcm(file: string): Promise<Float32Array> {
  const raw = `${file}.f32`;
  await ff(["-i", file, "-vn", "-ac", "1", "-ar", String(SR), "-f", "f32le", raw]);
  const b = await fs.readFile(raw);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + Math.floor(b.length / 4) * 4));
}

/** Writes mono float samples as a 16-bit WAV. */
export function wavBytes(x: Float32Array, sr = SR): Buffer {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + x.length * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  return b;
}

/** Splits text at sentence ends into parts the engine reads in one go. */
export function chunks(text: string, max = 600): string[] {
  const out: string[] = [];
  let cur = "";
  for (const s of text.trim().split(/(?<=[.!?…。！？])\s*/)) {
    if (!s) continue;
    if (cur && (cur + " " + s).length > max) {
      out.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
    while (cur.length > max) {
      const cut = cur.lastIndexOf(" ", max) > max / 2 ? cur.lastIndexOf(" ", max) : max;
      out.push(cur.slice(0, cut));
      cur = cur.slice(cut).trim();
    }
  }
  if (cur) out.push(cur);
  return out;
}

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
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "audio";

/**
 * Text read by the engine in any of its languages, in one of My Voices (or its own stock voice). Mono WAV, 48 kHz.
 * Emotion tags in the text ("[whispers]", "[excited]", "[pause]"; see EMOTION_TAGS) change how the words after them
 * are read.
 */
export async function speak(text: string, language: string, voiceId?: string): Promise<Buffer> {
  if (!(language in SPEECH_LANGUAGES)) throw new Error("Choose a language.");
  const voice = voiceId ? await voiceSample(voiceId) : undefined;
  return tmp(async (dir) => {
    const parts: Float32Array[] = [];
    let n = 0;
    for (const part of parseScript(text)) {
      if (part.pause) parts.push(new Float32Array(Math.round(SR * part.pause)));
      for (const c of part.text ? chunks(part.text) : []) {
        const f = path.join(dir, `p${n++}.wav`);
        await fs.writeFile(f, await ownSpeech({ text: c, language, voice, exaggeration: part.exaggeration, cfg: part.cfg }));
        const x = await pcm(f);
        if (part.gain !== 1) for (let i = 0; i < x.length; i++) x[i] *= part.gain;
        parts.push(x, new Float32Array(Math.round(SR * 0.25)));
      }
    }
    if (!n) throw new Error("Type what the voice should say.");
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return wavBytes(out);
  });
}

async function mp3(wav: Buffer) {
  return tmp(async (dir) => {
    await fs.writeFile(path.join(dir, "a.wav"), wav);
    await ff(["-i", path.join(dir, "a.wav"), "-af", "loudnorm=I=-16:TP=-1.5", "-codec:a", "libmp3lame", "-b:a", "192k", path.join(dir, "a.mp3")]);
    return fs.readFile(path.join(dir, "a.mp3"));
  });
}

export async function makeSpeech(userId: string, o: { text: string; language: string; voiceId?: string }): Promise<MediaItem> {
  const audio = await mp3(await speak(o.text, o.language, o.voiceId));
  return storeFile(userId, { name: `voiceover-${o.language}-${slug(o.text.split(/\s+/).slice(0, 6).join(" "))}.mp3`, type: "audio/mpeg", bytes: audio });
}

/** Voice-to-voice: the same delivery in another of My Voices. A video keeps its picture with the new voice. */
export async function changeVoice(userId: string, o: { mediaId: string; voiceId: string }): Promise<MediaItem> {
  const m = await media(o.mediaId, ["audio", "video"], "a recording or video");
  const voice = await voiceSample(o.voiceId);
  return tmp(async (dir) => {
    const src = await toFile(m, dir, "src");
    const wav = path.join(dir, "pcm.wav");
    await ff(["-i", src, "-vn", "-ac", "1", "-ar", "24000", wav]);
    const conv = path.join(dir, "conv.wav");
    await fs.writeFile(conv, await ownVoiceConvert({ source: await fs.readFile(wav), voice }));
    if (m.kind === "video") {
      const out = path.join(dir, "out.mp4");
      await ff(["-i", src, "-i", conv, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out]);
      return storeFile(userId, { name: `voice-changed-${slug(m.name)}.mp4`, type: "video/mp4", bytes: await fs.readFile(out) }, { uncapped: true });
    }
    return storeFile(userId, { name: `voice-changed-${slug(m.name)}.mp3`, type: "audio/mpeg", bytes: await mp3(await fs.readFile(conv)) });
  });
}

export interface DubOptions {
  mediaId: string;
  language: string;
  /** "original": copy the speaker in the video (needs `rightsConfirmed`); otherwise one of My Voices. */
  voice: "original" | string;
  rightsConfirmed?: boolean;
  /** Keep the video's own sound quietly under the new voice (music and effects, and the original voice faintly). */
  keepBackground: boolean;
  lipsync: boolean;
}

type Line = { start: number; end: number | null; text: string };

/** Puts each spoken line at its start time, speeding a line up (to 1.35×) when it would run into the next one. */
export function placeLines(lines: { start: number; samples: Float32Array }[], total: number, maxSpeed = 1.35) {
  const out = new Float32Array(Math.ceil(total * SR));
  let cursor = 0;
  const speeds: number[] = [];
  lines.forEach((l, i) => {
    const next = lines[i + 1]?.start ?? total;
    const slot = Math.max(0.3, next - l.start) * SR;
    const speed = Math.min(maxSpeed, Math.max(1, l.samples.length / slot));
    speeds.push(Math.round(speed * 100) / 100);
    const n = Math.floor(l.samples.length / speed);
    let at = Math.max(Math.round(l.start * SR), cursor);
    if (at + n > out.length) at = Math.max(0, out.length - n);
    for (let j = 0; j < n && at + j < out.length; j++) {
      // Linear resampling: plays the line `speed` times faster (pitch rises a little, under 6% at the limit).
      const p = j * speed;
      const k = Math.floor(p);
      const f = p - k;
      out[at + j] += (l.samples[k] ?? 0) * (1 - f) + (l.samples[k + 1] ?? 0) * f;
    }
    cursor = at + n;
  });
  return { track: out, speeds };
}

/**
 * Dubs a video (or a recording) into another language: Ghost Post's Whisper hears each line with its timing, the
 * writer translates the lines, the engine speaks each one in the chosen voice at the same moment, and (optionally)
 * the mouth is lip-synced to the new words.
 */
export async function dub(userId: string, o: DubOptions, deps: { hear?: (file: string) => Promise<Line[]> } = {}): Promise<MediaItem> {
  if (!(o.language in SPEECH_LANGUAGES)) throw new Error("Choose the language to dub into.");
  if (o.voice === "original" && !o.rightsConfirmed) throw new Error("Confirm that you are the speaker in this video or have their written permission to copy their voice.");
  const m = await media(o.mediaId, ["video", "audio"], "a video or recording");
  return tmp(async (dir) => {
    const src = await toFile(m, dir, "src");
    const sound = path.join(dir, "sound.wav");
    await ff(["-i", src, "-vn", "-ac", "1", "-ar", "16000", sound]);
    const total = (await pcm(sound)).length / SR;
    const lines = (deps.hear ? await deps.hear(sound) : await (await import("./transcribe")).transcribe(sound)).filter((l) => l.text.trim());
    if (!lines.length) throw new Error("No speech was heard in that file.");
    const target = SPEECH_LANGUAGES[o.language];
    const said = await claudeJson<{ lines: string[] }>({
      system: "You translate film dialogue for dubbing. Keep each line natural, about as long to say as the original, and keep names unchanged. Answer with JSON only.",
      user: `Translate each line into ${target}. Return exactly ${lines.length} lines in the same order.\n\n${JSON.stringify(lines.map((l) => l.text.trim()))}\n\nJSON: {"lines": ["..."]}`,
      maxTokens: 4000,
      temperature: 0.3,
    });
    if (!Array.isArray(said.lines) || said.lines.length !== lines.length) throw new Error("The translation came back with the wrong number of lines. Please try again.");
    // The voice: a stretch of the speaker's own speech (up to 15 s), or one of My Voices.
    let voice: Buffer;
    if (o.voice === "original") {
      const ref = path.join(dir, "ref.wav");
      const from = lines[0].start;
      await ff(["-ss", String(from), "-i", sound, "-t", "15", "-ar", "24000", ref]);
      voice = await fs.readFile(ref);
    } else voice = await voiceSample(o.voice);
    const spoken: { start: number; samples: Float32Array }[] = [];
    for (const [i, l] of lines.entries()) {
      const text = String(said.lines[i] ?? "").trim();
      if (!text) continue;
      const f = path.join(dir, `l${i}.wav`);
      await fs.writeFile(f, await ownSpeech({ text, language: o.language, voice }));
      spoken.push({ start: l.start, samples: await pcm(f) });
    }
    const { track } = placeLines(spoken, total);
    if (o.keepBackground) {
      const bg = await pcm(src);
      for (let i = 0; i < track.length && i < bg.length; i++) track[i] += bg[i] * 0.12;
    }
    const newSound = path.join(dir, "dub.wav");
    await fs.writeFile(newSound, wavBytes(track));
    const name = `dub-${o.language}-${slug(m.name)}`;
    if (m.kind === "audio") return storeFile(userId, { name: `${name}.mp3`, type: "audio/mpeg", bytes: await mp3(await fs.readFile(newSound)) });
    let video: Buffer;
    if (o.lipsync) video = await ownLipsync({ video: await fs.readFile(src), audio: await fs.readFile(newSound) });
    else {
      const out = path.join(dir, "out.mp4");
      await ff(["-i", src, "-i", newSound, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out]);
      video = await fs.readFile(out);
    }
    return storeFile(userId, { name: `${name}.mp4`, type: "video/mp4", bytes: video }, { uncapped: true });
  });
}

/** Lip sync: the face in a video mouths a recording (the video loops if it's shorter). */
export async function lipSync(userId: string, o: { videoId: string; audioId: string }): Promise<MediaItem> {
  const v = await media(o.videoId, ["video"], "a video with a face in it");
  const a = await media(o.audioId, ["audio", "video"], "the speech (a recording)");
  const out = await ownLipsync({ video: await readFile(v), audio: await readFile(a) });
  return storeFile(userId, { name: `lipsync-${slug(v.name)}.mp4`, type: "video/mp4", bytes: out }, { uncapped: true });
}

export const AVATAR_MOTION =
  "The person looks into the camera and talks naturally, with small head movements, blinking and relaxed expressions. Steady camera, same framing, same lighting.";

/** Avatar: a picture of a person brought to life by the video engine, then lip-synced to the speech. */
export async function makeAvatar(userId: string, o: { pictureId: string; aspect: string; audio: { mediaId: string } | { text: string; language: string; voiceId?: string }; direction?: string }): Promise<MediaItem> {
  const pic = await media(o.pictureId, ["image"], "a picture of a person (face clearly visible)");
  const speech = "mediaId" in o.audio ? await readFile(await media(o.audio.mediaId, ["audio"], "a recording")) : await speak(o.audio.text, o.audio.language, o.audio.voiceId);
  const clip = await ownClip({ prompt: [AVATAR_MOTION, o.direction?.trim()].filter(Boolean).join(" "), start: { bytes: await readFile(pic), mime: pic.type }, aspect: o.aspect, seconds: 5 });
  const out = await ownLipsync({ video: clip, audio: speech });
  return storeFile(userId, { name: `avatar-${slug(pic.name)}.mp4`, type: "video/mp4", bytes: out }, { uncapped: true });
}

/** Seconds of sound in a Media Library file (for pricing). */
export async function mediaSeconds(id: string): Promise<number> {
  const m = await db().get<MediaItem>("media", id);
  if (!m) throw new Error("That file wasn't found in your Media Library.");
  return tmp(async (dir) => {
    const f = await toFile(m, dir, "f");
    return Number((await runCmd("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], 60_000)).trim()) || 0;
  });
}
