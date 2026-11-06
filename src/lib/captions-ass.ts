/**
 * Word-by-word animated captions, the way creator videos do them: 2–4 words at a time in a big bold font with a thick
 * outline, the word being spoken highlighted and popping in. Written as an ASS subtitle file that ffmpeg burns in
 * with libass (`subtitles=`), so the look is exact on every platform.
 *
 * Word timings: when the voice service gives them (ElevenLabs character timestamps) they are used as they are;
 * otherwise each word gets a share of the scene's spoken time by its syllables, with pauses at punctuation.
 */

export interface TimedWord {
  word: string;
  start: number;
  end: number;
}

const syllables = (w: string) => {
  const s = w.toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return /\d/.test(w) ? Math.max(1, w.replace(/\D/g, "").length) : 1;
  const groups = s.replace(/e$/, "").match(/[aeiouy]+/g);
  return Math.max(1, groups?.length ?? 1);
};

/** Spread `text` over [start, end] seconds: by syllables, with a short rest after commas and a longer one after a full stop. */
export function estimateWordTimes(text: string, start: number, end: number): TimedWord[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length || end <= start) return [];
  const weight = words.map((w) => syllables(w) + (/[.!?…]$/.test(w) ? 1.4 : /[,;:—–-]$/.test(w) ? 0.6 : 0));
  const total = weight.reduce((a, b) => a + b, 0);
  const span = end - start;
  let t = start;
  return words.map((w, i) => {
    const d = (span * weight[i]) / total;
    const pause = /[.!?…]$/.test(w) ? (span * 1.4) / total : /[,;:—–-]$/.test(w) ? (span * 0.6) / total : 0;
    const out = { word: w, start: t, end: t + d - pause * 0.9 };
    t += d;
    return out;
  });
}

/** Groups of 2–4 words that read as one beat: a new group after a sentence end, a comma (once 2+ words), or 4 words. */
export function groupWords(words: TimedWord[], max = 4): TimedWord[][] {
  const groups: TimedWord[][] = [];
  let cur: TimedWord[] = [];
  for (const w of words) {
    cur.push(w);
    const stop = /[.!?…]$/.test(w.word) || (/[,;:—–]$/.test(w.word) && cur.length >= 2) || cur.length >= max;
    if (stop) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) {
    // A lone last word joins the group before it, so no caption flashes a single word on its own.
    if (cur.length === 1 && groups.length && groups[groups.length - 1].length < max) groups[groups.length - 1].push(cur[0]);
    else groups.push(cur);
  }
  return groups;
}

const ts = (s: number) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
/** ASS text: braces start override blocks and backslashes are commands, so neither may come from the script. */
const esc = (s: string) => s.replace(/[{}\\]/g, "").replace(/\n/g, " ");

export interface AssStyle {
  W: number;
  H: number;
  /** Highlight for the spoken word, as RRGGBB. */
  accent?: string;
  /** Film look: smaller white subtitles low in the frame, no highlight pop. */
  film?: boolean;
}

/** ASS colour: &HAABBGGRR. */
const assColour = (rgb: string, alpha = 0) => `&H${alpha.toString(16).padStart(2, "0").toUpperCase()}${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}`.toUpperCase();

/** The whole subtitle file for one scene (times relative to the scene's start). */
export function assCaptions(words: TimedWord[], o: AssStyle): string {
  const portrait = o.H > o.W;
  const size = Math.round(o.W * (o.film ? (portrait ? 0.05 : 0.032) : portrait ? 0.088 : 0.05));
  const marginV = Math.round(o.H * (o.film ? 0.12 : portrait ? 0.27 : 0.14)); // clear of TikTok and Reels buttons
  const marginH = Math.round(o.W * 0.08);
  const accent = (o.accent ?? "FFE14D").replace(/^#/, "").toUpperCase();
  const outline = Math.max(2, Math.round(size * (o.film ? 0.06 : 0.11)));
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${o.W}`,
    `PlayResY: ${o.H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,Poppins,${size},${assColour("FFFFFF")},${assColour(accent)},${assColour("000000")},${assColour("000000", 0x80)},-1,0,0,0,100,100,0,0,1,${outline},${o.film ? 1 : 2},2,${marginH},${marginH},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const groups = groupWords(words);
  groups.forEach((g, gi) => {
    const gEnd = gi + 1 < groups.length ? groups[gi + 1][0].start : g[g.length - 1].end + 0.35;
    const text = (active: number) =>
      g
        .map((w, k) => {
          const word = esc(o.film ? w.word : w.word.toUpperCase());
          if (o.film || k !== active) return word;
          // The spoken word: accent colour, popping from 115% to 100%.
          return `{\\c${assColour(accent)}\\fscx115\\fscy115\\t(0,90,\\fscx100\\fscy100)}${word}{\\c${assColour("FFFFFF")}\\fscx100\\fscy100}`;
        })
        .join(" ");
    if (o.film) {
      lines.push(`Dialogue: 0,${ts(g[0].start)},${ts(gEnd)},Cap,,0,0,0,,{\\fad(80,80)}${text(-1)}`);
      return;
    }
    g.forEach((w, k) => {
      const end = k + 1 < g.length ? g[k + 1].start : gEnd;
      const pop = k === 0 ? "{\\fad(60,0)}" : "";
      lines.push(`Dialogue: 0,${ts(w.start)},${ts(Math.max(end, w.start + 0.05))},Cap,,0,0,0,,${pop}${text(k)}`);
    });
  });
  return lines.join("\n") + "\n";
}

/** ffmpeg's subtitles= filter argument for a file path (colons, commas, quotes and backslashes escaped). */
export function subtitlesFilter(file: string, fontsDir: string) {
  const q = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,");
  return `subtitles=filename='${q(file)}':fontsdir='${q(fontsDir)}'`;
}
