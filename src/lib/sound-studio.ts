import "server-only";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { db } from "./db";
import { claude, claudeJson } from "./llm";
import { addAsset, type LibraryAsset } from "./library";
import { FOOTAGE_CATEGORIES, GENRES, INSTRUMENTS, MOODS, pickTags, SFX_CATEGORIES, tagsInText, THEMES, type AssetKind } from "./library-tags";
import { readFile, storeFile } from "./media";
import { ENGINE_CLIP_SECONDS, ownAudio, ownClip } from "./own-video";
import { runCmd } from "./render";
import { stripTags } from "./speech-text";
import type { MediaItem } from "./types";
import { nowIso, uid } from "./utils";

/**
 * The AI generators behind the Library: music (ACE-Step 1.5), sound effects (MOSS-SoundEffect v2) and footage
 * (Wan 2.2), all on Ghost Post's own engine. Each result is filed in the person's library with a title, tags, a
 * waveform and a browser-friendly preview, ready to search, save to boards and download with the license.
 */
export const MUSIC_MODEL = "ACE-Step 1.5";
export const SFX_MODEL = "MOSS-SoundEffect v2";
export const FOOTAGE_MODEL = "Wan 2.2";
export const MUSIC_SECONDS = { min: 10, max: 240 };
export const SFX_SECONDS = { min: 0.5, max: 30 };

export interface MusicInput {
  prompt: string;
  /** Sung lyrics; without them the track is instrumental. */
  lyrics?: string;
  seconds: number;
  bpm?: number;
  key?: string;
  /** Chosen in the form; the writer adds the rest. */
  genres?: string[];
  moods?: string[];
}
export interface SfxInput {
  prompt: string;
  seconds: number;
  category?: string;
}
export interface FootageInput {
  prompt: string;
  aspect: string;
  seconds: number;
  /** A picture from the person's Media Library to start from. */
  startMediaId?: string;
  category?: string;
}

async function tmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ghost-post-sound-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Length, waveform outline (n values 0..1) and an MP3 for the browser, from any audio file. */
export async function analyseAudio(bytes: Buffer, n = 120): Promise<{ seconds: number; peaks: number[]; mp3: Buffer }> {
  return tmp(async (dir) => {
    const src = path.join(dir, "in.wav");
    await fs.writeFile(src, bytes);
    const raw = path.join(dir, "env.f32");
    const mp3 = path.join(dir, "preview.mp3");
    await runCmd("ffmpeg", ["-hide_banner", "-y", "-i", src, "-ac", "1", "-ar", "8000", "-f", "f32le", raw], 5 * 60_000);
    await runCmd("ffmpeg", ["-hide_banner", "-y", "-i", src, "-codec:a", "libmp3lame", "-b:a", "192k", mp3], 5 * 60_000);
    const buf = await fs.readFile(raw);
    const x = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
    const seconds = x.length / 8000;
    const per = Math.max(1, Math.floor(x.length / n));
    const peaks: number[] = [];
    for (let i = 0; i < n && i * per < x.length; i++) {
      let m = 0;
      for (let j = i * per; j < Math.min(x.length, (i + 1) * per); j++) m = Math.max(m, Math.abs(x[j]));
      peaks.push(m);
    }
    const top = Math.max(1e-6, ...peaks);
    return { seconds: Math.round(seconds * 100) / 100, peaks: peaks.map((p) => Math.round((p / top) * 100) / 100), mp3: await fs.readFile(mp3) };
  });
}

