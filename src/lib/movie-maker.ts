/**
 * Movie Maker: a scene plan (pasted in the "VIDEO PLAN" format or written scene by scene) becomes a movie-style
 * short. Each scene's picture is animated by Curbflix's motion engine (scripts/movie-motion/engine.py): a 2.5D
 * depth camera, effects (fog, frost, glass shatter, ghost mist…), a colour grade, film grain, cinema bars and kinetic
 * titles. It all runs on Curbflix's own server: no outside video service.
 *
 * This file has the parts that are pure (parsing, defaults, the engine's film spec), so they are tested without a
 * server; the render job is in movie-maker-render.ts.
 */

export const MOVES = ["push_in", "pull_back", "tilt_up", "crane_down", "dolly", "circle", "track", "crash_zoom", "handheld", "static"] as const;
export type Move = (typeof MOVES)[number];
export const MOVE_LABELS: Record<Move, string> = {
  push_in: "Push in",
  pull_back: "Pull back",
  tilt_up: "Tilt up",
  crane_down: "Crane down",
  dolly: "Dolly forward",
  circle: "Circle",
  track: "Tracking",
  crash_zoom: "Crash zoom",
  handheld: "Handheld",
  static: "Static",
};

export const EFFECTS = ["fog", "dust", "beam", "frost", "flicker", "shake", "quake", "rain", "shatter", "bubbles", "ghost", "salt", "steam", "embers", "glow", "whip_in", "flash_in", "leak_in"] as const;
export type Effect = (typeof EFFECTS)[number];
export const EFFECT_LABELS: Record<Effect, string> = {
  fog: "Fog",
  dust: "Dust",
  beam: "Light beam",
  frost: "Frost",
  flicker: "Flicker",
  shake: "Shake",
  quake: "Earthquake",
  rain: "Rain",
  shatter: "Glass shatter",
  bubbles: "Bubbles",
  ghost: "Ghost mist",
  salt: "Falling salt",
  steam: "Steam",
  embers: "Sparks",
  glow: "Glow",
  whip_in: "Whip-pan in",
  flash_in: "Flash in",
  leak_in: "Light leak in",
};

export const FRAMES = ["letterbox", "full", "open"] as const;
export type Frame = (typeof FRAMES)[number];
export const FRAME_LABELS: Record<Frame, string> = { letterbox: "Cinema bars", full: "Full frame", open: "Bars open up" };

export const TITLE_STYLES = ["slam", "type", "whisper"] as const;
export type TitleStyle = (typeof TITLE_STYLES)[number];
export const TITLE_LABELS: Record<TitleStyle, string> = { slam: "Slam", type: "Bold", whisper: "Whisper" };

export const GRADES = ["cadmium_purple", "teal_orange", "noir", "warm", "none"] as const;
export type Grade = (typeof GRADES)[number];
export const GRADE_LABELS: Record<Grade, string> = { cadmium_purple: "Cadmium & purple", teal_orange: "Teal & orange", noir: "Noir (black & white)", warm: "Warm film", none: "No grade" };

export interface MovieScene {
  narration: string;
  onScreen: string;
  visual: string;
  edit: string;
  sfx: string;
  seconds: number;
  move: Move;
  effects: Effect[];
  frame: Frame;
  titleStyle: TitleStyle;
  /** A picture from the library to use instead of making one. */
  mediaId?: string;
}

export interface MoviePlan {
  title: string;
  look: string;
  voice: string;
  music: string;
  caption: string;
  scenes: MovieScene[];
}

/** Up to 1 h 30 min at about 10 seconds a scene (long movies are filmed in chapters). */
export const MAX_SCENES = 540;
const clip = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);

/** The camera move an "Edit:" line asks for (first match wins, so "crash zoom" beats "zoom"). */
export function moveFor(edit: string): Move {
  const e = edit.toLowerCase();
  const rules: [RegExp, Move][] = [
    [/crash zoom|snap zoom/, "crash_zoom"],
    [/pull[- ]?back|pull out|zoom out/, "pull_back"],
    [/tilt[- ]?up|rise|crane up/, "tilt_up"],
    [/crane|downward|tilt[- ]?down|drop/, "crane_down"],
    [/circular|circle|orbit|around/, "circle"],
    [/dolly|forward step|step into|walk/, "dolly"],
    [/track|pan across|horizontal|follow/, "track"],
    [/handheld|sway|chase|jolt|shake|tremor/, "handheld"],
    [/static|still|locked/, "static"],
    [/push[- ]?in|zoom in|zoom|rack focus|close in/, "push_in"],
  ];
  return rules.find(([r]) => r.test(e))?.[1] ?? "push_in";
}

