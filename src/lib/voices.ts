import "server-only";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { db } from "./db";
import { readFile, storeFile } from "./media";
import { runCmd } from "./render";
import { kvGet, kvSet } from "./repo";
import type { MediaItem } from "./types";
import { nowIso, uid } from "./utils";

/**
 * My Voices: voice cloning with consent. A voice is made from a 10–60 second recording that starts with the speaker
 * saying the consent sentence below; Ghost Post transcribes it on its own server and only accepts the voice when the
 * sentence is heard, so nobody can clone a voice from a clip found online. The engine (Chatterbox, which watermarks
 * everything it makes) then speaks in that voice in 23 languages: voiceovers, voice-to-voice and dubbing.
 */
export const CONSENT_SENTENCE = "I agree to Ghost Post making an AI voice from my recording.";
const ROW = "voices";
export const MAX_VOICES = 20;

export interface MyVoice {
  id: string;
  name: string;
  /** The reference the engine copies (mono WAV, at most 20 seconds, after the consent sentence when it's long enough). */
  sampleId: string;
  consent: { by: string; statement: string; heard: string; at: string };
  createdAt: string;
}

export const listVoices = async () => (await kvGet<MyVoice[]>(ROW)) ?? [];

/** How much of the consent sentence is in the transcript (0..1), ignoring case, punctuation and small words. */
export function consentScore(transcript: string) {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const want = words(CONSENT_SENTENCE);
  const heard = new Set(words(transcript).slice(0, 40));
  return want.filter((w) => heard.has(w)).length / want.length;
}

async function tmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ghost-post-voice-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const seconds = async (file: string) =>
  Number((await runCmd("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], 60_000)).trim()) || 0;

export async function createVoice(userId: string, o: { name: string; mediaId: string; consentBy: string; agreed: boolean }, hear?: (file: string) => Promise<string>): Promise<MyVoice> {
  const name = o.name.trim().slice(0, 40);
  if (!name) throw new Error("Name the voice.");
  if (!o.agreed || !o.consentBy.trim()) throw new Error("Confirm that this is your own voice (or that the speaker gave written permission) and type your full name.");
  const list = await listVoices();
  if (list.length >= MAX_VOICES) throw new Error(`You can keep up to ${MAX_VOICES} voices.`);
  const m = await db().get<MediaItem>("media", o.mediaId);
  if (!m || (m.kind !== "audio" && m.kind !== "video")) throw new Error("Choose a recording (audio or video) from your Media Library.");
  return tmp(async (dir) => {
    const src = path.join(dir, `in.${m.storagePath.split(".").pop()}`);
    await fs.writeFile(src, await readFile(m));
    const wav = path.join(dir, "all.wav");
    await runCmd("ffmpeg", ["-hide_banner", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "24000", wav], 2 * 60_000);
    const len = await seconds(wav);
    if (len < 10) throw new Error("The recording needs to be at least 10 seconds: the consent sentence, then a few sentences in your normal voice.");
    if (len > 300) throw new Error("Use a recording of up to 5 minutes.");
    const transcript = hear ? await hear(wav) : (await (await import("./transcribe")).transcribe(wav)).map((l) => l.text).join(" ");
    if (consentScore(transcript) < 0.7) {
      throw new Error(`The consent sentence wasn't heard at the start of the recording. Start by saying: “${CONSENT_SENTENCE}”`);
    }
    // The engine copies a voice best from 5–20 seconds of ordinary speech: skip the first 5 s (mostly the sentence) when there's room.
    const ref = path.join(dir, "ref.wav");
    const start = len >= 18 ? 5 : 0;
    await runCmd("ffmpeg", ["-hide_banner", "-y", "-ss", String(start), "-i", wav, "-t", "20", "-af", "loudnorm=I=-18:TP=-2", "-ar", "24000", ref], 60_000);
    const sample = await storeFile(userId, { name: `voice-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.wav`, type: "audio/wav", bytes: await fs.readFile(ref) });
    const v: MyVoice = {
      id: uid("vox"),
      name,
      sampleId: sample.id,
      consent: { by: o.consentBy.trim().slice(0, 80), statement: "This is my own voice, or I have the speaker's written permission to make an AI copy of it.", heard: transcript.slice(0, 300), at: nowIso() },
      createdAt: nowIso(),
    };
    await kvSet(ROW, [v, ...list]);
    return v;
  });
}

export async function deleteVoice(id: string) {
  const list = await listVoices();
  const v = list.find((x) => x.id === id);
  if (!v) throw new Error("That voice wasn't found.");
  await kvSet(ROW, list.filter((x) => x.id !== id));
  const m = await db().get<MediaItem>("media", v.sampleId);
  if (m) await (await import("./media")).deleteFile(m);
}

/** The reference recording for one of the signed-in person's voices. */
export async function voiceSample(id: string): Promise<Buffer> {
  const v = (await listVoices()).find((x) => x.id === id);
  if (!v) throw new Error("That voice wasn't found in My Voices.");
  const m = await db().get<MediaItem>("media", v.sampleId);
  if (!m) throw new Error("That voice's recording is missing.");
  return readFile(m);
}