/** A short title from the start of the prompt, for when no writer is available: "Smooth slow R&B". */
export function titleFrom(prompt: string) {
  const words = prompt.replace(/[^\w\s'&-]/g, " ").split(/\s+/).filter(Boolean);
  const stop = new Set(["with", "and", "a", "an", "the", "of", "in", "on", "for", "to", "at"]);
  let end = Math.min(words.length, 4);
  while (end > 1 && stop.has(words[end - 1].toLowerCase())) end--;
  return words.slice(0, end).map((w, i) => (i === 0 || !stop.has(w.toLowerCase()) ? w[0].toUpperCase() + w.slice(1) : w)).join(" ").slice(0, 60) || "Untitled";
}

type Filing = { title: string; genres: string[]; moods: string[]; themes: string[]; instruments: string[]; category?: string };

/** A title and tags from the Library's lists, written from the prompt; plain keyword matching if no writer answers. */
export async function fileAsset(kind: AssetKind, prompt: string, chosen: Partial<Filing> = {}): Promise<Filing> {
  const fallback: Filing = {
    title: titleFrom(prompt),
    genres: chosen.genres?.length ? chosen.genres : kind === "music" ? tagsInText(GENRES, prompt) : [],
    moods: chosen.moods?.length ? chosen.moods : kind === "sfx" ? [] : tagsInText(MOODS, prompt),
    themes: tagsInText(THEMES, prompt),
    instruments: kind === "music" ? tagsInText(INSTRUMENTS, prompt) : [],
    category: chosen.category || (kind === "sfx" ? tagsInText(SFX_CATEGORIES, prompt, 1)[0] : kind === "footage" ? tagsInText(FOOTAGE_CATEGORIES, prompt, 1)[0] : undefined),
  };
  const lists =
    kind === "music"
      ? `genres (1-3) from: ${GENRES.join(", ")}\nmoods (1-3) from: ${MOODS.join(", ")}\nthemes (1-3, the kinds of video it suits) from: ${THEMES.join(", ")}\ninstruments (1-4) from: ${INSTRUMENTS.join(", ")}`
      : kind === "sfx"
        ? `category (exactly one) from: ${SFX_CATEGORIES.join(", ")}\nthemes (0-2) from: ${THEMES.join(", ")}`
        : `category (exactly one) from: ${FOOTAGE_CATEGORIES.join(", ")}\nmoods (0-2) from: ${MOODS.join(", ")}\nthemes (1-2) from: ${THEMES.join(", ")}`;
  try {
    const r = await claudeJson<Record<string, unknown>>({
      system: "You file stock media in a library. Answer with JSON only.",
      user: `A ${kind === "sfx" ? "sound effect" : kind === "music" ? "music track" : "video clip"} was made from this description:\n"${prompt.slice(0, 600)}"\n\nGive it a short evocative title (2-4 words, no quotes, no artist names) and tags, using only these lists:\n${lists}\n\nJSON: {"title": "...", "genres": [], "moods": [], "themes": [], "instruments": [], "category": "..."}`,
      maxTokens: 300,
      temperature: 0.4,
    });
    const cat = kind === "music" ? undefined : pickTags(kind === "sfx" ? SFX_CATEGORIES : FOOTAGE_CATEGORIES, [r.category], 1)[0];
    // Anything the writer left out (or answered off the lists) is filled from the prompt's own words.
    const or = (a: string[], b: string[]) => (a.length ? a : b);
    return {
      title: String(r.title ?? "").replace(/["“”]/g, "").trim().slice(0, 60) || fallback.title,
      genres: chosen.genres?.length ? chosen.genres : or(pickTags(GENRES, r.genres, 3), fallback.genres),
      moods: chosen.moods?.length ? chosen.moods : or(pickTags(MOODS, r.moods, 3), fallback.moods),
      themes: or(pickTags(THEMES, r.themes, 3), fallback.themes),
      instruments: kind === "music" ? or(pickTags(INSTRUMENTS, r.instruments, 4), fallback.instruments) : [],
      category: chosen.category || cat || fallback.category,
    };
  } catch {
    return fallback;
  }
}

/** Turns a short idea into a detailed prompt for the generator (Artlist's Auto-Prompt). */
export async function autoPrompt(kind: AssetKind | "image", idea: string): Promise<string> {
  const how: Record<AssetKind | "image", string> = {
    music: "a music generator. Describe genre, mood, tempo feel, lead and supporting instruments, arrangement (intro, build, drop or chorus, outro) and production style in one paragraph under 70 words. No artist or song names.",
    sfx: "a sound-effect generator. Name the sound concretely, its texture, pitch and attack, and the space it is in (close-mic, distant, small room, outdoors) in one sentence under 25 words. No visual words.",
    footage: "a video generator. Describe the subject, action, setting, lighting, lens and camera move in one paragraph under 60 words, cinematic and photorealistic.",
    image: "an image generator. Describe subject, setting, composition, lighting, lens and style in one paragraph under 60 words.",
  };
  const text = await claude({ system: `You write prompts for ${how[kind]} Reply with the prompt only.`, user: idea.slice(0, 500), maxTokens: 200, temperature: 0.8 });
  return text.replace(/^["'\s]+|["'\s]+$/g, "").slice(0, 500);
}

function asset(kind: AssetKind, owner: string, f: Filing, extra: Partial<LibraryAsset> & Pick<LibraryAsset, "mediaId" | "previewId" | "seconds" | "peaks" | "model" | "description">): LibraryAsset {
  return { id: uid("aud"), kind, owner, title: f.title, genres: f.genres, moods: f.moods, themes: f.themes, instruments: f.instruments, category: f.category, downloads: 0, createdAt: nowIso(), ...extra };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "untitled";

export async function makeMusic(userId: string, o: MusicInput): Promise<LibraryAsset> {
  const lyrics = o.lyrics?.trim() ?? "";
  const seconds = Math.max(MUSIC_SECONDS.min, Math.min(MUSIC_SECONDS.max, Math.round(o.seconds)));
  const style = [o.genres?.join(", "), o.moods?.join(", ")].filter(Boolean).join("; ");
  const prompt = [o.prompt.trim(), style].filter(Boolean).join(". ");
  const [made, filing] = await Promise.all([
    ownAudio({ kind: "music", prompt, lyrics, instrumental: !lyrics, seconds, bpm: o.bpm, key: o.key }),
    fileAsset("music", prompt, { genres: o.genres, moods: o.moods }),
  ]);
  const a = await analyseAudio(made.wav);
  const wav = await storeFile(userId, { name: `music-${slug(filing.title)}.wav`, type: "audio/wav", bytes: made.wav }, { uncapped: true });
  const mp3 = await storeFile(userId, { name: `music-${slug(filing.title)}.mp3`, type: "audio/mpeg", bytes: a.mp3 }, { uncapped: true });
  return addAsset(asset("music", userId, filing, {
    mediaId: wav.id, previewId: mp3.id, seconds: a.seconds, peaks: a.peaks, model: MUSIC_MODEL, description: o.prompt.trim().slice(0, 500),
    bpm: made.bpm ?? o.bpm, key: made.key ?? o.key, vocals: !!lyrics, lyrics: lyrics || undefined,
  }));
}

export async function makeSfx(userId: string, o: SfxInput): Promise<LibraryAsset> {
  const seconds = Math.max(SFX_SECONDS.min, Math.min(SFX_SECONDS.max, Math.round(o.seconds * 10) / 10));
  const [made, filing] = await Promise.all([ownAudio({ kind: "sfx", prompt: o.prompt.trim(), seconds }), fileAsset("sfx", o.prompt, { category: o.category })]);
  const a = await analyseAudio(made.wav);
  const wav = await storeFile(userId, { name: `sfx-${slug(filing.title)}.wav`, type: "audio/wav", bytes: made.wav }, { uncapped: true });
  const mp3 = await storeFile(userId, { name: `sfx-${slug(filing.title)}.mp3`, type: "audio/mpeg", bytes: a.mp3 }, { uncapped: true });
  return addAsset(asset("sfx", userId, filing, { mediaId: wav.id, previewId: mp3.id, seconds: a.seconds, peaks: a.peaks, model: SFX_MODEL, description: o.prompt.trim().slice(0, 500) }));
}

export async function makeFootage(userId: string, o: FootageInput): Promise<LibraryAsset> {
  let start: { bytes: Buffer; mime: string } | undefined;
  if (o.startMediaId) {
    const m = await db().get<MediaItem>("media", o.startMediaId);
    if (!m || m.kind !== "image") throw new Error("That starting picture wasn't found in your Media Library.");
    start = { bytes: await readFile(m), mime: m.type };
  }
  const seconds = Math.max(1, Math.min(ENGINE_CLIP_SECONDS, o.seconds));
  const [mp4, filing] = await Promise.all([ownClip({ prompt: o.prompt.trim(), start, aspect: o.aspect, seconds }), fileAsset("footage", o.prompt, { category: o.category })]);
  const poster = await tmp(async (dir) => {
    await fs.writeFile(path.join(dir, "c.mp4"), mp4);
    await runCmd("ffmpeg", ["-hide_banner", "-y", "-ss", "1", "-i", path.join(dir, "c.mp4"), "-frames:v", "1", "-vf", "scale=480:-2", path.join(dir, "p.jpg")], 60_000);
    return fs.readFile(path.join(dir, "p.jpg"));
  });
  const clip = await storeFile(userId, { name: `footage-${slug(filing.title)}.mp4`, type: "video/mp4", bytes: mp4 }, { uncapped: true });
  const still = await storeFile(userId, { name: `footage-${slug(filing.title)}.jpg`, type: "image/jpeg", bytes: poster }, { uncapped: true });
  return addAsset(asset("footage", userId, filing, {
    mediaId: clip.id, previewId: clip.id, posterId: still.id, seconds, peaks: [], model: FOOTAGE_MODEL, description: o.prompt.trim().slice(0, 500), aspect: o.aspect,
  }));
}

/** AI Voiceover: up to 5,000 characters read by one of the free Kokoro voices, saved to the Media Library as an MP3. */
export const VOICE_MAX_CHARS = 5000;
export async function makeVoiceover(userId: string, o: { text: string; voice: string; speed?: number }): Promise<MediaItem> {
  const { freeVoice } = await import("./free-voice");
  // Kokoro can't act emotion tags ("[whispers]"), so they're taken out rather than read aloud.
  const text = stripTags(o.text).slice(0, VOICE_MAX_CHARS);
  // Kokoro reads up to about 2,000 characters at a time: split at sentence ends and join the parts.
  const parts: string[] = [];
  let cur = "";
  for (const s of text.split(/(?<=[.!?…])\s+/)) {
    if ((cur + " " + s).length > 900 && cur) {
      parts.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) parts.push(cur.slice(0, 2000));
  const mp3 = await tmp(async (dir) => {
    const files: string[] = [];
    for (const [i, p] of parts.entries()) {
      const f = path.join(dir, `p${i}.wav`);
      await freeVoice(p, f, undefined, { voice: o.voice, speed: o.speed });
      files.push(f);
    }
    await fs.writeFile(path.join(dir, "list.txt"), files.map((f) => `file '${f}'`).join("\n"));
    await runCmd("ffmpeg", ["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"), "-af", "loudnorm=I=-16:TP=-1.5", "-codec:a", "libmp3lame", "-b:a", "192k", path.join(dir, "out.mp3")], 5 * 60_000);
    return fs.readFile(path.join(dir, "out.mp3"));
  });
  return storeFile(userId, { name: `voiceover-${slug(text.split(/\s+/).slice(0, 6).join(" "))}.mp3`, type: "audio/mpeg", bytes: mp3 });
}
