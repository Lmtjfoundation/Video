import "server-only";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { foundryAuth } from "./azure-identity";
import { pick } from "./integrations";
import { showPreview } from "./preview";
import type { VideoPlan, VideoScene } from "./types";

/**
 * Stylized motion-graphics scenes on Azure (azure/scene-render): every scene is a short clip that moves from a start
 * keyframe to an end keyframe (Wan 2.1 First-Last-Frame on Container Apps serverless A100s), all scenes in parallel,
 * then a CPU FFmpeg job adds crisp typography, transitions and the voiceover. All first-party Azure: Azure OpenAI
 * designs the scenes (and, when deployed, paints the keyframes), Azure AI Speech has already voiced them, Blob Storage
 * and Storage Queues carry the work, Event Grid starts the stitch.
 *
 * Switched on by AZURE_SCENES_ACCOUNT (the storage account deploy.sh made). Without it, or if anything fails, the
 * render falls back to Vueio's own motion-graphics engine.
 */
export const scenesAccount = async () => (await pick("azureScenesAccount", "AZURE_SCENES_ACCOUNT")).trim();
export const azureScenesReady = async () => /^[a-z0-9]{3,24}$/.test(await scenesAccount());

const CONTAINER = "scenes";
const QUEUE = "scene-jobs";
const STYLE =
  "stylized premium motion-graphics frame: bold flat vector shapes, clean geometric layout, smooth gradients, crisp edges, " +
  "glowing accents, generous negative space for on-screen titles, no text, no letters, no watermark";

export interface SceneDesign {
  start: string;
  end: string;
  motion: string;
  overlays: { text: string; start: number; end: number; y: number; size: number; font: "display" | "body"; x: "center" | "left" | "right"; bar: boolean }[];
}

/** Generation size for Wan 2.1 FLF2V (trained at 720p): 720×1280 vertical or 1280×720 wide. */
export const genSize = (W: number, H: number) => (H >= W ? { width: 720, height: 1280 } : { width: 1280, height: 720 });

/** One overlay, kept inside safe limits whatever the designer wrote. */
export function cleanOverlay(o: Partial<SceneDesign["overlays"][number]>, seconds: number): SceneDesign["overlays"][number] | null {
  const text = String(o.text ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!text) return null;
  const num = (v: unknown, d: number, lo: number, hi: number) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  const start = num(o.start, 0.25, 0, Math.max(0, seconds - 0.6));
  const end = num(o.end, seconds - 0.2, start + 0.5, seconds);
  return { text, start, end, y: num(o.y, 0.12, 0.04, 0.9), size: num(o.size, 0.07, 0.03, 0.14), font: o.font === "body" ? "body" : "display", x: o.x === "left" || o.x === "right" ? o.x : "center", bar: !!o.bar };
}

