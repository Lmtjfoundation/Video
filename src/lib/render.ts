import "server-only";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { asUser, db } from "./db";
import { readFile, storeFile } from "./media";
import { log, savePost } from "./repo";
import { getUser, refundCredits } from "./auth";
import { autoPublish } from "./publisher";
import { elevenlabsKey, elevenlabsVoice, pexelsHeaders, pexelsKey, pixabayKey } from "./integrations";
import type { Character, MediaItem, Post, VideoPlan, VideoScene } from "./types";
import { nowIso } from "./utils";
import { characterRef, getCharacters } from "./characters";
import { geminiImage, MediaGenError, veoClip, type RefImage } from "./gemini-media";
import { seedanceClip, wanClip } from "./replicate-video";
import { CREDIT_COST } from "./plans";
import { aiVisualCredits, animationSecondCredits, renderableScenes, veoSeconds } from "./video-spec";

/**
 * Turns a video plan into a finished MP4 on the server with ffmpeg:
 *  - Voiceover: ElevenLabs text-to-speech per scene (ELEVENLABS_API_KEY). Without a key the video is a
 *    "text story" — captions carry the narration and each scene is timed to a natural reading pace.
 *  - Visuals per scene, in order of preference: the user's attached images/clips, Pixabay (or Pexels) stock
 *    footage matching the scene's visual note, or a moving brand gradient. Movies and explainers (`plan.ai`) are
 *    pictured with Gemini instead, using the characters' portraits, and their key scenes are animated with Veo.
 *  - On-screen text (top) and word-group captions (bottom), burned in with a bundled font.
 * Output: 1080×1920 vertical (Shorts/Reels/TikTok) or 1920×1080 for YouTube long-form, H.264 + AAC, saved to
 * the user's Media Library and attached to the post.
 */

const FPS = 30;
/**
 * ffmpeg sizes its thread pools from the host's core count, which in a container can be dozens of cores and
 * several GB of frame buffers — enough to get killed on a 1 GB server. Pin it to the CPUs we actually have.
 */
const THREADS = String(Math.max(1, Math.min(8, Number(process.env.RENDER_THREADS) || 2)));
const FONT = path.join(process.cwd(), "assets", "fonts", "Poppins-Bold.ttf");
const DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb"; // ElevenLabs premade narrator voice; override with ELEVENLABS_VOICE_ID
const GRADIENTS: [string, string][] = [
  ["0x141b3a", "0x5b2a86"],
  ["0x0f2a2a", "0x13756f"],
  ["0x2a160c", "0x8a3d16"],
  ["0x101828", "0x2f5288"],
];

let queue: Promise<unknown> = Promise.resolve();
/** Posts this server process is rendering or has waiting in its queue. */
const inFlight = new Set<string>();

/** Renders one video at a time so a burst of requests can't starve the web server of CPU. */
export function enqueueRender(userId: string, postId: string, credits = 0) {
  inFlight.add(postId);
  queue = queue.then(() =>
    asUser(userId, () => renderVideoPost(userId, postId, credits))
      .catch(() => {})
      .finally(() => inFlight.delete(postId)),
  );
  return queue;
}

/**
 * A post still marked "queued"/"rendering" that this process isn't working on was cut off by a server restart
 * (a redeploy or crash). Mark it failed and refund its credits so the user can simply render again instead of
 * watching a progress bar that never moves. Returns true when it released one.
 */
export async function releaseOrphanedRender(userId: string, post: Post): Promise<boolean> {
  const r = post.render;
  if (!r || (r.status !== "queued" && r.status !== "rendering") || inFlight.has(post.id)) return false;
  if (Date.now() - Date.parse(r.updatedAt) < 30_000) return false; // just being started
  post.render = {
    status: "failed",
    progress: 0,
    message: `The server restarted while this video was being made, so it stopped.${r.credits ? " Your credits were refunded." : ""} Press Render video to try again.`,
    updatedAt: nowIso(),
  };
  await savePost(post);
  if (r.credits) await refundCredits(userId, r.credits);
  return true;
}

