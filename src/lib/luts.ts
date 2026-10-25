/**
 * Ghost Post LUTs: color grades as standard .cube files (33×33×33) that open in Premiere Pro, DaVinci Resolve,
 * Final Cut Pro, CapCut and phone editors. Each grade is a small, readable color formula, so the same code builds
 * the downloadable file and the live preview in the browser. Written for Rec.709 footage (what phones and most
 * cameras record).
 */
export type Rgb = [number, number, number];

export interface Grade {
  id: string;
  name: string;
  blurb: string;
  group: "Cinematic" | "Film" | "Mood" | "Black & white" | "Social";
  /** Lift (shadows), gamma (mids) and gain (highlights) per channel. */
  lift?: Rgb;
  gamma?: Rgb;
  gain?: Rgb;
  /** 1 = unchanged. */
  saturation?: number;
  /** S-curve strength, 0 = none. */
  contrast?: number;
  /** Tint added to the shadows and to the highlights (split toning). */
  shadows?: Rgb;
  highlights?: Rgb;
  /** Lifted blacks / rolled-off whites, like film stock (0..0.15). */
  fade?: number;
  /** Turn skin-adjacent oranges and cool blues apart (the "teal and orange" look), 0..1. */
  tealOrange?: number;
  mono?: boolean;
}

export const GRADES: Grade[] = [
  { id: "teal-orange", name: "Teal & Orange", blurb: "The blockbuster look: warm skin, cool shadows", group: "Cinematic", tealOrange: 0.55, contrast: 0.25, saturation: 1.05, shadows: [-0.03, 0.01, 0.04] },
  { id: "noir-crime", name: "Crime Drama", blurb: "Cold, green-steel night tones", group: "Cinematic", gamma: [0.97, 1.02, 1.0], saturation: 0.75, contrast: 0.35, shadows: [-0.02, 0.02, 0.03], highlights: [0.02, 0.03, 0.0] },
  { id: "golden-hour", name: "Golden Hour", blurb: "Low sun warmth on everything", group: "Cinematic", gain: [1.06, 1.0, 0.9], lift: [0.02, 0.01, -0.01], saturation: 1.1, contrast: 0.15, highlights: [0.04, 0.02, -0.02] },
  { id: "blockbuster-cool", name: "Moonlight", blurb: "Blue night exterior", group: "Cinematic", gain: [0.9, 0.97, 1.08], saturation: 0.85, contrast: 0.3, shadows: [-0.02, 0.0, 0.05] },
  { id: "bleach-bypass", name: "Bleach Bypass", blurb: "Gritty, silver, low color", group: "Film", saturation: 0.45, contrast: 0.55, fade: 0.02 },
  { id: "kodak-warm", name: "Warm Film Stock", blurb: "Soft rolloff, creamy skin", group: "Film", lift: [0.03, 0.02, 0.01], gain: [1.02, 0.99, 0.94], fade: 0.06, contrast: 0.1, saturation: 0.95 },
  { id: "fuji-green", name: "Cool Film Stock", blurb: "Green-cyan shadows, clean whites", group: "Film", shadows: [-0.02, 0.03, 0.02], fade: 0.05, saturation: 0.92, contrast: 0.12 },
  { id: "vintage-70s", name: "70s Vintage", blurb: "Faded, yellowed, nostalgic", group: "Film", fade: 0.12, gain: [1.04, 1.0, 0.85], saturation: 0.8, highlights: [0.04, 0.03, -0.03] },
  { id: "moody-dark", name: "Moody Dark", blurb: "Deep blacks, muted color", group: "Mood", gamma: [0.92, 0.92, 0.92], saturation: 0.7, contrast: 0.3, shadows: [0.0, 0.0, 0.02] },
  { id: "dreamy", name: "Dreamy Pastel", blurb: "Soft, bright, airy", group: "Mood", lift: [0.05, 0.04, 0.06], gamma: [1.08, 1.06, 1.08], saturation: 0.85, contrast: -0.1, highlights: [0.02, 0.0, 0.03] },
  { id: "matrix", name: "Code Green", blurb: "Sickly green, tech thriller", group: "Mood", gain: [0.9, 1.05, 0.88], saturation: 0.8, contrast: 0.3 },
  { id: "noir", name: "Film Noir", blurb: "High-contrast black and white", group: "Black & white", mono: true, contrast: 0.5 },
  { id: "silver", name: "Soft Silver", blurb: "Gentle black and white", group: "Black & white", mono: true, contrast: 0.1, fade: 0.05 },
  { id: "sepia", name: "Sepia", blurb: "Old photograph brown", group: "Black & white", mono: true, contrast: 0.15, highlights: [0.06, 0.03, -0.03], shadows: [0.03, 0.01, -0.02], fade: 0.04 },
  { id: "vivid", name: "Vivid Pop", blurb: "Punchy color for social feeds", group: "Social", saturation: 1.3, contrast: 0.2 },
  { id: "clean-bright", name: "Clean & Bright", blurb: "Lifestyle, beauty, food", group: "Social", gamma: [1.06, 1.06, 1.05], saturation: 1.08, contrast: 0.05, highlights: [0.01, 0.01, 0.0] },
];

