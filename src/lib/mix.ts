import "server-only";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { elevenlabsKey } from "./integrations";
import { mediaDuration, runCmd } from "./render";

/**
 * The finished sound of every video: the voice on top, a music bed under it (ducked while someone speaks), a whoosh on
 * every scene change, then compression, a limiter and two-pass loudness to -14 LUFS (what TikTok, Reels and YouTube
 * normalise to). Music and whooshes come from ElevenLabs on the app's key and are cached, so each sound is paid for
 * once; without a key, a quiet drone and a synthesised whoosh are used instead.
 */

const TARGET = "I=-14:TP=-1.5:LRA=11";

/** A loudnorm filter set from a measuring pass, so the result lands on -14 LUFS. */
export async function loudnessFilter(file: string) {
  const m = await new Promise<string>((resolve) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", `loudnorm=${TARGET}:print_format=json`, "-f", "null", "-"]);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", () => resolve(err));
    p.on("error", () => resolve(""));
  });
  const j = m.match(/\{[^{}]*"input_i"[^{}]*\}/)?.[0];
  if (!j) return `loudnorm=${TARGET}`;
  const v = JSON.parse(j) as Record<string, string>;
  return `loudnorm=${TARGET}:measured_I=${v.input_i}:measured_TP=${v.input_tp}:measured_LRA=${v.input_lra}:measured_thresh=${v.input_thresh}:offset=${v.target_offset}:linear=true`;
}

/** The bus that makes a mix loud and even before the loudness pass. */
export const MASTER_CHAIN = "acompressor=threshold=0.08:ratio=3:attack=5:release=150:makeup=2,alimiter=limit=0.8:level=false";

const cacheDir = () => path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "audio-cache");
const exists = (f: string) => fs.access(f).then(() => true, () => false);

/** Music moods a video's "music" note maps to; each is made once and reused. */
export const MOODS: Record<string, string> = {
  tense: "Dark tense cinematic underscore, low pulsing synth bass, ticking percussion, suspense, no vocals",
  upbeat: "Upbeat modern pop beat, bright plucks, punchy drums, positive energy, social media background, no vocals",
  emotional: "Emotional cinematic piano and soft strings, hopeful and moving, no vocals",
  epic: "Epic trailer build, big drums, brass hits, rising strings, no vocals",
  mystery: "Mysterious documentary underscore, plucked strings, airy pads, curious, no vocals",
  chill: "Chill lo-fi hip hop beat, warm keys, soft vinyl crackle, relaxed, no vocals",
};

export function moodFor(note: string, style?: string): keyof typeof MOODS {
  const n = `${note} ${style ?? ""}`.toLowerCase();
  if (/horror|dark|tense|suspense|thriller|crime|drone|ominous|eerie/.test(n)) return "tense";
  if (/epic|trailer|hype|war|battle|action/.test(n)) return "epic";
  if (/sad|emotional|piano|heart|touching|inspir/.test(n)) return "emotional";
  if (/myster|curious|documentary|history|fact/.test(n)) return "mystery";
  if (/chill|lo-?fi|calm|relax/.test(n)) return "chill";
  return style === "fiction" ? "tense" : "upbeat";
}

