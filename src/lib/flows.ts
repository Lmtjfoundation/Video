import "server-only";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { db } from "./db";
import { makeStudioImage } from "./image-studio";
import { SPEECH_LANGUAGES } from "./languages";
import { readFile, storeFile } from "./media";
import { runCmd } from "./render";
import { kvGet, kvSet } from "./repo";
import { autoPrompt, makeFootage, makeMusic, makeSfx } from "./sound-studio";
import type { MediaItem } from "./types";
import { nowIso, uid } from "./utils";
import { makeSpeech } from "./voice-studio";
import { FLOW_STEP_TYPES, flowCredits, type Flow, type FlowStep } from "./flow-types";

/**
 * Flows: the AI tools chained into one reusable pipeline, run in the background from a single idea. Each step's
 * prompt can use {idea} (what you typed when running it) and {text} (what the last Auto-prompt step wrote). Pictures
 * feed the next footage step; the Finish step cuts the clips together with the music, the sound effects and the
 * voiceover into one MP4 in the Media Library.
 */
export { FLOW_STEP_TYPES, flowCredits };
export type { Flow, FlowStep };
const ROW = "flows";

export const listFlows = async () => (await kvGet<Flow[]>(ROW)) ?? [];

export function cleanFlow(f: Partial<Flow>): Flow {
  const steps = (Array.isArray(f.steps) ? f.steps : []).slice(0, 20).map((s) => {
    if (!FLOW_STEP_TYPES.includes(s?.type)) throw new Error(`Unknown step: ${String(s?.type)}`);
    return {
      type: s.type,
      prompt: String(s.prompt ?? "").slice(0, 600),
      seconds: s.seconds ? Number(s.seconds) : undefined,
      aspect: ["9:16", "16:9", "1:1"].includes(String(s.aspect)) ? s.aspect : undefined,
      language: s.language && s.language in SPEECH_LANGUAGES ? s.language : undefined,
      voiceId: s.voiceId ? String(s.voiceId) : undefined,
      kind: ["music", "sfx", "footage", "image"].includes(String(s.kind)) ? s.kind : undefined,
    } as FlowStep;
  });
  if (!steps.length) throw new Error("Add at least one step.");
  const name = String(f.name ?? "").trim().slice(0, 60);
  if (!name) throw new Error("Name the flow.");
  return { id: f.id || uid("flw"), name, steps, createdAt: f.createdAt || nowIso() };
}

export async function saveFlow(f: Partial<Flow>) {
  const flow = cleanFlow(f);
  const list = await listFlows();
  await kvSet(ROW, [flow, ...list.filter((x) => x.id !== flow.id)].slice(0, 50));
  return flow;
}
export async function deleteFlow(id: string) {
  await kvSet(ROW, (await listFlows()).filter((x) => x.id !== id));
}

const fill = (t: string | undefined, ctx: { idea: string; text: string }, fallback: string) =>
  (t?.trim() ? t : fallback).replaceAll("{idea}", ctx.idea).replaceAll("{text}", ctx.text || ctx.idea).trim();

export interface FlowResult {
  final?: MediaItem;
  outputs: { step: number; type: FlowStep["type"]; name: string; id: string }[];
}

/** Runs every step in order; `onStep` hears which step is starting. */
export async function runFlow(userId: string, flow: Flow, idea: string, onStep?: (i: number) => void): Promise<FlowResult> {
  const ctx = { idea: idea.trim().slice(0, 2000), text: "" };
  if (!ctx.idea) throw new Error("Type the idea to run the flow with.");
  const images: string[] = [];
  const clips: string[] = [];
  const sounds: string[] = [];
  let music: string | undefined;
  let voice: string | undefined;
  const outputs: FlowResult["outputs"] = [];
  let final: MediaItem | undefined;
  let aspect = "9:16";
  for (const [i, s] of flow.steps.entries()) {
    onStep?.(i);
    if (s.aspect) aspect = s.aspect;
    switch (s.type) {
      case "prompt": {
        ctx.text = await autoPrompt(s.kind ?? "footage", fill(s.prompt, ctx, "{idea}"));
        outputs.push({ step: i, type: s.type, name: ctx.text.slice(0, 80), id: "" });
        break;
      }
      case "image": {
        const m = await makeStudioImage(userId, { mode: "create", prompt: fill(s.prompt, ctx, "{text}"), aspect: aspect as "9:16" | "16:9" | "1:1" });
        images.push(m.id);
        outputs.push({ step: i, type: s.type, name: m.name, id: m.id });
        break;
      }
      case "footage": {
        const a = await makeFootage(userId, { prompt: fill(s.prompt, ctx, "{text}"), aspect, seconds: s.seconds ?? 5, startMediaId: images.at(-1) });
        clips.push(a.mediaId);
        outputs.push({ step: i, type: s.type, name: a.title, id: a.mediaId });
        break;
      }
      case "music": {
        const a = await makeMusic(userId, { prompt: fill(s.prompt, ctx, "Cinematic background music for: {idea}"), seconds: s.seconds ?? 30 });
        music = a.mediaId;
        outputs.push({ step: i, type: s.type, name: a.title, id: a.mediaId });
        break;
      }
      case "sfx": {
        const a = await makeSfx(userId, { prompt: fill(s.prompt, ctx, "{idea}"), seconds: s.seconds ?? 4 });
        sounds.push(a.mediaId);
        outputs.push({ step: i, type: s.type, name: a.title, id: a.mediaId });
        break;
      }
      case "voiceover": {
        const m = await makeSpeech(userId, { text: fill(s.prompt, ctx, "{idea}"), language: s.language ?? "en", voiceId: s.voiceId });
        voice = m.id;
        outputs.push({ step: i, type: s.type, name: m.name, id: m.id });
        break;
      }
      case "finish": {
        final = await finish(userId, { clips, images, music, voice, sounds, aspect, name: flow.name });
        outputs.push({ step: i, type: s.type, name: final.name, id: final.id });
        break;
      }
    }
  }
  return { final, outputs };
}