const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** One color through a grade (all values 0..1). */
export function gradePixel(g: Grade, [r, gr, b]: Rgb): Rgb {
  let c: Rgb = [r, gr, b];
  // Lift / gamma / gain.
  c = c.map((v, i) => {
    const lift = g.lift?.[i] ?? 0;
    const gain = g.gain?.[i] ?? 1;
    const gamma = g.gamma?.[i] ?? 1;
    const x = clamp(v * (gain - lift) + lift);
    return Math.pow(x, 1 / gamma);
  }) as Rgb;
  if (g.tealOrange) {
    // Push warm hues toward orange and everything cool toward teal, weighted by how colorful the pixel already is.
    const warm = clamp((c[0] - c[2]) * 2);
    const k = g.tealOrange;
    c = [c[0] + k * 0.08 * warm - k * 0.06 * (1 - warm), c[1] + k * 0.02 * warm + k * 0.03 * (1 - warm), c[2] - k * 0.08 * warm + k * 0.07 * (1 - warm)];
  }
  let y = luma(...c);
  if (g.mono) c = [y, y, y];
  // Saturation around luma.
  const s = g.mono ? 1 : (g.saturation ?? 1);
  c = c.map((v) => y + (v - y) * s) as Rgb;
  // Contrast S-curve around mid grey.
  if (g.contrast) {
    const k = g.contrast;
    c = c.map((v) => {
      const x = clamp(v);
      const sCurve = x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
      return x + (sCurve - x) * k * 2;
    }) as Rgb;
  }
  // Split toning: tint shadows and highlights by brightness.
  y = luma(...c);
  if (g.shadows) c = c.map((v, i) => v + g.shadows![i] * (1 - y) * (1 - y)) as Rgb;
  if (g.highlights) c = c.map((v, i) => v + g.highlights![i] * y * y) as Rgb;
  // Film fade: lift the blacks and roll off the whites.
  if (g.fade) c = c.map((v) => g.fade! + clamp(v) * (1 - g.fade! * 1.6)) as Rgb;
  return c.map(clamp) as Rgb;
}

/** The grade as an Adobe/Resolve .cube file (red changes fastest, as the format requires). */
export function cubeFile(g: Grade, size = 33): string {
  const lines = [`TITLE "Ghost Post - ${g.name}"`, `# ${g.blurb}. Made by Ghost Post for Rec.709 footage.`, `LUT_3D_SIZE ${size}`, "DOMAIN_MIN 0.0 0.0 0.0", "DOMAIN_MAX 1.0 1.0 1.0"];
  for (let bi = 0; bi < size; bi++)
    for (let gi = 0; gi < size; gi++)
      for (let ri = 0; ri < size; ri++) {
        const o = gradePixel(g, [ri / (size - 1), gi / (size - 1), bi / (size - 1)]);
        lines.push(o.map((v) => v.toFixed(6)).join(" "));
      }
  return lines.join("\n") + "\n";
}

export const gradeById = (id: string) => GRADES.find((g) => g.id === id);
