/**
 * Text helpers for speech, safe in the browser: emotion tags in a script, and captions (SRT, WebVTT, plain text)
 * from timed lines.
 */

/** A line heard by speech-to-text: seconds from the start, and its words. */
export interface TimedText {
  start: number;
  end: number | null;
  text: string;
}

/**
 * Emotion tags people can put in a script, e.g. "[whispers] Don't turn around. [excited] It's here!". A tag sets
 * how the following words are read, until the next tag. `exaggeration` and `cfg` go to the speech engine
 * (Chatterbox: more exaggeration is more emotional; a lower cfg is faster and looser), `gain` scales the loudness,
 * and `pause` adds silence in seconds.
 */
export const EMOTION_TAGS: Record<string, { label: string; exaggeration?: number; cfg?: number; gain?: number; pause?: number }> = {
  neutral: { label: "Back to normal", exaggeration: 0.5, cfg: 0.5, gain: 1 },
  calm: { label: "Calm, slow", exaggeration: 0.35, cfg: 0.6, gain: 0.95 },
  whispers: { label: "Whispered", exaggeration: 0.3, cfg: 0.6, gain: 0.5 },
  sad: { label: "Sad", exaggeration: 0.4, cfg: 0.6, gain: 0.85 },
  happy: { label: "Happy, warm", exaggeration: 0.75, cfg: 0.45, gain: 1 },
  excited: { label: "Excited, fast", exaggeration: 1.0, cfg: 0.3, gain: 1.05 },
  angry: { label: "Angry", exaggeration: 1.2, cfg: 0.3, gain: 1.1 },
  shouts: { label: "Shouting", exaggeration: 1.4, cfg: 0.3, gain: 1.15 },
  dramatic: { label: "Dramatic", exaggeration: 0.9, cfg: 0.5, gain: 1 },
  pause: { label: "Short pause (0.6 s)", pause: 0.6 },
  "long pause": { label: "Long pause (1.5 s)", pause: 1.5 },
};
const ALIASES: Record<string, string> = { whisper: "whispers", whispering: "whispers", shout: "shouts", shouting: "shouts", yells: "shouts", cheerful: "happy", laughs: "happy", normal: "neutral", sighs: "sad", "short pause": "pause" };

export interface ScriptPart {
  text: string;
  exaggeration: number;
  cfg: number;
  gain: number;
  /** Silence before the words, in seconds. */
  pause: number;
}

/** Splits a script at its emotion tags. Unknown tags are dropped, so they're never read out. */
export function parseScript(script: string): ScriptPart[] {
  const parts: ScriptPart[] = [];
  let style = { exaggeration: 0.5, cfg: 0.5, gain: 1 };
  let pause = 0;
  for (const piece of script.split(/(\[[^\]\n]{1,24}\])/)) {
    const tag = piece.match(/^\[([^\]]+)\]$/);
    if (tag) {
      const name = tag[1].trim().toLowerCase();
      const t = EMOTION_TAGS[ALIASES[name] ?? name];
      if (t?.pause) pause += t.pause;
      else if (t) style = { exaggeration: t.exaggeration ?? 0.5, cfg: t.cfg ?? 0.5, gain: t.gain ?? 1 };
      continue;
    }
    const text = piece.replace(/\s+/g, " ").trim();
    if (!text) continue;
    parts.push({ text, ...style, pause });
    pause = 0;
  }
  if (pause && parts.length) parts.push({ text: "", ...style, pause });
  return parts;
}

/** The script without its tags (for voices that can't act them). */
export const stripTags = (script: string) =>
  parseScript(script)
    .map((p) => p.text)
    .filter(Boolean)
    .join(" ");

const clock = (s: number, sep: "," | ".") => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}${sep}${pad(ms % 1000, 3)}`;
};

/** Each line's end: its own, else the next line's start, else 3 seconds on. */
function ends(lines: TimedText[]) {
  return lines.map((l, i) => ({ ...l, text: l.text.trim(), end: l.end ?? Math.min(l.start + 6, lines[i + 1]?.start ?? l.start + 3) }));
}

export function toSrt(lines: TimedText[]) {
  return ends(lines)
    .filter((l) => l.text)
    .map((l, i) => `${i + 1}\n${clock(l.start, ",")} --> ${clock(l.end, ",")}\n${l.text}\n`)
    .join("\n");
}

export function toVtt(lines: TimedText[]) {
  return `WEBVTT\n\n${ends(lines)
    .filter((l) => l.text)
    .map((l) => `${clock(l.start, ".")} --> ${clock(l.end, ".")}\n${l.text}\n`)
    .join("\n")}`;
}

export function toTxt(lines: TimedText[], timestamps = false) {
  return lines
    .filter((l) => l.text.trim())
    .map((l) => (timestamps ? `[${clock(l.start, ".").slice(0, 8)}] ${l.text.trim()}` : l.text.trim()))
    .join("\n");
}

/** Splits long timed lines into caption-sized pieces (about `max` characters), sharing the time by length. */
export function captionLines(lines: TimedText[], max = 42): TimedText[] {
  const out: TimedText[] = [];
  for (const l of ends(lines)) {
    const words = l.text.split(/\s+/).filter(Boolean);
    const groups: string[] = [];
    let cur = "";
    for (const w of words) {
      if (cur && (cur + " " + w).length > max) {
        groups.push(cur);
        cur = w;
      } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) groups.push(cur);
    const total = groups.reduce((n, g) => n + g.length, 0) || 1;
    let t = l.start;
    for (const g of groups) {
      const d = ((l.end - l.start) * g.length) / total;
      out.push({ start: t, end: t + d, text: g });
      t += d;
    }
  }
  return out;
}