/**
 * Cuts the flow's clips (or, without clips, its pictures with a slow push-in) into one video as long as the
 * voiceover (or the music, at least 8 seconds), with the music under the voice and the sound effects at the start.
 */
export async function finish(userId: string, o: { clips: string[]; images: string[]; music?: string; voice?: string; sounds: string[]; aspect: string; name: string }): Promise<MediaItem> {
  const [W, H] = o.aspect === "16:9" ? [1920, 1080] : o.aspect === "1:1" ? [1080, 1080] : [1080, 1920];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ghost-post-flow-"));
  try {
    const save = async (id: string, name: string) => {
      const m = await db().get<MediaItem>("media", id);
      if (!m) throw new Error("A file from an earlier step is missing.");
      const f = path.join(dir, `${name}.${m.storagePath.split(".").pop()}`);
      await fs.writeFile(f, await readFile(m));
      return f;
    };
    const dur = async (f: string) => Number((await runCmd("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], 60_000)).trim()) || 0;
    const voice = o.voice ? await save(o.voice, "voice") : undefined;
    const music = o.music ? await save(o.music, "music") : undefined;
    const sounds = await Promise.all(o.sounds.map((id, i) => save(id, `sfx${i}`)));
    const length = Math.min(300, Math.max(8, voice ? (await dur(voice)) + 1 : music ? Math.min(60, await dur(music)) : 8));
    const visuals = o.clips.length ? await Promise.all(o.clips.map((id, i) => save(id, `clip${i}`))) : await Promise.all(o.images.map((id, i) => save(id, `pic${i}`)));
    if (!visuals.length) throw new Error("The Finish step needs a footage or picture step before it.");
    // Each visual gets an equal share; the sequence repeats if the voiceover is longer.
    const share = Math.max(2, length / visuals.length);
    const parts: string[] = [];
    for (const [i, v] of visuals.entries()) {
      const p = path.join(dir, `part${i}.mp4`);
      const fit = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30`;
      if (o.clips.length) await runCmd("ffmpeg", ["-hide_banner", "-y", "-stream_loop", "-1", "-i", v, "-t", share.toFixed(2), "-vf", fit, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", p], 10 * 60_000);
      else
        await runCmd("ffmpeg", ["-hide_banner", "-y", "-loop", "1", "-i", v, "-t", share.toFixed(2), "-vf", `${fit},zoompan=z='1+0.0008*on':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${W}x${H}:fps=30`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", p], 10 * 60_000);
      parts.push(p);
    }
    const list = path.join(dir, "list.txt");
    await fs.writeFile(list, parts.map((p) => `file '${p}'`).join("\n"));
    const pic = path.join(dir, "picture.mp4");
    await runCmd("ffmpeg", ["-hide_banner", "-y", "-stream_loop", "-1", "-f", "concat", "-safe", "0", "-i", list, "-t", length.toFixed(2), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", pic], 10 * 60_000);
    // The mix: voice on top, music ducked under it, sound effects at the start; then a gentle fade-out.
    const ins = [voice, music, ...sounds].filter(Boolean) as string[];
    const out = path.join(dir, "final.mp4");
    if (!ins.length) await fs.copyFile(pic, out);
    else {
      const chains: string[] = [];
      const labels: string[] = [];
      ins.forEach((f, i) => {
        const gain = f === voice ? 1.0 : f === music ? (voice ? 0.22 : 0.8) : 0.6;
        chains.push(`[${i + 1}:a]aresample=48000,volume=${gain}${f === music ? `,afade=t=out:st=${Math.max(0, length - 2)}:d=2` : ""}[a${i}]`);
        labels.push(`[a${i}]`);
      });
      const fc = `${chains.join(";")};${labels.join("")}amix=inputs=${ins.length}:normalize=0:duration=longest,atrim=0:${length.toFixed(2)},loudnorm=I=-14:TP=-1.5[a]`;
      await runCmd("ffmpeg", ["-hide_banner", "-y", "-i", pic, ...ins.flatMap((f) => ["-i", f]), "-filter_complex", fc, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", length.toFixed(2), "-movflags", "+faststart", out], 10 * 60_000);
    }
    const slug = o.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "flow";
    return storeFile(userId, { name: `flow-${slug}.mp4`, type: "video/mp4", bytes: await fs.readFile(out) }, { uncapped: true });
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
