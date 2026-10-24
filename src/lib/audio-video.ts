import "server-only";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { db } from "./db";
import { readFile } from "./media";
import { claudeJson } from "./llm";
import { mediaDuration } from "./render";
import { transcribe } from "./transcribe";
import { audioCuts, lengthForSeconds, MAX_AUDIO_SECONDS, type AudioCut } from "./audio-scenes";
import { videoPost, type RawVideo } from "./video";
import { lengthAllowed, VIDEO_TARGET } from "./video-spec";
import { PLATFORM_SPECS } from "./platforms/specs";
import type { MediaItem, Platform, Post, Settings, VideoVisuals } from "./types";

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export class AudioVideoError extends Error {}

export interface AudioVideoOptions {
  mediaId: string;
  platform: Platform;
  /** 16:9 (YouTube and Facebook only); otherwise vertical 9:16. */
  landscape?: boolean;
  visuals?: VideoVisuals;
  /** What the audio is, in the person's words (optional): helps pick the pictures. */
  about?: string;
  /** Plan without Claude (when it isn't connected or is out of credits): each scene searches stock footage for its own words. */
  plain?: boolean;
}

/** Reads the audio's length and words, before any credits are spent. */
export async function readAudio(mediaId: string) {
  const item = await db().get<MediaItem>("media", mediaId);
  if (!item || (item.kind !== "audio" && item.kind !== "video")) throw new AudioVideoError("Choose an audio file (MP3, WAV or M4A) from your Media Library.");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ghost-post-audio-"));
  try {
    const file = path.join(dir, `in.${item.name.split(".").pop() || "audio"}`);
    await fs.writeFile(file, await readFile(item));
    const total = await mediaDuration(file);
    if (!(total > 1)) throw new AudioVideoError("That file has no audio Ghost Post can read. Try an MP3, WAV or M4A.");
    if (total > MAX_AUDIO_SECONDS + 0.5) throw new AudioVideoError(`That recording is ${clock(total)} long. Audio to video takes up to ${clock(MAX_AUDIO_SECONDS)}: trim it and upload it again.`);
    return { item, total, lines: await transcribe(file) };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Plans a video around the audio: one scene per cut, with pictures that match what is said at that moment. */
export async function planAudioVideo(o: AudioVideoOptions, audio: { item: MediaItem; total: number; cuts: AudioCut[] }, settings: Settings): Promise<Post> {
  const { item, total, cuts } = audio;
  const length = lengthForSeconds(total, !!o.landscape)!;
  const spec = PLATFORM_SPECS[o.platform];
  const spoken = cuts.some((c) => c.text);
  const user = `Plan the pictures for a video made from an existing recording. The recording is the soundtrack exactly as it is: do not change, add to or reorder what is said.
PLATFORM: ${VIDEO_TARGET[o.platform]}. ${length === "long" ? "16:9 landscape." : "Vertical 9:16."}
RECORDING: "${item.name}", ${clock(total)} long.${o.about ? `\nWHAT IT IS (from the creator): ${o.about.slice(0, 500)}` : ""}
${spoken ? "" : "No words were found: it is music or ambient sound. Picture its mood and build.\n"}SCENES (fixed timing, one picture each; "(music)" means no words):
${cuts.map((c, i) => `${i + 1}. ${clock(c.start)}–${clock(c.end)} ${c.text || "(music)"}`).join("\n")}

For EVERY scene, in order, write:
- visual: exactly what is shown, as a short stock-footage search phrase (2–6 concrete words, e.g. "rain on city window at night"). It must match what is said in that scene. No real person's likeness, no logos, no text.
- onScreen: 0–6 punchy words of on-screen text that add to the line (not a copy of it), or "" when the scene doesn't need it.
- motion: the camera move or edit (e.g. "slow push in", "quick cut", "speed ramp").
Also write a title, a caption for ${spec.name} (${o.platform === "x" ? "under 200 characters" : "hook first line, 1–3 short lines"}), 3–5 hashtags without "#", one specific call to action, and a thumbnail.
Reply with ONLY JSON:
{"titles":["3 options, strongest first, under 70 characters"],"caption":"…","hashtags":["…"],"cta":"…","thumbnail":{"text":"2–4 words","prompt":"…"},"scenes":[{"visual":"…","onScreen":"…","motion":"…"}]}`;
  const res: RawVideo = o.plain ? plainExtras(cuts, o.about) : await claudeJson<RawVideo>({
    system: "You are a top video editor. You cut pictures to an existing soundtrack so every shot matches what is heard at that moment. You never invent facts.",
    user,
    maxTokens: Math.min(16000, 1200 + cuts.length * 90),
    temperature: 0.6,
  });
  const planned = Array.isArray(res.scenes) ? res.scenes : [];
  const raw: RawVideo = {
    ...res,
    voice: "The uploaded recording",
    music: "From the recording",
    scenes: cuts.map((c, i) => ({
      time: `${clock(c.start)}–${clock(c.end)}`,
      narration: c.text,
      onScreen: String(planned[i]?.onScreen ?? ""),
      visual: String(planned[i]?.visual || c.text || "atmospheric abstract light"),
      motion: String(planned[i]?.motion ?? ""),
      sfx: "",
    })),
  };
  const post = videoPost(raw, { platform: o.platform, niche: "auto", style: "explainer", length, topic: o.about }, settings);
  post.video!.audio = { mediaId: item.id, cuts: cuts.map((c) => ({ start: c.start, end: c.end })) };
  if (o.visuals) post.video!.visuals = o.visuals;
  return post;
}

/** Title and caption from the recording's own first words, for a plan made without Claude. */
function plainExtras(cuts: AudioCut[], about?: string): RawVideo {
  const said = cuts.map((c) => c.text).filter(Boolean).join(" ");
  const first = (said.match(/^[^.!?]{3,90}[.!?]?/)?.[0] ?? about ?? "").trim();
  return { titles: [first || "New video"], caption: first, hashtags: [], scenes: [] };
}

/** The video length a recording becomes on a platform, or an error message when it doesn't fit there. */
export function audioLengthProblem(total: number, platform: Platform, landscape: boolean): string | null {
  const length = lengthForSeconds(total, landscape);
  if (!length) return `Audio to video takes recordings up to ${clock(MAX_AUDIO_SECONDS)}.`;
  if (lengthAllowed(length, platform)) return null;
  if (length === "long") return "16:9 videos are for YouTube and Facebook. Choose vertical for this platform.";
  return length === "m10" ? "Recordings over 3 minutes become 10-minute videos, which are for TikTok, Facebook and YouTube." : "X allows videos up to 2 minutes 20 seconds; Instagram up to 3 minutes. Trim the recording or pick another platform.";
}