/** Azure OpenAI designs each scene: start and end keyframes, the motion between them, and its kinetic titles. */
export async function designScenes(o: { niche: string; style: string; scenes: { scene: VideoScene; dur: number }[] }): Promise<SceneDesign[]> {
  const { ownWriter, writeWithOwnWriter } = await import("./own-writer");
  const w = await ownWriter();
  const fallback = (s: VideoScene, dur: number): SceneDesign => ({
    start: `${s.visual || s.narration}`,
    end: `${s.visual || s.narration}, the composition resolved and settled`,
    motion: "smooth camera push-in, shapes glide and morph into place, gentle parallax",
    overlays: [cleanOverlay({ text: s.onScreen || "", start: 0.25, end: dur - 0.2, y: 0.12, size: 0.075, bar: true }, dur)].filter(Boolean) as SceneDesign["overlays"],
  });
  if (!w) return o.scenes.map(({ scene, dur }) => fallback(scene, dur));
  const user = JSON.stringify({
    niche: o.niche,
    style: o.style,
    scenes: o.scenes.map(({ scene, dur }, i) => ({ i, seconds: Number(dur.toFixed(2)), narration: scene.narration, onScreen: scene.onScreen, visual: scene.visual })),
  });
  const system =
    "You are a motion designer for premium short-form explainer videos (OpenArt / Seedance-style stylized motion graphics). " +
    'For every scene return {"start","end","motion","overlays"}: "start" and "end" describe the first and last frame as stylized ' +
    "vector motion-graphics compositions with the same palette, objects and layout (the end is the same scene after its animation " +
    'plays out: elements moved, grown, revealed); never include written words in pictures. "motion" is one sentence of camera and ' +
    'element motion between them. "overlays" are 1-2 kinetic titles: {"text" (max 6 words), "start","end" (seconds within the scene), ' +
    '"y" (0-1 from top), "size" (fraction of width, 0.05-0.11), "font" ("display" or "body"), "x" ("center","left","right"), "bar" (accent underline)}. ' +
    'Answer with JSON {"scenes":[...]} in scene order.';
  try {
    const text = await writeWithOwnWriter(w, { system, user, maxTokens: 3000, temperature: 0.7, json: true });
    const got = (JSON.parse(text) as { scenes?: Partial<SceneDesign>[] }).scenes ?? [];
    return o.scenes.map(({ scene, dur }, i) => {
      const d = got[i];
      if (!d?.start || !d.end) return fallback(scene, dur);
      const overlays = (d.overlays ?? []).map((x) => cleanOverlay(x, dur)).filter(Boolean).slice(0, 2) as SceneDesign["overlays"];
      return { start: String(d.start).slice(0, 900), end: String(d.end).slice(0, 900), motion: String(d.motion ?? "").slice(0, 300), overlays };
    });
  } catch (e) {
    console.warn(`[azure-scenes] scene design fell back: ${(e as Error).message.slice(0, 200)}`);
    return o.scenes.map(({ scene, dur }) => fallback(scene, dur));
  }
}