async function eleven(pathname: string, body: unknown): Promise<Buffer> {
  const key = await elevenlabsKey();
  if (!key) throw new Error("no ElevenLabs key");
  const res = await fetch(`https://api.elevenlabs.io${pathname}`, { method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

/** A cached sound: made once by `make`, or by `fallback` (and not cached) when that fails. */
async function cached(name: string, make: () => Promise<Buffer>, fallback: (file: string) => Promise<void>): Promise<string> {
  await fs.mkdir(cacheDir(), { recursive: true });
  const file = path.join(cacheDir(), `${name}.mp3`);
  if (await exists(file)) return file;
  try {
    const bytes = await make();
    await fs.writeFile(`${file}.part`, bytes);
    await fs.rename(`${file}.part`, file);
    return file;
  } catch (e) {
    console.warn(`[mix] ${name}: ${(e as Error).message.slice(0, 160)}; using a built-in sound`);
    const f = path.join(cacheDir(), `${name}-builtin-${process.pid}.wav`);
    await fallback(f);
    return f;
  }
}

/** A 90-second instrumental bed for the mood (looped under longer videos). */
export function musicBed(mood: keyof typeof MOODS) {
  const key = createHash("sha1").update(MOODS[mood]).digest("hex").slice(0, 8);
  return cached(
    `music-${mood}-${key}`,
    () => eleven("/v1/music?output_format=mp3_44100_128", { prompt: MOODS[mood], music_length_ms: 90_000, force_instrumental: true }),
    (f) => runCmd("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=f=55:d=90", "-f", "lavfi", "-i", "anoisesrc=c=brown:a=0.4:d=90", "-filter_complex", "[0:a]volume=0.2,tremolo=f=0.15:d=0.5[a];[1:a]lowpass=f=220,volume=0.4[b];[a][b]amix=inputs=2:normalize=0", f]).then(() => undefined),
  );
}

/** A short cinematic whoosh for cuts between scenes. */
export function whoosh() {
  return cached(
    "sfx-whoosh-v1",
    () => eleven("/v1/sound-generation?output_format=mp3_44100_128", { text: "Fast clean cinematic whoosh transition, airy swish, no impact", duration_seconds: 1.0, prompt_influence: 0.6 }),
    (f) => runCmd("ffmpeg", ["-y", "-f", "lavfi", "-i", "anoisesrc=c=pink:a=0.6:d=0.7", "-af", "highpass=f=400,lowpass=f=6000,afade=t=in:d=0.35,afade=t=out:st=0.35:d=0.35,volume=0.6", f]).then(() => undefined),
  );
}

/** The filter graph: [0] the video's own audio (voice), [1] music (looped), [2] whoosh; `cuts` are scene starts in seconds. */
export function soundtrackGraph(o: { total: number; cuts: number[]; music: boolean; whoosh: boolean }) {
  const parts: string[] = [`[0:a]aresample=48000,asplit=2[voice][key]`];
  let bed = "";
  if (o.music) {
    parts.push(`[1:a]aresample=48000,atrim=0:${o.total.toFixed(2)},volume=0.30,afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, o.total - 2).toFixed(2)}:d=2[m]`);
    parts.push(`[key]apad[k]`, `[m][k]sidechaincompress=threshold=0.04:ratio=7:attack=15:release=350[bed]`);
    bed = "[bed]";
  } else parts.push(`[key]anullsink`);
  const hits: string[] = [];
  if (o.whoosh) {
    const cuts = o.cuts.filter((c) => c > 0.3 && c < o.total - 0.3);
    if (cuts.length) {
      parts.push(`[2:a]aresample=48000,volume=0.55,asplit=${cuts.length}${cuts.map((_, i) => `[w${i}]`).join("")}`);
      cuts.forEach((c, i) => {
        const ms = Math.max(0, Math.round((c - 0.3) * 1000));
        parts.push(`[w${i}]adelay=${ms}|${ms}[h${i}]`);
        hits.push(`[h${i}]`);
      });
    }
  }
  const inputs = ["[voice]", bed, ...hits].filter(Boolean);
  parts.push(`${inputs.join("")}amix=inputs=${inputs.length}:normalize=0:duration=first,${MASTER_CHAIN}[mix]`);
  return parts.join(";");
}

/** Give a rendered video its music, whooshes and mastering (in place). `cuts`: when each scene starts. */
export async function finishSound(o: { video: string; dir: string; cuts: number[]; musicNote?: string; style?: string; music?: boolean }) {
  const total = await mediaDuration(o.video);
  const music = o.music === false ? null : await musicBed(moodFor(o.musicNote ?? "", o.style)).catch(() => null);
  const swish = await whoosh().catch(() => null);
  const raw = path.join(o.dir, "mix.wav");
  const args = ["-y", "-i", o.video];
  args.push(...(music ? ["-stream_loop", "-1", "-i", music] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]));
  args.push(...(swish ? ["-i", swish] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]));
  await runCmd("ffmpeg", [...args, "-filter_complex", soundtrackGraph({ total, cuts: o.cuts, music: !!music, whoosh: !!swish }), "-map", "[mix]", "-ar", "48000", "-t", total.toFixed(2), raw], 10 * 60_000);
  const out = path.join(o.dir, "sound-finished.mp4");
  await runCmd("ffmpeg", ["-y", "-i", o.video, "-i", raw, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", await loudnessFilter(raw), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", "-movflags", "+faststart", out], 10 * 60_000);
  await fs.rename(out, o.video);
}
