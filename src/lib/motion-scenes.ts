import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { effectsFor, moveFor, type Effect, type Move } from "./movie-maker";
import { motionEngineReady } from "./movie-maker-render";
import { runCmd } from "./render";
import type { VideoScene } from "./types";

/**
 * Motion for every picture scene, so videos don't look like slideshows: Vueio's motion engine
 * (scripts/movie-motion/engine.py) turns each still into 2–3 shots — a depth-camera move, a punch-in on the subject, a
 * third move — with effects from the scene's words, a colour grade, film grain and a whip, flash or light-leak into
 * each new scene. Captions and on-screen text are added afterwards by the normal scene renderer.
 */

export type MotionGrade = "teal_orange" | "warm" | "cadmium_purple" | "noir" | "none";

export interface MotionShot {
  image: string;
  dur: number;
  move: Move | "punch";
  effects: (Effect | "cut")[];
  group: number;
}

const THIRD: Move[] = ["dolly", "track", "circle", "tilt_up", "pull_back", "crane_down"];
const ENTRY: Effect[] = ["whip_in", "flash_in", "leak_in"];
/** Effects that suit a short social video (the heavy ones stay for Movie Maker films). */
const LIGHT = new Set<Effect>(["fog", "dust", "beam", "flicker", "rain", "bubbles", "steam", "embers", "glow", "frost", "salt", "ghost", "shatter", "shake"]);

/** The shots for one scene: a new visual about every 2.5 seconds. */
export function sceneShots(scene: Pick<VideoScene, "narration" | "visual" | "motion" | "sfx">, image: string, dur: number, index: number): MotionShot[] {
  const n = dur > 5.5 ? 3 : dur > 3 ? 2 : 1;
  const first: Move = scene.motion?.trim() ? moveFor(scene.motion) : index % 2 ? "pull_back" : "push_in";
  const moves = ([first, "punch", THIRD[index % THIRD.length]] as MotionShot["move"][]).slice(0, n);
  const words = { visual: scene.visual, edit: scene.motion || "", sfx: scene.sfx || "", narration: scene.narration };
  const fx = effectsFor(words).filter((e) => LIGHT.has(e)).slice(0, 2);
  // Shots split the time unevenly (the first holds longest), but always add up to the scene.
  const weights = n === 3 ? [0.42, 0.28, 0.3] : n === 2 ? [0.55, 0.45] : [1];
  return moves.map((move, k) => ({
    image,
    dur: +(dur * weights[k]).toFixed(3),
    move,
    effects: k === 0 ? [...fx, ...(index > 0 ? [ENTRY[index % ENTRY.length]] : [])] : [...fx, "cut"],
    group: index,
  }));
}

/** The engine's film spec for a whole video (one output file per scene). */
export function motionFilm(shots: MotionShot[], W: number, H: number, grade: MotionGrade) {
  return { w: W, h: H, fps: 30, grade, split: true, scenes: shots.map((s) => ({ image: s.image, dur: s.dur, move: s.move, effects: s.effects, group: s.group })) };
}

/** The colour grade for a video's style. */
export const gradeFor = (style?: string): MotionGrade => (style === "fiction" ? "teal_orange" : style === "horror" ? "cadmium_purple" : "warm");

/**
 * Animate the picture scenes. `scenes` lists, per scene, its picture (or null for scenes that keep their own
 * visual) and its length. Returns the clip for each animated scene, by scene index; empty when the engine isn't
 * installed (the renderer then falls back to its simple zoom).
 */
export async function animateScenes(o: { dir: string; W: number; H: number; style?: string; scenes: ({ scene: VideoScene; image: string; dur: number } | null)[]; say?: (m: string) => void }): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const todo = o.scenes.map((s, i) => (s ? sceneShots(s.scene, s.image, s.dur, i) : [])).flat();
  if (!todo.length || !(await motionEngineReady())) return out;
  const spec = path.join(o.dir, "motion.json");
  await fs.writeFile(spec, JSON.stringify(motionFilm(todo, o.W, o.H, gradeFor(o.style))));
  const prefix = path.join(o.dir, "motion-");
  const frames = todo.reduce((n, s) => n + s.dur * 30, 0);
  o.say?.(`Animating ${new Set(todo.map((s) => s.group)).size} scenes…`);
  try {
    await runCmd(process.env.MOVIE_PYTHON || "python3", [path.join(process.cwd(), "scripts", "movie-motion", "engine.py"), spec, prefix], Math.max(15 * 60_000, frames * 2000));
  } catch (e) {
    console.warn(`[motion] the motion engine failed, using simple zooms: ${(e as Error).message.slice(0, 300)}`);
    return out;
  }
  for (const g of new Set(todo.map((s) => s.group))) {
    const f = `${prefix}${String(g).padStart(3, "0")}.mp4`;
    if (await fs.access(f).then(() => true, () => false)) out.set(g, f);
  }
  return out;
}