/** A keyframe: Azure OpenAI's image model when deployed (AZURE_AI_KEYFRAME_DEPLOYMENT), else FLUX.2 on Azure Foundry. */
async function keyframe(prompt: string, portrait: boolean, ref?: Buffer): Promise<Buffer> {
  const dep = (await pick("azureAiKeyframeDeployment", "AZURE_AI_KEYFRAME_DEPLOYMENT")).trim();
  const auth = dep ? await foundryAuth() : null;
  const full = `${prompt}. ${STYLE}.`;
  if (dep && auth) {
    const size = portrait ? "1024x1536" : "1536x1024";
    let res: Response;
    if (ref) {
      const form = new FormData();
      form.set("model", dep);
      form.set("prompt", `${full} Keep the same palette, objects and layout as the reference; this is the end of its animation.`);
      form.set("size", size);
      form.set("image", new Blob([new Uint8Array(ref)], { type: "image/png" }), "start.png");
      res = await fetch(`${auth.base}/openai/v1/images/edits`, { method: "POST", headers: auth.headers, body: form, signal: AbortSignal.timeout(240_000) });
    } else {
      res = await fetch(`${auth.base}/openai/v1/images/generations`, { method: "POST", headers: { ...auth.headers, "Content-Type": "application/json" }, body: JSON.stringify({ model: dep, prompt: full, size, n: 1 }), signal: AbortSignal.timeout(240_000) });
    }
    if (!res.ok) throw new Error(`Azure OpenAI keyframe failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const b64 = ((await res.json()) as { data?: { b64_json?: string }[] }).data?.[0]?.b64_json;
    if (!b64) throw new Error("Azure OpenAI returned no keyframe.");
    return Buffer.from(b64, "base64");
  }
  const { makeImage } = await import("./pictures");
  const img = await makeImage({ prompt: full, aspect: portrait ? "9:16" : "16:9", refs: ref ? [{ mimeType: "image/png", base64: ref.toString("base64") }] : undefined });
  return img.bytes;
}

async function clients() {
  const [{ BlobServiceClient }, { QueueClient }, { azureCredential }] = await Promise.all([import("@azure/storage-blob"), import("@azure/storage-queue"), import("./azure-identity")]);
  const account = await scenesAccount();
  const cred = (await azureCredential()) as never;
  return {
    blobs: new BlobServiceClient(`https://${account}.blob.core.windows.net`, cred).getContainerClient(CONTAINER),
    queue: new QueueClient(`https://${account}.queue.core.windows.net/${QUEUE}`, cred),
  };
}

/** The queue message for one scene (base64 JSON, as the worker reads it). */
export const sceneMessage = (id: string, scene: number) => Buffer.from(JSON.stringify({ id, scene })).toString("base64");

/** Every scene's voice laid end to end on the scene timeline (silence where a scene has none), as one WAV. */
async function voiceTrack(scenes: { audio?: string; dur: number }[], dir: string): Promise<string | null> {
  if (!scenes.some((s) => s.audio)) return null;
  const parts: string[] = [];
  for (const [i, s] of scenes.entries()) {
    const f = path.join(dir, `azv${i}.wav`);
    const args = s.audio
      ? ["-i", s.audio, "-af", `aresample=48000,aformat=channel_layouts=mono,apad,atrim=duration=${s.dur.toFixed(3)}`]
      : ["-f", "lavfi", "-t", s.dur.toFixed(3), "-i", "anullsrc=r=48000:cl=mono"];
    await promisify(execFile)("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args, "-ar", "48000", "-ac", "1", f]);
    parts.push(f);
  }
  const list = path.join(dir, "azv.txt");
  await fs.writeFile(list, parts.map((p) => `file '${p}'`).join("\n"));
  const out = path.join(dir, "azvoice.wav");
  await promisify(execFile)("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out]);
  return out;
}

/**
 * Renders a video's scenes on Azure and writes the finished MP4 (picture and voice) to `out`. Throws on any problem,
 * so the caller can fall back. `say` reports progress (percent, message).
 */
export async function renderOnAzureScenes(o: {
  id: string;
  plan: VideoPlan;
  scenes: { scene: VideoScene; dur: number; audio?: string }[];
  W: number;
  H: number;
  dir: string;
  out: string;
  say: (progress: number, message: string) => Promise<unknown> | void;
  timeoutMs?: number;
  /** Paints one keyframe (defaults to Azure OpenAI's image model, else FLUX.2 on Azure Foundry). */
  paint?: (prompt: string, portrait: boolean, ref?: Buffer) => Promise<Buffer>;
}): Promise<void> {
  const rid = `${o.id}-${Date.now().toString(36)}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60);
  const portrait = o.H >= o.W;
  const paint = o.paint ?? keyframe;
  const { blobs, queue } = await clients();
  await o.say(12, "Designing the motion graphics…");
  const designs = await designScenes({ niche: o.plan.niche, style: o.plan.style, scenes: o.scenes });

  // Keyframes: each scene's start, then its end painted from the start (same palette and layout).
  await o.say(18, "Painting keyframes…");
  let done = 0;
  const keys = new Array<{ start: string; end: string }>(designs.length);
  const queueOf = designs.map((d, i) => async () => {
    const start = await paint(d.start, portrait);
    const end = await paint(d.end, portrait, start);
    await Promise.all([
      blobs.getBlockBlobClient(`${rid}/keys/${i}-start.png`).uploadData(start, { blobHTTPHeaders: { blobContentType: "image/png" } }),
      blobs.getBlockBlobClient(`${rid}/keys/${i}-end.png`).uploadData(end, { blobHTTPHeaders: { blobContentType: "image/png" } }),
    ]);
    await showPreview({ bytes: start, mime: "image/png", label: `Scene ${i + 1} keyframe` });
    keys[i] = { start: `${rid}/keys/${i}-start.png`, end: `${rid}/keys/${i}-end.png` };
    await o.say(18 + Math.round((22 * ++done) / designs.length), `Painting keyframes (${done} of ${designs.length})…`);
  });
  for (let i = 0; i < queueOf.length; i += 3) await Promise.all(queueOf.slice(i, i + 3).map((f) => f()));

  const voice = await voiceTrack(o.scenes, o.dir);
  if (voice) await blobs.getBlockBlobClient(`${rid}/voice.wav`).uploadFile(voice, { blobHTTPHeaders: { blobContentType: "audio/wav" } });
  const plan = {
    id: rid,
    size: { width: o.W, height: o.H },
    gen: { ...genSize(o.W, o.H), steps: 16, cfg: 5 },
    transition: { type: "smoothleft", seconds: 0.35 },
    voice: voice ? `${rid}/voice.wav` : null,
    scenes: designs.map((d, i) => ({ start: keys[i].start, end: keys[i].end, prompt: `${d.motion}. ${d.start} → ${d.end}. ${STYLE}`, seconds: Number(o.scenes[i].dur.toFixed(3)), seed: Math.floor(Math.random() * 2 ** 31) })),
    overlays: designs.flatMap((d, i) => d.overlays.map((x) => ({ ...x, scene: i, color: "FFFFFF", accent: "3EF0A8" }))),
  };
  await blobs.getBlockBlobClient(`${rid}/plan.json`).uploadData(Buffer.from(JSON.stringify(plan)), { blobHTTPHeaders: { blobContentType: "application/json" } });
  // An hour to live: work that no GPU picked up by then (no quota, a stopped job) never runs later for nothing.
  for (let i = 0; i < plan.scenes.length; i++) await queue.sendMessage(sceneMessage(rid, i), { messageTimeToLive: 3600 });
  const queued = Date.now();
  await o.say(42, `Rendering ${plan.scenes.length} scenes in parallel on Azure GPUs…`);

  // Wait for the stitched video; show each scene clip as it lands.
  const deadline = Date.now() + (o.timeoutMs ?? 40 * 60_000);
  const seen = new Set<string>();
  for (;;) {
    for await (const b of blobs.listBlobsFlat({ prefix: `${rid}/` })) {
      if (b.name.includes("/failed/")) throw new Error(`Azure couldn't render scene ${b.name.split("/").pop()?.replace(".json", "")}.`);
      if (b.name.includes("/clips/") && !seen.has(b.name)) {
        seen.add(b.name);
        await showPreview({ bytes: await blobs.getBlockBlobClient(b.name).downloadToBuffer(), mime: "video/mp4", label: `Scene ${Number(b.name.split("/").pop()?.split(".")[0]) + 1} of ${plan.scenes.length}` }).catch(() => {});
        await o.say(42 + Math.round((48 * seen.size) / plan.scenes.length), `Rendered ${seen.size} of ${plan.scenes.length} scenes…`);
      }
      if (b.name === `${rid}/status.json`) {
        const st = JSON.parse((await blobs.getBlockBlobClient(b.name).downloadToBuffer()).toString()) as { state: string; error?: string };
        if (st.state === "failed") throw new Error(`The Azure stitch failed: ${st.error ?? "no reason given"}`);
        if (st.state === "done") {
          await o.say(92, "Downloading the finished video…");
          await blobs.getBlockBlobClient(`${rid}/final.mp4`).downloadToFile(o.out);
          return;
        }
      }
    }
    if (Date.now() > deadline) throw new Error("Azure scene rendering took too long.");
    // No GPU took any of this video's scenes in 4 minutes: the jobs aren't starting (no serverless GPU quota yet, or
    // the job is stopped). Fall back now instead of waiting out the deadline.
    if (!seen.size && Date.now() - queued > 4 * 60_000) {
      const waiting = (await queue.getProperties()).approximateMessagesCount ?? 0;
      if (waiting >= plan.scenes.length) throw new Error("Azure's GPU scene jobs didn't start (check the serverless GPU quota).");
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}
