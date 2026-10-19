import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";

/**
 * Ghost Post's own motion graphics, drawn by ffmpeg on the server (free, no AI service): a moving gradient, a
 * scrolling dot grid, a drifting glow, a ring, a light bar sweeping across, a big faded scene number, and the
 * scene's on-screen words with an accent underline that wipes in. Each scene rotates through the palettes.
 * The shapes are drawn once per render as transparent PNGs and animated as overlays, so a scene renders about as
 * fast as a plain background.
 */
export const MOTION_PALETTES: { bg: [string, string]; accent: string; accent2: string }[] = [
  { bg: ["0x0b1026", "0x24357a"], accent: "0x36e2b4", accent2: "0xffc857" },
  { bg: ["0x1a0b26", "0x5a1f78"], accent: "0xff5c8a", accent2: "0x7ad7ff" },
  { bg: ["0x061a1c", "0x0f5a5a"], accent: "0xffc857", accent2: "0x36e2b4" },
  { bg: ["0x1f0e08", "0x6a2a12"], accent: "0xffb347", accent2: "0xffffff" },
];

const rgb = (hex: string) => {
  const n = parseInt(hex.replace(/^0x|^#/, ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

export type MotionShapes = { dots: string; glow: string; ring: string; bar: string; underline: string };

const sizes = (W: number, H: number) => {
  const step = Math.max(32, Math.round(W * 0.045));
  return {
    step,
    dot: Math.max(3, Math.round(step * 0.1)),
    G: Math.round(W * 0.95),
    R: Math.round(W * 0.46),
    ring: Math.max(4, Math.round(W * 0.006)),
    barW: Math.round(W * 0.8),
    barH: Math.max(8, Math.round(H * 0.012)),
    ulW: Math.round(W * 0.24),
    ulH: Math.max(6, Math.round(H * 0.007)),
  };
};

/** Draws one palette's shapes as transparent PNGs in `dir` (once per render and palette). */
export async function drawShapes(dir: string, W: number, H: number, paletteIndex: number): Promise<MotionShapes> {
  const k = paletteIndex % MOTION_PALETTES.length;
  const p = MOTION_PALETTES[k];
  const s = sizes(W, H);
  const file = (name: string) => path.join(dir, `mg${k}-${name}.png`);
  const out: MotionShapes = { dots: file("dots"), glow: file("glow"), ring: file("ring"), bar: file("bar"), underline: file("ul") };
  if (await fs.stat(out.underline).then(() => true, () => false)) return out;
  const geq = (color: string, w: number, h: number, alpha: string) => {
    const c = rgb(color);
    return `color=c=black:s=${w}x${h},format=rgba,geq=r=${c.r}:g=${c.g}:b=${c.b}:a='${alpha}'`;
  };
  const gR = s.G / 2, rR = s.R / 2;
  const jobs: [string, string][] = [
    [out.dots, geq("0xffffff", W, H + s.step, `58*lt(mod(X,${s.step}),${s.dot})*lt(mod(Y,${s.step}),${s.dot})`)],
    [out.glow, geq(p.accent, s.G, s.G, `120*pow(max(0,1-hypot(X-${gR},Y-${gR})/${gR}),2)`)],
    [out.ring, geq(p.accent2, s.R, s.R, `190*between(hypot(X-${rR},Y-${rR}),${rR - s.ring},${rR - 1})`)],
    [out.bar, `color=c=${p.accent2}@0.55:s=${s.barW}x${s.barH},format=rgba,rotate=-0.32:c=none:ow=rotw(-0.32):oh=roth(-0.32)`],
  ];
  await Promise.all(jobs.map(([f, src]) => promisify(execFile)("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", src, "-frames:v", "1", f], { timeout: 60_000 })));
  // Written last: its presence means the whole set is ready.
  await promisify(execFile)("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=${p.accent}:s=${s.ulW}x${s.ulH},format=rgba`, "-frames:v", "1", out.underline], { timeout: 60_000 });
  return out;
}

/** Input order the scene renderer passes after its visual [0] and audio [1]. */
export const SHAPE_INPUTS: (keyof MotionShapes)[] = ["dots", "glow", "ring", "bar", "underline"];

/**
 * Filter chains that animate input [0:v] (the scene's gradient) with the shape inputs [2]…[6] into label [mg].
 * `underlineY` puts the accent bar under the on-screen words (omit when there are none).
 */
export function motionGraph(o: { i: number; W: number; H: number; underlineY?: number }): string {
  const { i, W } = o;
  const s = sizes(W, o.H);
  const phase = (i * 1.7).toFixed(2);
  const ov = "eval=frame:shortest=1";
  const chains = [
    `[0:v]format=rgba[b0]`,
    `[b0][2:v]overlay=x=0:y='-mod(t*${Math.round(s.step * 0.6)},${s.step})':${ov}[b1]`,
    `[b1][3:v]overlay=x='W*0.62-w/2+W*0.10*sin(t*0.55+${phase})':y='H*0.24-h/2+H*0.05*cos(t*0.45+${phase})':${ov}[b2]`,
    `[b2][4:v]overlay=x='W*0.22-w/2+W*0.06*cos(t*0.7+${phase})':y='H*0.47-h/2+H*0.04*sin(t*0.6+${phase})':${ov}[b3]`,
    `[b3][5:v]overlay=x='W-mod(t*W*0.22+${(i * 0.37 * W).toFixed(0)},W+w*2)+w':y='H*0.38':${ov}[b4]`,
  ];
  if (o.underlineY !== undefined) chains.push(`[b4][6:v]overlay=x='(W-w)/2-W*pow(max(0,1-t/0.6),3)':y=${Math.round(o.underlineY)}:${ov}[mg]`);
  else chains.push(`[b4]null[mg]`);
  return chains.join(";");
}

/** Graphics art styles are drawn by the motion-graphics engine instead of AI pictures. */
export const isGraphicsLook = (look?: string) => !!look && /motion[- ]graphics|infographic|title[- ]sequence|graphic/i.test(look) && !/photo|realis/i.test(look);
