import "server-only";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { asUser, db } from "./db";
import { readFile, storeFile } from "./media";
import { log, savePost } from "./repo";
import { refundCredits } from "./auth";
import { elevenlabsKey, elevenlabsVoice, pexelsKey } from "./integrations";
import type { MediaItem, Post, VideoScene } from "./types";
import { nowIso } from "./utils";

/**
 * Turns a video plan into a finished MP4 on the server with ffmpeg:
 *  - Voiceover: ElevenLabs text-to-speech per scene (ELEVENLABS_API_KEY). Without a key the video is a
 *    "text story" — captions carry the narration and each scene is timed to a natural reading pace.
 *  - Visuals per scene, in order of preference: the user's attached images/clips, Pexels stock footage
 *    matching the scene's visual note (PEXELS_API_KEY), or a moving brand gradient.
 *  - On-screen text (top) and word-group captions (bottom), burned in with a bundled font.
 * Output: 1080×1920 vertical (Shorts/Reels/TikTok) or 1920×1080 for YouTube long-form, H.264 + AAC, saved to
 * the user's Media Library and attached to the post.
 */

const FPS = 30;
const FONT = path.join(process.cwd(), "assets", "fonts", "Poppins-Bold.ttf");
const DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb"; // ElevenLabs premade narrator voice; override with ELEVENLABS_VOICE_ID
const GRADIENTS: [string, string][] = [
  ["0x141b3a", "0x5b2a86"],
  ["0x0f2a2a", "0x13756f"],
  ["0x2a160c", "0x8a3d16"],
  ["0x101828", "0x2f5288"],
];

let queue: Promise<unknown> = Promise.resolve();

/** Renders one video at a time so a burst of requests can't starve the web server of CPU. */
export function enqueueRender(userId: string, postId: string, credits = 0) {
  queue = queue.then(() => asUser(userId, () => renderVideoPost(userId, postId, credits)).catch(() => {}));
  return queue;
}

function run(cmd: string, args: string[], timeoutMs = 10 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
    p.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(t);
      code === 0 ? resolve(out) : reject(new Error(`${cmd} failed (${code}): ${err.slice(-600)}`));
    });
  });
}

export async function ffmpegAvailable() {
  try {
    await run("ffmpeg", ["-hide_banner", "-version"], 15_000);
    return true;
  } catch {
    return false;
  }
}

async function duration(file: string) {
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], 30_000);
  return Number(out.trim()) || 0;
}

/* ───────────── Voice ───────────── */

async function tts(text: string, file: string) {
  const key = await elevenlabsKey();
  const voice = (await elevenlabsVoice()) || DEFAULT_VOICE;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2" }),
  });
  if (!res.ok) throw new Error(`Voiceover failed (ElevenLabs ${res.status}): ${(await res.text()).slice(0, 200)}`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
}

/* ───────────── Visuals ───────────── */

