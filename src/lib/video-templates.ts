import "server-only";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { db } from "./db";
import { readFile, storeFile } from "./media";
import { runCmd } from "./render";
import type { MediaItem } from "./types";
import { TEMPLATE_DEFS, type TemplateBackground, type TemplateInput } from "./template-defs";

/**
 * Video templates: titles, lower thirds, end screens, quotes, countdowns, promos and episode cards, filled in with
 * your words and colors and rendered on Ghost Post's server by ffmpeg (no AI, no credits). On a color, a picture or
 * a video of yours as an MP4, or with a see-through background as a ProRes 4444 .mov to lay over footage in Premiere,
 * Resolve, Final Cut or CapCut.
 */
export { TEMPLATE_DEFS };
const FONTS = path.join(process.cwd(), "assets", "fonts");
const FONT = { bebas: path.join(FONTS, "BebasNeue-Regular.ttf"), cinzel: path.join(FONTS, "Cinzel-Variable.ttf"), poppins: path.join(FONTS, "Poppins-Bold.ttf") };

export function sizeFor(aspect: string): [number, number] {
  return aspect === "16:9" ? [1920, 1080] : aspect === "1:1" ? [1080, 1080] : [1080, 1920];
}

/** Breaks text into lines of at most `max` characters (whole words). */
export function wrap(text: string, max: number): string {
  const lines: string[] = [];
  for (const para of text.split(/\n/)) {
    let cur = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      if (cur && (cur + " " + w).length > max) {
        lines.push(cur);
        cur = w;
      } else cur = cur ? `${cur} ${w}` : w;
    }
    lines.push(cur);
  }
  return lines.join("\n").trim();
}