/** Effects a scene's words suggest, most important first, at most three so the shot stays readable. */
export function effectsFor(s: { visual: string; edit: string; sfx: string; narration: string }): Effect[] {
  const all = `${s.visual} ${s.edit} ${s.sfx} ${s.narration}`.toLowerCase();
  const edit = s.edit.toLowerCase();
  const rules: [RegExp, Effect][] = [
    [/earthquake|violent(ly)? shak|shelves.*shak/, "quake"],
    [/shatter|smash|crack(ed|ing)? glass|glass break/, "shatter"],
    [/ghost|spirit|phantom|vaporous|mist(?! of)/, "ghost"],
    [/frost|freez|\bice\b|icy/, "frost"],
    [/\bsalt\b(?!-and)/, "salt"],
    [/bubbl|foam|boil/, "bubbles"],
    [/hiss|steam|vapou?r/, "steam"],
    [/flicker|sputter/, "flicker"],
    [/screen shake|jolt|rattl|chatter|tremor/, "shake"],
    [/phone beam|flashlight|beam|light cut/, "beam"],
    [/\brain\b|downpour|drizzle/, "rain"],
    [/spark|ember|flame flares|fire/, "embers"],
    [/fog|smoke|haze/, "fog"],
    [/dust/, "dust"],
    [/glow/, "glow"],
  ];
  const out: Effect[] = [];
  for (const [r, fx] of rules) if (r.test(all) && !out.includes(fx)) out.push(fx);
  const picked = out.slice(0, 3);
  if (/whip/.test(edit)) picked.push("whip_in");
  return picked;
}

const DEFAULT_SECONDS = 5;
const secs = (t: string) => {
  const [m, s] = t.split(":").map(Number);
  return (m || 0) * 60 + (s || 0);
};

/** A scene with defaults filled in from its words. */
export function sceneFrom(p: Partial<MovieScene> & { narration?: string }, i: number): MovieScene {
  const s = { narration: clip(p.narration ?? "", 600), onScreen: clip(p.onScreen ?? "", 60), visual: clip(p.visual ?? "", 900), edit: clip(p.edit ?? "", 300), sfx: clip(p.sfx ?? "", 300) };
  return {
    ...s,
    seconds: Math.min(20, Math.max(2, Number(p.seconds) || DEFAULT_SECONDS)),
    move: MOVES.includes(p.move as Move) ? (p.move as Move) : moveFor(s.edit),
    effects: Array.isArray(p.effects) ? p.effects.filter((e): e is Effect => EFFECTS.includes(e as Effect)).slice(0, 6) : effectsFor(s),
    frame: FRAMES.includes(p.frame as Frame) ? (p.frame as Frame) : i === 0 ? "open" : "letterbox",
    titleStyle: TITLE_STYLES.includes(p.titleStyle as TitleStyle) ? (p.titleStyle as TitleStyle) : "slam",
    ...(p.mediaId ? { mediaId: String(p.mediaId) } : {}),
  };
}

