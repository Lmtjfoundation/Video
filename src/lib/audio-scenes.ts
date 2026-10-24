/**
 * Audio to video: turns a transcript's timed lines into scenes that follow the audio. Pure, so it is shared by the
 * server and tests. Cuts cover the whole recording with no gaps (pauses and music stay with the scene around them),
 * and every boundary sits on a video frame so the picture can never drift from the sound.
 */

export interface TimedLine {
  start: number;
  /** null when the transcriber didn't close the last line. */
  end: number | null;
  text: string;
}

export interface AudioCut {
  start: number;
  end: number;
  /** What is said during this scene ("" for music or silence). */
  text: string;
}

/** Longest recording Audio to video takes (10 minutes, the longest video Ghost Post makes). */
export const MAX_AUDIO_SECONDS = 600;

const FRAME = 1 / 30;
const snap = (t: number) => Math.round(t / FRAME) * FRAME;
const r3 = (t: number) => Math.round(t * 1000) / 1000;
const words = (s: string) => s.split(/\s+/).filter(Boolean);

/** A new picture about every `target` seconds: 4.5 s for short clips, longer for long recordings (at most ~70 scenes). */
export function sceneTarget(total: number) {
  return Math.min(9, Math.max(4.5, total / 70));
}

/** Splits a stretch with no words into scenes of about `target` seconds. */
function silent(start: number, end: number, target: number): AudioCut[] {
  const n = Math.max(1, Math.round((end - start) / target));
  return Array.from({ length: n }, (_, i) => ({ start: start + ((end - start) * i) / n, end: start + ((end - start) * (i + 1)) / n, text: "" }));
}

export function audioCuts(lines: TimedLine[], total: number): AudioCut[] {
  if (!(total > 0)) return [];
  const target = sceneTarget(total);
  const max = target * 1.6;

  // 1. Clean the transcriber's lines: in order, inside the recording, a real end, no empty text.
  const sorted = lines
    .map((l) => ({ start: Math.max(0, Math.min(total, Number(l.start) || 0)), end: l.end, text: String(l.text ?? "").replace(/\s+/g, " ").trim() }))
    .filter((l) => l.text)
    .sort((a, b) => a.start - b.start);
  const clean: AudioCut[] = sorted.map((l, i) => {
    const next = sorted[i + 1]?.start ?? total;
    const end = l.end == null || !Number.isFinite(l.end) ? next : Math.min(total, Math.max(l.start, l.end));
    return { start: l.start, end: Math.max(end, l.start), text: l.text };
  });

  // 2. A long line becomes several scenes, its words shared out in proportion.
  const pieces: AudioCut[] = [];
  for (const l of clean) {
    const dur = l.end - l.start;
    const w = words(l.text);
    const n = Math.min(Math.max(1, Math.ceil(dur / max)), Math.max(1, w.length));
    for (let k = 0; k < n; k++) {
      pieces.push({
        start: l.start + (dur * k) / n,
        end: l.start + (dur * (k + 1)) / n,
        text: w.slice(Math.round((w.length * k) / n), Math.round((w.length * (k + 1)) / n)).join(" "),
      });
    }
  }

  // 3. Short lines join their neighbours until a scene is about `target` long (never past `max`).
  const merged: AudioCut[] = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last && last.end - last.start < target && p.end - last.start <= max && p.start - last.end < 1.5) {
      last.end = p.end;
      last.text = `${last.text} ${p.text}`.trim();
    } else merged.push({ ...p });
  }

  // 4. Cover the whole recording: long stretches without words get their own scenes; short pauses stay with
  //    the scene before them (or the first scene, for a short intro).
  const cuts: AudioCut[] = [];
  let at = 0;
  for (const m of merged) {
    if (m.start - at > max) {
      cuts.push(...silent(at, m.start, target));
      at = m.start;
    }
    if (cuts.length) cuts[cuts.length - 1].end = m.start;
    cuts.push({ start: cuts.length ? m.start : 0, end: m.end, text: m.text });
    at = m.end;
  }
  if (total - at > max) cuts.push(...silent(at, total, target));
  else if (cuts.length) cuts[cuts.length - 1].end = total;
  if (!cuts.length) cuts.push(...silent(0, total, target));

  // 5. Boundaries on video frames; drop any scene that snapping left too short to see (its words go to the next).
  const out: AudioCut[] = [];
  let carry = "";
  for (const [i, c] of cuts.entries()) {
    const start = out.length ? out[out.length - 1].end : 0;
    const end = i === cuts.length - 1 ? r3(total) : r3(snap(c.end));
    const text = `${carry} ${c.text}`.trim();
    if (end - start < 0.5 && i < cuts.length - 1) {
      carry = text;
      continue;
    }
    if (end - start < 0.5 && out.length) {
      out[out.length - 1].end = end;
      out[out.length - 1].text = `${out[out.length - 1].text} ${text}`.trim();
    } else out.push({ start: r3(start), end, text });
    carry = "";
  }
  return out;
}

/** The video length that fits a recording, or null when it is too long. */
export function lengthForSeconds(total: number, landscape: boolean): "s30" | "s60" | "s90" | "m3" | "m10" | "long" | null {
  if (total > MAX_AUDIO_SECONDS + 0.5) return null;
  if (landscape) return "long";
  return total <= 35 ? "s30" : total <= 60 ? "s60" : total <= 90 ? "s90" : total <= 180 ? "m3" : "m10";
}