const hex = (c: string | undefined, fallback: string) => (/^#?[0-9a-fA-F]{6}$/.test(c ?? "") ? `0x${c!.replace("#", "")}` : fallback);
/** Fades in from `a` over `d` seconds and out over the last `o` seconds of `total`. */
const fade = (a: number, d: number, total: number, o = 0.5) => `'min(1,max(0,(t-${a})/${d}))*min(1,max(0,(${total}-t)/${o}))'`;
/** Rises `px` pixels into place from `a` over `d` seconds (ease out). */
const rise = (y: string, a: number, d: number, px: number) => `'${y}+${px}*pow(1-min(1,max(0,(t-${a})/${d})),3)'`;

export interface TemplateRender {
  filter: string;
  seconds: number;
  /** Text files to write before running (path → contents). */
  files: Record<string, string>;
}

/** The drawing for one template (without the background), in a work folder `dir`. Exported for tests. */
export function templateFilter(o: TemplateInput, W: number, H: number, dir: string): TemplateRender {
  const def = TEMPLATE_DEFS.find((t) => t.id === o.template);
  if (!def) throw new Error("Choose a template.");
  const v = (k: string) => String(o.values?.[k] ?? def.fields.find((f) => f.key === k)?.example ?? "").slice(0, def.fields.find((f) => f.key === k)?.max ?? 120);
  const accent = hex(o.accent, "0x36e2b4");
  const ink = hex(o.textColor, "0xffffff");
  const T = def.seconds;
  const files: Record<string, string> = {};
  const P = W <= H; // portrait or square: shorter lines
  const u = Math.min(W, H) / 1080; // scale against a 1080 frame
  let n = 0;
  const text = (s: string, font: keyof typeof FONT, size: number, color: string, x: string, y: string, alpha: string, extra = "") => {
    const f = path.join(dir, `t${n++}.txt`);
    files[f] = s;
    return `drawtext=fontfile='${FONT[font]}':textfile='${f}':expansion=none:fontsize=${Math.round(size)}:fontcolor=${color}:line_spacing=${Math.round(size * 0.15)}:text_align=C:x=${x}:y=${y}:alpha=${alpha}${extra}`;
  };
  const shadow = ":shadowcolor=black@0.55:shadowx=3:shadowy=3";
  const parts: string[] = [];
  switch (def.id) {
    case "title": {
      parts.push(text(wrap(v("title").toUpperCase(), P ? 14 : 24), "bebas", 170 * u, ink, "(w-text_w)/2", rise("(h-text_h)/2-60", 0.2, 0.7, 60), fade(0.2, 0.5, T), shadow));
      parts.push(`drawbox=x=(iw-${Math.round(220 * u)})/2:y=ih/2+${Math.round(50 * u)}:w='${Math.round(220 * u)}*min(1,max(0,(t-0.6)/0.5))':h=${Math.round(8 * u)}:color=${accent}:t=fill:enable='lt(t,${T - 0.4})'`);
      parts.push(text(wrap(v("subtitle"), P ? 30 : 50), "poppins", 48 * u, accent, "(w-text_w)/2", `h/2+${Math.round(90 * u)}`, fade(0.9, 0.5, T), shadow));
      break;
    }
    case "lower-third": {
      const x0 = Math.round(80 * u);
      const y0 = Math.round(H - (P ? 520 : 300) * u);
      parts.push(`drawbox=x=${x0}:y=${y0}:w='${Math.round(14 * u)}':h=${Math.round(150 * u)}:color=${accent}:t=fill:enable='between(t,0.15,${T - 0.3})'`);
      parts.push(`drawbox=x=${x0 + Math.round(14 * u)}:y=${y0}:w='${Math.round((P ? 820 : 900) * u)}*min(1,max(0,(t-0.2)/0.45))*min(1,max(0,(${T}-t)/0.35))':h=${Math.round(150 * u)}:color=black@0.55:t=fill`);
      parts.push(text(v("name"), "poppins", 58 * u, ink, `'${x0 + 44 * u}-40*pow(1-min(1,max(0,(t-0.45)/0.5)),3)'`, String(y0 + 18 * u), fade(0.45, 0.4, T, 0.3)).replace("text_align=C", "text_align=L"));
      parts.push(text(v("role"), "poppins", 36 * u, accent, `'${x0 + 44 * u}-40*pow(1-min(1,max(0,(t-0.65)/0.5)),3)'`, String(y0 + 92 * u), fade(0.65, 0.4, T, 0.3)).replace("text_align=C", "text_align=L"));
      break;
    }
    case "end-screen": {
      parts.push(text(wrap(v("headline").toUpperCase(), P ? 14 : 26), "bebas", 140 * u, ink, "(w-text_w)/2", rise("h*0.32", 0.1, 0.6, 50), fade(0.1, 0.4, T), shadow));
      const bw = Math.round((P ? 760 : 820) * u);
      const bh = Math.round(120 * u);
      parts.push(`drawbox=x=(iw-${bw})/2:y=ih*0.52:w=${bw}:h=${bh}:color=${accent}@0.95:t=fill:enable='between(t,0.6,${T - 0.3})'`);
      parts.push(text(v("handle"), "poppins", 58 * u, "0x0b0b10", "(w-text_w)/2", `h*0.52+${Math.round((bh - 58 * u * 1.1) / 2)}`, fade(0.75, 0.3, T, 0.3)));
      parts.push(text(wrap(v("cta"), P ? 32 : 60), "poppins", 40 * u, ink, "(w-text_w)/2", `h*0.52+${bh + Math.round(40 * u)}`, fade(1.0, 0.4, T), shadow));
      break;
    }
    case "quote": {
      parts.push(text("“", "cinzel", 260 * u, accent, "(w-text_w)/2", "h*0.16", fade(0.1, 0.5, T)));
      parts.push(text(wrap(v("quote"), P ? 24 : 40), "cinzel", 64 * u, ink, "(w-text_w)/2", rise("h*0.34", 0.3, 0.8, 30), fade(0.3, 0.8, T), shadow));
      parts.push(text(`— ${v("author")}`, "poppins", 40 * u, accent, "(w-text_w)/2", "h*0.74", fade(1.2, 0.6, T)));
      break;
    }
    case "countdown": {
      for (const [i, num] of ["3", "2", "1"].entries()) {
        const a = i;
        parts.push(text(num, "bebas", 520 * u, ink, "(w-text_w)/2", "(h-text_h)/2", `'min(1,max(0,(t-${a})/0.12))*min(1,max(0,(${a + 1}-t)/0.2))'`, `${shadow}:enable='between(t,${a},${a + 1})'`));
      }
      parts.push(`drawbox=x=0:y=ih-${Math.round(16 * u)}:w='iw*t/${T}':h=${Math.round(16 * u)}:color=${accent}:t=fill`);
      break;
    }
    case "promo": {
      parts.push(text(wrap(v("headline").toUpperCase(), P ? 13 : 24), "bebas", 150 * u, ink, "(w-text_w)/2", rise("h*0.24", 0.1, 0.6, 60), fade(0.1, 0.4, T), shadow));
      const bw = Math.round((P ? 700 : 760) * u);
      const bh = Math.round(170 * u);
      parts.push(`drawbox=x=(iw-${bw})/2:y=ih*0.5:w=${bw}:h=${bh}:color=${accent}:t=fill:enable='between(t,0.5,${T - 0.3})'`);
      parts.push(text(v("offer"), "bebas", 120 * u, "0x0b0b10", "(w-text_w)/2", `h*0.5+${Math.round((bh - 120 * u) / 2)}`, fade(0.6, 0.25, T, 0.3)));
      parts.push(text(wrap(v("cta"), P ? 30 : 56), "poppins", 46 * u, ink, "(w-text_w)/2", `h*0.5+${bh + Math.round(50 * u)}`, `'${"min(1,max(0,(t-1.0)/0.3))"}*(0.75+0.25*sin(t*6))*min(1,max(0,(${T}-t)/0.4))'`, shadow));
      break;
    }
    case "episode": {
      parts.push(text(v("series").toUpperCase(), "cinzel", 92 * u, ink, "(w-text_w)/2", "h/2-text_h-30", fade(0.3, 0.8, T, 0.6), shadow));
      parts.push(text(v("episode").toUpperCase(), "bebas", 130 * u, accent, "(w-text_w)/2", "h/2+30", fade(1.0, 0.6, T, 0.6), shadow));
      parts.push(text(wrap(v("tagline"), P ? 32 : 60), "poppins", 36 * u, ink, "(w-text_w)/2", `h/2+${Math.round(200 * u)}`, fade(1.6, 0.6, T, 0.6)));
      break;
    }
  }
  return { filter: parts.join(","), seconds: T, files };
}

/** Renders a template into the Media Library. */
export async function renderTemplate(userId: string, o: TemplateInput): Promise<MediaItem> {
  const [W, H] = sizeFor(o.aspect);
  const bg: TemplateBackground = o.background ?? { type: "color", color: "#0b0b10" };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ghost-post-tpl-"));
  try {
    const r = templateFilter(o, W, H, dir);
    for (const [f, s] of Object.entries(r.files)) await fs.writeFile(f, s);
    const T = r.seconds.toFixed(2);
    const input: string[] = [];
    let base: string;
    if (bg.type === "transparent") {
      input.push("-f", "lavfi", "-i", `color=c=black@0.0:s=${W}x${H}:r=30:d=${T},format=rgba`);
      base = "[0:v]format=rgba";
    } else if (bg.type === "media") {
      const m = await db().get<MediaItem>("media", bg.mediaId);
      if (!m || (m.kind !== "image" && m.kind !== "video")) throw new Error("Choose a picture or video from your Media Library for the background.");
      const f = path.join(dir, `bg.${m.storagePath.split(".").pop()}`);
      await fs.writeFile(f, await readFile(m));
      input.push(...(m.kind === "image" ? ["-loop", "1", "-t", T, "-i", f] : ["-stream_loop", "-1", "-t", T, "-i", f]));
      base = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30,eq=brightness=-0.08:saturation=0.9`;
    } else {
      input.push("-f", "lavfi", "-i", `color=c=${hex(bg.color, "0x0b0b10")}:s=${W}x${H}:r=30:d=${T}`);
      base = "[0:v]null";
    }
    const transparent = bg.type === "transparent";
    const out = path.join(dir, transparent ? "out.mov" : "out.mp4");
    const enc = transparent
      ? ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-vendor", "apl0"]
      : ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart"];
    await runCmd("ffmpeg", ["-hide_banner", "-y", ...input, "-filter_complex", `${base},${r.filter}[v]`, "-map", "[v]", "-t", T, "-an", ...enc, out], 5 * 60_000);
    const def = TEMPLATE_DEFS.find((t) => t.id === o.template)!;
    return storeFile(userId, { name: `template-${def.id}-${o.aspect.replace(":", "x")}${transparent ? "-overlay.mov" : ".mp4"}`, type: transparent ? "video/quicktime" : "video/mp4", bytes: await fs.readFile(out) }, { uncapped: true });
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