function run(cmd: string, args: string[], timeoutMs = 10 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      p.kill("SIGKILL");
    }, timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
    p.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    p.on("close", (code, signal) => {
      clearTimeout(t);
      if (code === 0) return resolve(out);
      const why = timedOut ? "timed out" : signal ? `killed by ${signal}` : `exit ${code}`;
      reject(new Error(`${cmd} failed (${why}): ${err.slice(-600)}`));
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

/* Pixabay asks apps to cache API responses for 24 hours (and keep under 100 requests a minute). */
type PixabayHit = { videos: Record<"large" | "medium" | "small" | "tiny", { url: string; width: number; height: number; size: number }> };
const pixabayCache = new Map<string, { at: number; hits: PixabayHit[] }>();

async function pixabayClip(query: string, portrait: boolean, file: string): Promise<boolean> {
  const key = await pixabayKey();
  if (!key || !query) return false;
  try {
    const q = query.slice(0, 100);
    let hits = pixabayCache.get(q.toLowerCase());
    if (!hits || Date.now() - hits.at > 24 * 3600_000) {
      const res = await fetch(`https://pixabay.com/api/videos/?${new URLSearchParams({ key, q, per_page: "10", safesearch: "true", video_type: "film" })}`, {
        headers: { Accept: "application/json", "User-Agent": pexelsHeaders("")["User-Agent"] },
      });
      if (!res.ok) {
        console.warn(`[render] Pixabay search failed: ${res.status} ${(await res.text()).replace(/\s+/g, " ").slice(0, 160)}`);
        return false;
      }
      hits = { at: Date.now(), hits: (((await res.json()) as { hits?: PixabayHit[] }).hits ?? []) };
      pixabayCache.set(q.toLowerCase(), hits);
    }
    // Vertical clips first for 9:16 videos; otherwise the sharpest file that stays a reasonable download.
    const ordered = [...hits.hits].sort((a, b) => {
      const va = a.videos.medium.height > a.videos.medium.width ? 1 : 0;
      const vb = b.videos.medium.height > b.videos.medium.width ? 1 : 0;
      return portrait ? vb - va : va - vb;
    });
    for (const h of ordered) {
      const sizes = [h.videos.medium, h.videos.small, h.videos.large];
      const pick = sizes.find((v) => v?.url && v.size > 0 && v.size < 60 * 1024 * 1024) ?? sizes.find((v) => v?.url);
      if (!pick) continue;
      const dl = await fetch(pick.url, { headers: { "User-Agent": pexelsHeaders("")["User-Agent"] } });
      if (!dl.ok) continue;
      const bytes = Buffer.from(await dl.arrayBuffer());
      if (bytes.length > 80 * 1024 * 1024) continue;
      await fs.writeFile(file, bytes);
      return true;
    }
  } catch (e) {
    console.warn(`[render] Pixabay clip failed: ${(e as Error).message}`);
  }
  return false;
}

async function pexelsClip(query: string, portrait: boolean, file: string): Promise<boolean> {
  const key = await pexelsKey();
  if (!key || !query) return false;
  try {
    const res = await fetch(
      `https://api.pexels.com/videos/search?${new URLSearchParams({ query, orientation: portrait ? "portrait" : "landscape", size: "medium", per_page: "5" })}`,
      { headers: pexelsHeaders(key) },
    );
    if (!res.ok) {
      console.warn(`[render] Pexels search failed: ${res.status} ${(await res.text()).replace(/\s+/g, " ").slice(0, 160)}`);
      return false;
    }
    const data = (await res.json()) as { videos?: { video_files: { link: string; width: number; height: number; file_type: string }[] }[] };
    const want = portrait ? 1080 : 1920;
    for (const v of data.videos ?? []) {
      const files = v.video_files
        .filter((f) => f.file_type === "video/mp4" && (portrait ? f.height >= f.width : f.width >= f.height))
        .sort((a, b) => Math.abs((portrait ? a.width : a.width) - want) - Math.abs((portrait ? b.width : b.width) - want));
      const pick = files[0];
      if (!pick) continue;
      const dl = await fetch(pick.link, { headers: { "User-Agent": pexelsHeaders(key)["User-Agent"] } });
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
  /** `hold`: a clip shorter than the scene freezes on its last frame instead of looping (Veo clips). */
  visual: { kind: "image" | "video"; file: string; hold?: boolean } | { kind: "gradient"; colors: [string, string] };
}

async function renderSegment(job: SceneJob, i: number, dir: string, W: number, H: number): Promise<string> {
  const out = path.join(dir, `seg${String(i).padStart(3, "0")}.mp4`);
  const F = Math.max(1, Math.round(job.dur * FPS));
  const args: string[] = ["-hide_banner", "-y", "-filter_complex_threads", THREADS];

  // Inputs: [0] visual, [1] audio (decoder threads capped per input)
  args.push("-threads", THREADS);
  const vis = job.visual;
  if (vis.kind === "gradient") args.push("-f", "lavfi", "-t", job.dur.toFixed(3), "-i", `gradients=s=${W}x${H}:c0=${vis.colors[0]}:c1=${vis.colors[1]}:speed=0.015:r=${FPS}`);
  else if (vis.kind === "image") args.push("-i", vis.file);
  else if (vis.hold) args.push("-i", vis.file);
  else args.push("-stream_loop", "-1", "-t", job.dur.toFixed(3), "-i", vis.file);
  args.push("-threads", THREADS);
  if (job.audio) args.push("-i", job.audio);
  else args.push("-f", "lavfi", "-t", job.dur.toFixed(3), "-i", "anullsrc=r=44100:cl=stereo");

  let v: string;
  if (job.visual.kind === "image") {
    // Slow Ken Burns push-in, alternating direction per scene.
    const zin = i % 2 === 0;
    const z = zin ? `1+0.12*on/${F}` : `1.12-0.12*on/${F}`;
    v = `[0:v]scale=${Math.round(W * 1.5)}:${Math.round(H * 1.5)}:force_original_aspect_ratio=increase,crop=${Math.round(W * 1.5)}:${Math.round(H * 1.5)},zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${F}:s=${W}x${H}:fps=${FPS}`;
  } else if (job.visual.kind === "video") {
    v = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS}`;
    if (job.visual.hold) v += `,tpad=stop_mode=clone:stop_duration=${job.dur.toFixed(3)}`;
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
    "-c:v", "libx264", "-preset", process.env.RENDER_PRESET || "veryfast", "-crf", "20", "-r", String(FPS), "-pix_fmt", "yuv420p", "-threads", THREADS,
    "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2",
    out,
  );
  await run("ffmpeg", args);
  return out;
}

/* ───────────── AI visuals (movies and explainers) ───────────── */

/** Runs `fn` over `items` with at most `limit` running at once, keeping order. */
/** Runs `fn` over `items` with at most `limit` running at once, keeping order. After one throws, no new item starts. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && !failed) {
        const i = next++;
        try {
          out[i] = await fn(items[i], i);
        } catch (e) {
          failed = true;
          throw e;
        }
      }
    }),
  );
  return out;
}

const extFor = (mime: string) => (mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png");

function scenePrompt(scene: VideoScene, ai: NonNullable<VideoPlan["ai"]>, cast: Character[], portrait: boolean) {
  return [
    `A single ${portrait ? "vertical 9:16" : "widescreen 16:9"} film frame in this art style: ${ai.look}.`,
    `Shot: ${scene.visual || scene.narration}`,
    cast.length ? `Characters in frame (each must match their attached reference picture exactly — same face, hair, build, outfit and colors): ${cast.map((c) => `${c.name} — ${c.description}`.slice(0, 400)).join("; ")}.` : "",
    "Cinematic composition, clear focal point, rich lighting. Leave the lower third uncluttered for captions. No text, letters, subtitles, signs, logos or watermarks.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Pictures every scene with Gemini (3 at a time), then animates the chosen scenes with Veo (2 at a time).
 * A scene Google can't make falls back to stock footage or a background, and its credits are counted as unused
 * so the caller refunds them. Errors the owner must fix (key, billing) stop the render.
 */
async function paintScenes(post: Post, ai: NonNullable<VideoPlan["ai"]>, indexes: number[], jobs: SceneJob[], dir: string, long: boolean): Promise<number> {
  const cast = await getCharacters(ai.characterIds);
  const refs = new Map<string, RefImage>();
  for (const c of cast) {
    const r = await characterRef(c).catch(() => null);
    if (r) refs.set(c.name.toLowerCase(), r);
  }
  const portrait = !long;
  let unused = 0;
  let done = 0;
  const stills: (RefImage | null)[] = await mapLimit(jobs, 3, async (job, i) => {
    const inScene = cast.filter((c) => (job.scene.cast ?? []).some((n) => n.toLowerCase() === c.name.toLowerCase()));
    const sceneRefs = inScene.map((c) => refs.get(c.name.toLowerCase())).filter((r): r is RefImage => !!r);
    try {
      const img = await geminiImage({ prompt: scenePrompt(job.scene, ai, inScene, portrait), refs: sceneRefs, aspect: portrait ? "9:16" : "16:9", size: "2K" });
      const file = path.join(dir, `ai${i}.${extFor(img.mimeType)}`);
      await fs.writeFile(file, img.bytes);
      job.visual = { kind: "image", file };
      return { mimeType: img.mimeType, base64: img.bytes.toString("base64") };
    } catch (e) {
      if (e instanceof MediaGenError && e.kind === "config") throw e;
      console.warn(`[render] AI picture for scene ${i + 1} failed: ${(e as Error).message.slice(0, 200)}`);
      unused += CREDIT_COST.aiImage;
      const clip = path.join(dir, `stock${i}.mp4`);
      const q = cleanQuery(job.scene.visual);
      if ((await pixabayClip(q, portrait, clip)) || (await pexelsClip(q, portrait, clip))) job.visual = { kind: "video", file: clip };
      return null;
    } finally {
      done++;
      await setRender(post, { progress: Math.round(15 + (25 * done) / jobs.length), message: `Painting scene ${done} of ${jobs.length} with Gemini…` });
    }
  });

  const veo = jobs.map((job, i) => ({ job, i, original: indexes[i] })).filter(({ original }) => ai.veoScenes.includes(original));
  let animated = 0;
  const engine = ai.engine === "seedance" ? "Seedance" : ai.engine === "wan" ? "Wan" : "Veo";
  await mapLimit(veo, 2, async ({ job, i }) => {
    const seconds = veoSeconds(job.scene);
    const still = stills[i];
    try {
      if (!still) throw new MediaGenError("No picture to animate.");
      await setRender(post, { message: `Animating scene ${i + 1} with ${engine} (about 1–3 minutes a clip)…` });
      const prompt = `${job.scene.motion || "Subtle, natural movement with a slow cinematic camera move."} ${job.scene.visual}`.slice(0, 1500) + ` Art style: ${ai.look}. Keep the characters exactly as they appear in the starting frame. No text or captions.`;
      const clip = { prompt, start: still, aspect: portrait ? ("9:16" as const) : ("16:9" as const), seconds };
      const bytes = engine === "Seedance" ? await seedanceClip(clip) : engine === "Wan" ? await wanClip(clip) : await veoClip(clip);
      const file = path.join(dir, `veo${i}.mp4`);
      await fs.writeFile(file, bytes);
      job.visual = { kind: "video", file, hold: true };
    } catch (e) {
      if (e instanceof MediaGenError && e.kind === "config") throw e;
      console.warn(`[render] ${engine} clip for scene ${i + 1} failed, keeping the picture: ${(e as Error).message.slice(0, 200)}`);
      unused += seconds * animationSecondCredits(ai.engine);
    } finally {
      animated++;
      await setRender(post, { progress: Math.round(40 + (10 * animated) / Math.max(1, veo.length)) });
    }
  });
  return unused;
}

/* ───────────── Main ───────────── */

/** Plain-language render errors (the raw ffmpeg output goes to the server log). */
function friendlyRenderError(raw: string) {
  if (/failed \(timed out\)/i.test(raw)) {
    return "Making the video took too long and was stopped. Try a shorter length, or press Render video again.";
  }
  if (/failed \((null|killed by SIG\w+)\)|Cannot allocate memory|out of memory/i.test(raw)) {
    return "The server ran out of memory while making this video. Press Render video again; if it keeps happening, the video's images or clips are too large.";
  }
  if (/Voiceover failed/i.test(raw)) return raw.slice(0, 300);
  if (/ffmpeg/i.test(raw) && /No such file|Invalid data|could not find codec|Decoder/i.test(raw)) {
    return "One of the attached images or clips couldn't be read. Remove it or attach a JPG, PNG or MP4 instead, then press Render video again.";
  }
  if (/^ffmpeg failed/i.test(raw)) return "Making the video failed on the server. Press Render video again; if it repeats, tell your developer (details are in the server log).";
  return raw.slice(0, 300);
}

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
    const planned = renderableScenes(plan);
    const scenes = planned.map((p) => p.scene);
    if (!scenes.length) throw new Error("This plan has no scenes to render.");
    const ai = plan.ai && !mediaFiles.length ? plan.ai : null;
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
      else if (ai) visual = { kind: "gradient", colors: GRADIENTS[i % GRADIENTS.length] }; // pictured below
      else {
        const clip = path.join(dir, `stock${i}.mp4`);
        const q = cleanQuery(scene.visual);
        visual = (await pixabayClip(q, !long, clip)) || (await pexelsClip(q, !long, clip))
          ? { kind: "video", file: clip }
          : { kind: "gradient", colors: GRADIENTS[i % GRADIENTS.length] };
      }
      jobs.push({ scene, dur, audio, visual });
      const share = ai ? 10 : 35;
      await setRender(post, { progress: Math.round(5 + (share * (i + 1)) / scenes.length), message: voice ? "Recording voiceover and gathering visuals…" : "Gathering visuals…" });
    }
    // Attached media replaces the AI pictures, so their credits go back.
    let unused = plan.ai && !ai ? aiVisualCredits(plan) : 0;
    if (ai) unused = await paintScenes(post, ai, planned.map((p) => p.index), jobs, dir, long);

    const segs: string[] = [];
    for (const [i, job] of jobs.entries()) {
      try {
        segs.push(await renderSegment(job, i, dir, W, H));
      } catch (e) {
        // A visual that ffmpeg can't handle (e.g. an iPhone HEIC photo or a damaged clip) shouldn't sink the whole
        // video: redo this scene on an animated background and keep going.
        if (job.visual.kind === "gradient") throw e;
        console.warn(`[render] scene ${i + 1} visual failed, using a background instead: ${(e as Error).message.slice(0, 200)}`);
        job.visual = { kind: "gradient", colors: GRADIENTS[i % GRADIENTS.length] };
        segs.push(await renderSegment(job, i, dir, W, H));
      }
      const [from, span] = ai ? [50, 45] : [40, 55];
      await setRender(post, { progress: Math.round(from + (span * (i + 1)) / jobs.length), message: `Rendering scene ${i + 1} of ${jobs.length}…` });
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
    const refunded = unused && credits ? ` · ${unused} credits refunded for ${ai ? "scenes Google couldn't make" : "AI scenes replaced by your media"}` : "";
    fresh.render = { status: "done", progress: 100, message: `${item.durationSec}s · ${voice ? "voiceover" : "captions only"}${ai ? " · AI visuals" : ""} · ${(bytes.length / 1048576).toFixed(1)} MB${refunded}`, mediaId: item.id, updatedAt: nowIso() };
    if (fresh.status === "copy_ready") { fresh.status = "draft"; fresh.error = undefined; }
    await savePost(fresh);
    if (unused && credits) await refundCredits(userId, Math.min(unused, credits));
    await log("info", "generate", `Video rendered (${item.durationSec}s) — “${post.hook.slice(0, 60)}”`, { platform: post.platform, postId });
    // "Post automatically": publish now that the video exists. Runs alongside the render queue (Instagram can take
    // minutes to process a Reel), so the next video starts rendering straight away.
    if (fresh.autoPost && fresh.status === "draft") {
      const requireApproval = (await getUser(userId))?.requireApproval;
      autoPublish(fresh, { requireApproval }).catch((e) => console.error(`[render] auto-post failed for ${postId}: ${(e as Error).message}`));
    }
  } catch (e) {
    const msg = friendlyRenderError((e as Error).message);
    console.error(`[render] failed for ${postId}: ${(e as Error).message.slice(0, 600)}`);
    const fresh = (await db().get<Post>("posts", postId)) ?? post;
    fresh.render = { status: "failed", progress: 0, message: msg, updatedAt: nowIso() };
    await savePost(fresh);
    if (credits) await refundCredits(userId, credits);
    await log("error", "generate", `Video render failed: ${msg}${credits ? " (credits refunded)" : ""}`, { platform: post.platform, postId });
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