const field = (block: string, name: string) => block.match(new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";
const section = (text: string, name: string) => text.match(new RegExp(`^${name}\\s*:\\s*\\n?([\\s\\S]*?)(?=\\n[A-Z][A-Z &]+:|$)`, "m"))?.[1]?.trim() ?? "";

/**
 * Parse a plan in the "VIDEO PLAN" format:
 *   1. [0:00–0:05] Narration…
 *      On screen: …
 *      Visual: …
 *      Edit: … · SFX: …
 * Plain paragraphs (no numbers) also work: each becomes a scene with its text as both narration and picture.
 */
export function parsePlan(text: string): MoviePlan {
  const src = text.replace(/\r/g, "");
  const firstTitle = section(src, "TITLE OPTIONS").split("\n")[0]?.replace(/^\s*\d+\.\s*/, "") ?? "";
  const plan: MoviePlan = {
    title: clip(firstTitle || field(src, "TITLE") || "My movie", 120),
    look: clip(field(src, "THUMBNAIL").replace(/^"[^"]*"\s*[—-]\s*/, ""), 300),
    voice: clip(field(src, "VOICE"), 200),
    music: clip(field(src, "MUSIC & SOUND") || field(src, "MUSIC"), 200),
    caption: clip(section(src, "CAPTION"), 2000),
    scenes: [],
  };
  const starts = [...src.matchAll(/^\s*(\d{1,2})\.\s*\[(\d+:\d{2})\s*[–-]\s*(\d+:\d{2})\]\s*(.*)$/gm)];
  if (starts.length) {
    starts.forEach((m, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].index : src.length;
      const tail = src.slice(m.index! + m[0].length, end).split(/\n\s*\n[A-Z][A-Z &]+:/)[0];
      const editLine = field(tail, "Edit");
      const [edit, sfx] = editLine.split(/\s*·\s*SFX\s*:\s*/i);
      plan.scenes.push(
        sceneFrom(
          { narration: m[4], onScreen: field(tail, "On screen"), visual: field(tail, "Visual"), edit: edit ?? "", sfx: sfx ?? field(tail, "SFX"), seconds: secs(m[3]) - secs(m[2]) },
          plan.scenes.length,
        ),
      );
    });
  } else {
    src
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 3)
      .forEach((p, i) => plan.scenes.push(sceneFrom({ narration: p, visual: p }, i)));
  }
  plan.scenes = plan.scenes.slice(0, MAX_SCENES);
  return plan;
}

/** Spoken words of a scene: narration with a speaker tag ("K-Von: …") read as the line itself. */
export function spokenText(s: MovieScene) {
  return s.narration.replace(/^[A-Z][\w .'-]{0,30}:\s*/, "").replace(/^["“]|["”]$/g, "").trim();
}

/** The caption burned in for dialogue scenes ("K-Von: …"); narration isn't captioned. */
export function dialogueCaption(s: MovieScene) {
  return /^[A-Z][\w .'-]{0,30}:\s*["“]/.test(s.narration) ? clip(s.narration, 160) : "";
}

/** The picture prompt for a scene: its Visual line, the film's look, and a cinematic finish. */
export function picturePrompt(s: MovieScene, look: string) {
  return clip(
    `${s.visual || s.narration}. ${look ? `Look: ${look}.` : ""} Vertical 9:16 cinematic film still, dramatic lighting, shallow depth of field, photoreal, film grain. No text, no captions, no logos.`,
    1400,
  );
}

/** The motion engine's film spec. */
export function filmSpec(o: { scenes: (MovieScene & { image: string; seconds: number })[]; grade: Grade; title: string; endCard: string; fiction: boolean }) {
  const scenes: Record<string, unknown>[] = o.scenes.map((s, i) => ({
    image: s.image,
    dur: s.seconds,
    move: s.move,
    effects: [...s.effects, ...(s.frame === "letterbox" ? ["bars"] : s.frame === "open" ? ["bars_open"] : []), ...(i > 0 && !s.effects.some((e) => e.endsWith("_in")) && i % 4 === 0 ? ["leak_in"] : [])],
    ...(s.onScreen ? { title: s.onScreen, title_style: s.titleStyle } : {}),
    ...(dialogueCaption(s) ? { caption: dialogueCaption(s) } : {}),
  }));
  if (o.title) scenes.unshift({ image: null, dur: 2.5, move: "static", effects: ["fog", "glow"], title: o.title, title_style: "whisper" });
  if (o.endCard) scenes.push({ image: null, dur: 3, move: "static", effects: ["fog", "glow"], title: o.endCard, title_style: "type" });
  return { w: 1080, h: 1920, fps: 30, grade: o.grade, fiction: o.fiction, scenes };
}

/** Credits: a picture for each scene without one, and voice per started 1,000 characters. The motion render is free. */
export function movieCredits(plan: { scenes: MovieScene[] }, cost: { aiImage: number; speech: number }, withVoice: boolean) {
  const pictures = plan.scenes.filter((s) => !s.mediaId).length * cost.aiImage;
  const chars = plan.scenes.reduce((n, s) => n + spokenText(s).length, 0);
  return pictures + (withVoice && chars ? Math.ceil(chars / 1000) * cost.speech : 0);
}
