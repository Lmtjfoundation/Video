import { allShots, SHOT_MIN, type EpisodePlan, type EpisodeTransition, type Mood } from "./plan";

/**
 * The edit: where every shot, card and line sits, from the plan and the length of each recorded line. A line starts a
 * moment into the shot it belongs to (never over the line before it); a beat's shots stretch together to hold its
 * lines, each up to the longest clip the engine makes. Pure, so tests pin it down.
 */
export interface TimelineItem {
  kind: "shot" | "card";
  id?: string;
  text?: string;
  sub?: string;
  style?: "series" | "title" | "card" | "next";
  /** A card's way in (a shot's comes from its plan). */
  transition?: EpisodeTransition;
  start: number;
  dur: number;
  beat: string;
  mood: Mood;
}
export interface TimelineVoice {
  /** The shot whose line this is. */
  id: string;
  start: number;
  dur: number;
}
export interface Timeline {
  total: number;
  items: TimelineItem[];
  voices: TimelineVoice[];
  /** Each shot's length in the edit. */
  clips: Record<string, number>;
}

const GAP = 0.25; // between two lines
const TAIL = 0.45; // after a beat's last line, before the next beat
const LINE_OFFSET = 0.3; // into its shot
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function buildTimeline(plan: EpisodePlan, voiceSeconds: Record<string, number>, maxShot: number): Timeline {
  let t = 0;
  let lastVoiceEnd = 0;
  const items: TimelineItem[] = [];
  const voices: TimelineVoice[] = [];
  const clips: Record<string, number> = {};
  for (const b of plan.beats) {
    if (b.card) {
      items.push({ kind: "card", text: b.card.title, sub: b.card.sub, style: b.card.style, transition: b.card.transition, start: r3(t), dur: b.card.seconds, beat: b.name, mood: b.mood });
      t += b.card.seconds;
      continue;
    }
    const shots = b.shots ?? [];
    const base = shots.map((s) => s.seconds);
    const baseTotal = base.reduce((a, x) => a + x, 0);
    const starts = base.map((_, i) => t + base.slice(0, i).reduce((a, x) => a + x, 0));
    const placed: TimelineVoice[] = [];
    shots.forEach((s, i) => {
      const d = voiceSeconds[s.id];
      if (!s.line || !d) return;
      const st = Math.max(starts[i] + LINE_OFFSET, lastVoiceEnd + GAP);
      placed.push({ id: s.id, start: r3(st), dur: r3(d) });
      lastVoiceEnd = st + d;
    });
    const need = placed.length ? placed[placed.length - 1].start + placed[placed.length - 1].dur + TAIL - t : baseTotal;
    const total = Math.max(baseTotal, need);
    const lens = base.map((d) => Math.min(maxShot, Math.max(SHOT_MIN, Math.round(((d * total) / baseTotal) * 100) / 100)));
    shots.forEach((s, i) => {
      items.push({ kind: "shot", id: s.id, start: r3(t), dur: lens[i], beat: b.name, mood: b.mood });
      clips[s.id] = lens[i];
      t += lens[i];
    });
    voices.push(...placed);
  }
  return { total: r3(Math.max(t, lastVoiceEnd + TAIL)), items, voices, clips };
}

/**
 * Caption chunks for one line: whole sentences grouped up to about 11 words (never split at an ellipsis or after
 * "St."), a long sentence halved evenly. Each chunk is shown for its share of the line's time.
 */
export function captionChunks(text: string, maxWords = 11): string[] {
  const t = text.trim().replace(/\b(St|Mr|Mrs|Ms|Dr|Det)\. /g, "$1. ");
  const sentences = t.split(/(?<=[^.][.!?])[ \t\n]+/).filter(Boolean).map((x) => x.replace(/ /g, " "));
  const out: string[] = [];
  let cur: string[] = [];
  for (const sentence of sentences) {
    const ws = sentence.split(/\s+/).filter(Boolean);
    if (ws.length > maxWords + 2) {
      if (cur.length) out.push(cur.join(" "));
      cur = [];
      const n = Math.ceil(ws.length / maxWords);
      const k = Math.ceil(ws.length / n);
      for (let a = 0; a < ws.length; a += k) out.push(ws.slice(a, a + k).join(" "));
    } else if (cur.length + ws.length <= maxWords) {
      cur.push(...ws);
    } else {
      if (cur.length) out.push(cur.join(" "));
      cur = ws;
    }
  }
  if (cur.length) out.push(cur.join(" "));
  return out;
}

/** Timed captions for the whole episode, with the speaker's label (none for the narrator). */
export function captions(plan: EpisodePlan, tl: Timeline): { start: number; dur: number; speaker: string | null; text: string }[] {
  const byId = new Map(allShots(plan).map((s) => [s.id, s]));
  const out: { start: number; dur: number; speaker: string | null; text: string }[] = [];
  for (const v of tl.voices) {
    const line = byId.get(v.id)?.line;
    if (!line) continue;
    const speaker = line.speaker === "N" ? null : plan.cast.find((c) => c.key === line.speaker)?.label ?? null;
    const parts = captionChunks(line.text);
    const chars = parts.reduce((a, p) => a + p.length, 0) || 1;
    let at = v.start;
    for (const p of parts) {
      const dur = (v.dur * p.length) / chars;
      out.push({ start: r3(at), dur: r3(dur), speaker, text: p });
      at += dur;
    }
  }
  return out;
}