const cleanQuery = (visual: string) =>
  visual
    .replace(/^(stock|ai image|ai video|image|video|archival[-\s]?style)\s*:\s*/i, "")
    .replace(/["“”]/g, "")
    .replace(/\(.*?\)/g, "")
    .split(/[,.;—-]/)[0]
    .trim()
    .slice(0, 80);

async function pexelsClip(query: string, portrait: boolean, file: string): Promise<boolean> {
  const key = await pexelsKey();
  if (!key || !query) return false;
  try {
    const res = await fetch(
      `https://api.pexels.com/videos/search?${new URLSearchParams({ query, orientation: portrait ? "portrait" : "landscape", size: "medium", per_page: "5" })}`,
      { headers: { Authorization: key } },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { videos?: { video_files: { link: string; width: number; height: number; file_type: string }[] }[] };
    const want = portrait ? 1080 : 1920;
    for (const v of data.videos ?? []) {
      const files = v.video_files
        .filter((f) => f.file_type === "video/mp4" && (portrait ? f.height >= f.width : f.width >= f.height))
        .sort((a, b) => Math.abs((portrait ? a.width : a.width) - want) - Math.abs((portrait ? b.width : b.width) - want));
      const pick = files[0];
      if (!pick) continue;
      const dl = await fetch(pick.link);
      if (!dl.ok) continue;
      const bytes = Buffer.from(await dl.arrayBuffer());
      if (bytes.length > 80 * 1024 * 1024) continue;
      await fs.writeFile(file, bytes);
      return true;
    }
  } catch {
    /* fall through to the next visual source */
  }
  return false;
}

/* ───────────── Text ───────────── */

function wrap(text: string, max: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
}

/** Splits narration into short caption groups (≈6 words) timed by word count. */
function captionGroups(text: string, dur: number) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const groups: string[][] = [];
  for (let i = 0; i < words.length; ) {
    let n = Math.min(6, words.length - i);
    // keep punctuation-ending groups natural: end early on a sentence break
    for (let k = 2; k < n; k++) if (/[.!?…]$/.test(words[i + k - 1])) { n = k; break; }
    groups.push(words.slice(i, i + n));
    i += n;
  }
  const per = dur / words.length;
  let t = 0;
  return groups.map((g) => {
    const start = t;
    t += g.length * per;
    return { text: g.join(" "), start, end: t };
  });
}

/* ───────────── Scene segment ───────────── */

interface SceneJob {
  scene: VideoScene;
  dur: number;
  audio?: string;
  visual: { kind: "image" | "video"; file: string } | { kind: "gradient"; colors: [string, string] };
}

async function renderSegment(job: SceneJob, i: number, dir: string, W: number, H: number): Promise<string> {
  const out = path.join(dir, `seg${String(i).padStart(3, "0")}.mp4`);
  const F = Math.max(1, Math.round(job.dur * FPS));
  const args: string[] = ["-hide_banner", "-y"];

  // Inputs: [0] visual, [1] audio
  const vis = job.visual;
  if (vis.kind === "gradient") args.push("-f", "lavfi", "-t", job.dur.toFixed(3), "-i", `gradients=s=${W}x${H}:c0=${vis.colors[0]}:c1=${vis.colors[1]}:speed=0.015:r=${FPS}`);
  else if (vis.kind === "image") args.push("-i", vis.file);
  else args.push("-stream_loop", "-1", "-t", job.dur.toFixed(3), "-i", vis.file);
  if (job.audio) args.push("-i", job.audio);
  else args.push("-f", "lavfi", "-t", job.dur.toFixed(3), "-i", "anullsrc=r=44100:cl=stereo");

  let v: string;
  if (job.visual.kind === "image") {
    // Slow Ken Burns push-in, alternating direction per scene.
    const zin = i % 2 === 0;
    const z = zin ? `1+0.12*on/${F}` : `1.12-0.12*on/${F}`;
    v = `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${F}:s=${W}x${H}:fps=${FPS}`;
  } else if (job.visual.kind === "video") {
    v = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS}`;
  } else {
    v = `[0:v]format=yuv420p`;
  }
  v += `,eq=brightness=-0.04:saturation=1.08,setsar=1`;

  // Readability band behind captions + on-screen text.
  v += `,drawbox=x=0:y=ih*0.60:w=iw:h=ih*0.28:color=black@0.28:t=fill`;
  const portrait = H > W;
  const writes: Promise<void>[] = [];
  const font = FONT.replace(/:/g, "\\:");
  if (job.scene.onScreen) {
    const f = path.join(dir, `os${i}.txt`);
    await fs.writeFile(f, wrap(job.scene.onScreen.toUpperCase(), portrait ? 16 : 30));
    v += `,drawtext=fontfile='${font}':textfile='${f}':expansion=none:fontsize=${Math.round(W * (portrait ? 0.085 : 0.05))}:fontcolor=white:borderw=${portrait ? 7 : 5}:bordercolor=black:line_spacing=8:text_align=C:x=(w-text_w)/2:y=h*0.11:alpha='min(1,t/0.25)'`;
  }
  captionGroups(job.scene.narration, job.dur).forEach((c, k) => {
    const f = path.join(dir, `cap${i}_${k}.txt`);
    writes.push(fs.writeFile(f, wrap(c.text, portrait ? 22 : 42)));
    v += `,drawtext=fontfile='${font}':textfile='${f}':expansion=none:fontsize=${Math.round(W * (portrait ? 0.06 : 0.036))}:fontcolor=0xFFE14D:borderw=${portrait ? 6 : 4}:bordercolor=black:line_spacing=10:text_align=C:x=(w-text_w)/2:y=h*0.66:enable='between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})'`;
  });
  await Promise.all(writes);
  v += `,fade=t=in:st=0:d=0.15,format=yuv420p[v]`;

  args.push(
    "-filter_complex", `${v};[1:a]aresample=44100,apad,atrim=0:${job.dur.toFixed(3)}[a]`,
    "-map", "[v]", "-map", "[a]",
    "-frames:v", String(F),
    "-c:v", "libx264", "-preset", process.env.RENDER_PRESET || "veryfast", "-crf", "20", "-r", String(FPS), "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2",
    out,
  );
  await run("ffmpeg", args);
  return out;
}

/* ───────────── Main ───────────── */

async function setRender(post: Post, patch: Partial<NonNullable<Post["render"]>>) {
  post.render = { status: "rendering", progress: 0, ...(post.render ?? {}), ...patch, updatedAt: nowIso() };
  await savePost(post);
}

export async function renderVideoPost(userId: string, postId: string, credits = 0) {
  const post = await db().get<Post>("posts", postId);
  if (!post?.video) return;
  const plan = post.video;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-render-"));
  try {
    if (!(await ffmpegAvailable())) throw new Error("Video rendering needs ffmpeg on the server. On Railway set RAILPACK_DEPLOY_APT_PACKAGES=ffmpeg and redeploy.");
    const long = plan.length === "long";
    const [W, H] = long ? [1920, 1080] : [1080, 1920];
    await setRender(post, { status: "rendering", progress: 2, message: "Preparing scenes…" });

    // User media to use as visuals (skip previously rendered outputs).
    const media: MediaItem[] = [];
    for (const id of post.mediaIds ?? []) {
      const m = await db().get<MediaItem>("media", id);
      if (m && !m.rendered && (m.kind === "image" || m.kind === "video")) media.push(m);
    }
    const mediaFiles: { kind: "image" | "video"; file: string }[] = [];
    for (const [k, m] of media.entries()) {
      const f = path.join(dir, `user${k}.${m.type.split("/")[1] === "quicktime" ? "mov" : m.type.split("/")[1]}`);
      await fs.writeFile(f, await readFile(m));
      mediaFiles.push({ kind: m.kind, file: f });
    }

    const voice = !!(await elevenlabsKey());
    const jobs: SceneJob[] = [];
    const scenes = plan.scenes.filter((s) => s.narration.trim() || s.onScreen.trim());
    if (!scenes.length) throw new Error("This plan has no scenes to render.");
    for (const [i, scene] of scenes.entries()) {
      let audio: string | undefined;
      let dur = Math.max(1.8, scene.narration.split(/\s+/).filter(Boolean).length / 2.6);
      if (voice && scene.narration.trim()) {
        audio = path.join(dir, `vo${i}.mp3`);
        await tts(scene.narration, audio);
        dur = (await duration(audio)) + 0.25;
      }
      let visual: SceneJob["visual"];
      if (mediaFiles.length) visual = mediaFiles[i % mediaFiles.length];
      else {
        const clip = path.join(dir, `stock${i}.mp4`);
        visual = (await pexelsClip(cleanQuery(scene.visual), !long, clip))
          ? { kind: "video", file: clip }
          : { kind: "gradient", colors: GRADIENTS[i % GRADIENTS.length] };
      }
      jobs.push({ scene, dur, audio, visual });
      await setRender(post, { progress: Math.round(5 + (35 * (i + 1)) / scenes.length), message: voice ? "Recording voiceover and gathering visuals…" : "Gathering visuals…" });
    }

    const segs: string[] = [];
    for (const [i, job] of jobs.entries()) {
      segs.push(await renderSegment(job, i, dir, W, H));
      await setRender(post, { progress: Math.round(40 + (55 * (i + 1)) / jobs.length), message: `Rendering scene ${i + 1} of ${jobs.length}…` });
    }

    const list = path.join(dir, "list.txt");
    await fs.writeFile(list, segs.map((s) => `file '${s}'`).join("\n"));
    const out = path.join(dir, "final.mp4");
    await run("ffmpeg", ["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out]);
    const bytes = await fs.readFile(out);
    const slug = (post.hook || "video").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "video";
    const item = await storeFile(userId, { name: `${slug}.mp4`, type: "video/mp4", bytes });
    item.rendered = true;
    item.durationSec = Math.round(await duration(out));
    await db().upsert("media", item);

    const fresh = (await db().get<Post>("posts", postId)) ?? post;
    fresh.mediaIds = [item.id, ...(fresh.mediaIds ?? []).filter((id) => id !== fresh.render?.mediaId)];
    fresh.render = { status: "done", progress: 100, message: `${item.durationSec}s · ${voice ? "voiceover" : "captions only"} · ${(bytes.length / 1048576).toFixed(1)} MB`, mediaId: item.id, updatedAt: nowIso() };
    if (fresh.status === "copy_ready") { fresh.status = "draft"; fresh.error = undefined; }
    await savePost(fresh);
    await log("info", "generate", `Video rendered (${item.durationSec}s) — “${post.hook.slice(0, 60)}”`, { platform: post.platform, postId });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 400);
    const fresh = (await db().get<Post>("posts", postId)) ?? post;
    fresh.render = { status: "failed", progress: 0, message: msg, updatedAt: nowIso() };
    await savePost(fresh);
    if (credits) await refundCredits(userId, credits);
    await log("error", "generate", `Video render failed: ${msg}${credits ? " (credits refunded)" : ""}`, { platform: post.platform, postId });
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
