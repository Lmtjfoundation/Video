/**
 * Episode Studio: one prompt in, a finished episode out (cast, script, filmed shots, character voices, lip sync,
 * music and sound, grade, titles and captions). This file holds the plan the writer returns, the choices it may make
 * (voices and their acting styles, scene moods, lengths) and the checks that make any plan safe to film. Pure: no
 * server calls, so it runs in tests and in the browser.
 */

export const EPISODE_ASPECTS = ["9:16", "16:9"] as const;
export type EpisodeAspect = (typeof EPISODE_ASPECTS)[number];

export const EPISODE_LENGTHS = {
  teaser: { label: "Teaser · about 30 seconds", seconds: 30, minShots: 6, maxShots: 9 },
  short: { label: "Short · about 1 minute", seconds: 60, minShots: 12, maxShots: 16 },
  episode: { label: "Episode · about 2½ minutes", seconds: 150, minShots: 26, maxShots: 36 },
} as const;
export type EpisodeLength = keyof typeof EPISODE_LENGTHS;

/** Scene moods: each is a colour grade in the finish (scripts/episode/finish.py) and a feel for the score. */
export const MOODS = ["warm", "golden", "cool", "night", "neon", "dread", "action", "grief", "tension", "memory", "triumph", "romance"] as const;
export type Mood = (typeof MOODS)[number];

/** The acting styles Azure's expressive voices take (mstts:express-as). */
export const ACTING_STYLES = ["angry", "cheerful", "excited", "friendly", "hopeful", "sad", "shouting", "terrified", "unfriendly", "whispering"] as const;
export type ActingStyle = (typeof ACTING_STYLES)[number];

/**
 * Character voices: Azure neural voices that act (the styles above), plus the natural multilingual voices for a
 * narrator or calm parts (no styles). `who` is how the writer picks.
 */
export const EPISODE_VOICES: { name: string; who: string; gender: "male" | "female"; styles: boolean }[] = [
  { name: "en-US-DavisNeural", who: "man, deep and calm, 30s-40s", gender: "male", styles: true },
  { name: "en-US-JasonNeural", who: "young man, energetic, 20s", gender: "male", styles: true },
  { name: "en-US-TonyNeural", who: "man, warm and street-smart, 30s", gender: "male", styles: true },
  { name: "en-US-GuyNeural", who: "man, steady and authoritative, 40s-50s", gender: "male", styles: true },
  { name: "en-US-NancyNeural", who: "woman, strong and warm, 30s-40s", gender: "female", styles: true },
  { name: "en-US-JaneNeural", who: "woman, bright and direct, 20s-30s", gender: "female", styles: true },
  { name: "en-US-SaraNeural", who: "young woman, soft and expressive, late teens-20s", gender: "female", styles: true },
  { name: "en-US-JennyNeural", who: "woman, friendly and natural, 30s", gender: "female", styles: true },
  { name: "en-US-AriaNeural", who: "woman, polished storyteller, 30s", gender: "female", styles: true },
  { name: "en-US-AndrewMultilingualNeural", who: "narrator: warm, confident man", gender: "male", styles: false },
  { name: "en-US-BrianMultilingualNeural", who: "narrator: easygoing, clear man", gender: "male", styles: false },
  { name: "en-US-AvaMultilingualNeural", who: "narrator: bright, friendly woman", gender: "female", styles: false },
  { name: "en-US-EmmaMultilingualNeural", who: "narrator: cheerful, natural woman", gender: "female", styles: false },
  { name: "en-US-BrandonMultilingualNeural", who: "man, smooth and measured, 20s-30s", gender: "male", styles: false },
  { name: "en-US-SteffanMultilingualNeural", who: "man, older and deliberate, 50s", gender: "male", styles: false },
];
export const voiceInfo = (name: string) => EPISODE_VOICES.find((v) => v.name === name);

/**
 * Special effects the finish draws over a shot (scripts/episode/finish.py), in 4K: weather, light and texture. The
 * writer picks up to three where the scene motivates them.
 */
export const EPISODE_FX = ["rain", "snow", "embers", "dust", "fog", "sparks", "bloom", "neon", "lens_flare", "light_leak", "film_burn", "glitch", "heat_haze"] as const;
export type EpisodeFx = (typeof EPISODE_FX)[number];

/** How the edit moves into a shot or card. Most shots are plain cuts; the rest mark a shock, a jump or a memory. */
export const EPISODE_TRANSITIONS = ["cut", "flash", "whip", "glitch", "light_leak", "dip_black", "zoom_punch", "dissolve"] as const;
export type EpisodeTransition = (typeof EPISODE_TRANSITIONS)[number];

const fxList = (v: unknown): EpisodeFx[] | undefined => {
  const out = [...new Set((Array.isArray(v) ? v : []).map((x) => String(x).toLowerCase().trim().replace(/[\s-]+/g, "_")))].filter((x): x is EpisodeFx => (EPISODE_FX as readonly string[]).includes(x)).slice(0, 3);
  return out.length ? out : undefined;
};
const transitionOf = (v: unknown): EpisodeTransition | undefined => {
  const t = String(v ?? "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  return (EPISODE_TRANSITIONS as readonly string[]).includes(t) && t !== "cut" ? (t as EpisodeTransition) : undefined;
};

export interface CastMember {
  /** How shots and lines name them: LOCS, MAYA. */
  key: string;
  /** Full name, for the name tag: Dashon "Locs" Batiste. */
  name: string;
  /** Speaker label over their captions: LOCS. */
  label: string;
  /** The line under their name tag: 21 · THE LEADER. */
  role: string;
  /** What they look like, the same words in every picture: age, build, face, hair, wardrobe with its colours. */
  look: string;
  voice: string;
  /** Speaking rate, e.g. "+4%" or "-6%". */
  rate: string;
}

export interface Line {
  /** A cast key, or "N" for the narrator. */
  speaker: string;
  style?: ActingStyle;
  text: string;
}

export interface Shot {
  id: string;
  /** Cast keys in the picture (their portraits are the references, in this order). */
  cast: string[];
  /** The first frame: composition, place, light, who stands where ("image 1's man (LOCS) on the left…"). */
  still: string;
  /** How it moves, kept in place: real-time human motion, no spins, turns or hugs. */
  motion: string;
  /** Planned length in seconds (the edit may stretch it to fit a line). */
  seconds: number;
  line?: Line;
  /** The speaker's face is clearly on screen and talking: their lips are synced to the line. */
  talking?: boolean;
  /** Seconds into the shot where something hits (a gunshot, a slam): a shake and a flash in the finish. */
  impacts?: number[];
  /** A sound effect for this shot (made on the engine), e.g. "rain on a tin roof, distant thunder". */
  sfx?: string;
  /** Special effects drawn over the shot in the finish (up to three). */
  fx?: EpisodeFx[];
  /** How the edit moves into this shot; a plain cut when absent. */
  transition?: EpisodeTransition;
}

export interface Card {
  title: string;
  sub?: string;
  seconds: number;
  style: "series" | "title" | "card" | "next";
  /** How the edit moves into the card; a plain cut when absent. */
  transition?: EpisodeTransition;
}

export interface Beat {
  name: string;
  mood: Mood;
  /** A place or time over the first shot: THE 7TH WARD / NEW ORLEANS · SUPER SUNDAY. */
  super?: { title: string; sub?: string };
  shots?: Shot[];
  card?: Card;
}

export interface EpisodePlan {
  series: string;
  title: string;
  logline: string;
  /** The film look every picture shares (lens, light, grain, palette). */
  look: string;
  /** Title-card and caption accent colour, #RRGGBB. */
  accent: string;
  narrator?: { voice: string; rate: string };
  cast: CastMember[];
  beats: Beat[];
  /** The score: genre, instruments, tempo, how it moves through the episode. */
  music: string;
}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const rate = (r: unknown) => (typeof r === "string" && /^[+-]?\d{1,2}%$/.test(r.trim()) ? (r.trim().startsWith("-") || r.trim().startsWith("+") ? r.trim() : `+${r.trim()}`) : "+0%");
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The longest a shot may be: the engine's clip limit, less the little extra each clip is rendered with to trim. */
export const shotMax = (engineMaxSeconds: number) => Math.max(2.4, Math.floor((engineMaxSeconds - 0.15) * 100) / 100);
export const SHOT_MIN = 2.4;

/**
 * Makes any plan safe to film: known voices and styles, valid cast references, unique shot ids, shot lengths the engine
 * can make, lines short enough to caption, at least one title card, and no more shots than the length allows. Throws
 * only when nothing filmable is left.
 */
export function normalizePlan(raw: unknown, length: EpisodeLength, maxShot = shotMax(5.04)): EpisodePlan {
  const p = (raw ?? {}) as Record<string, unknown>;
  const lim = EPISODE_LENGTHS[length];
  const castIn = Array.isArray(p.cast) ? (p.cast as Record<string, unknown>[]) : [];
  const keys = new Set<string>();
  const cast: CastMember[] = [];
  for (const c of castIn.slice(0, 8)) {
    const key = clean(c.key, 16).toUpperCase().replace(/[^A-Z0-9_]/g, "");
    if (!key || key === "N" || keys.has(key)) continue;
    const look = clean(c.look, 500);
    if (!look) continue;
    keys.add(key);
    const voiceName = clean(c.voice, 60);
    const voice = voiceInfo(voiceName) ? voiceName : /\b(woman|girl|she|her|female|mother|aunt|grandmother|wife|sister|daughter)\b/i.test(look) ? "en-US-NancyNeural" : "en-US-DavisNeural";
    cast.push({ key, name: clean(c.name, 60) || key, label: (clean(c.label, 24) || key).toUpperCase(), role: clean(c.role, 50).toUpperCase(), look, voice, rate: rate(c.rate) });
  }
  const narratorRaw = p.narrator as Record<string, unknown> | undefined;
  const narrator = narratorRaw && voiceInfo(clean(narratorRaw.voice, 60)) ? { voice: clean(narratorRaw.voice, 60), rate: rate(narratorRaw.rate) } : undefined;
  const speakerOk = (s: string) => keys.has(s) || (s === "N" && !!narrator);

  const ids = new Set<string>();
  let shotCount = 0;
  const beats: Beat[] = [];
  for (const b of (Array.isArray(p.beats) ? (p.beats as Record<string, unknown>[]) : []).slice(0, 60)) {
    const mood = (MOODS as readonly string[]).includes(String(b.mood)) ? (b.mood as Mood) : "golden";
    const cardIn = b.card as Record<string, unknown> | undefined;
    if (cardIn && clean(cardIn.title, 60)) {
      const style = (["series", "title", "card", "next"] as const).find((s) => s === cardIn.style) ?? "card";
      beats.push({ name: clean(b.name, 40) || "card", mood, card: { title: clean(cardIn.title, 60).toUpperCase(), sub: clean(cardIn.sub, 60).toUpperCase() || undefined, seconds: clamp(Number(cardIn.seconds) || 3, 2, 5), style, transition: transitionOf(cardIn.transition) } });
      continue;
    }
    const shots: Shot[] = [];
    for (const s of (Array.isArray(b.shots) ? (b.shots as Record<string, unknown>[]) : [])) {
      if (shotCount >= lim.maxShots) break;
      const still = clean(s.still, 800);
      const motion = clean(s.motion, 600);
      if (!still || !motion) continue;
      let id = clean(s.id, 12).replace(/[^A-Za-z0-9_-]/g, "") || `s${String(shotCount + 1).padStart(2, "0")}`;
      while (ids.has(id)) id = `${id}x`;
      ids.add(id);
      const castKeys = (Array.isArray(s.cast) ? s.cast : []).map((k) => String(k).toUpperCase()).filter((k) => keys.has(k)).slice(0, 3);
      const lineIn = s.line as Record<string, unknown> | undefined;
      let line: Line | undefined;
      if (lineIn && clean(lineIn.text, 220)) {
        const speaker = String(lineIn.speaker ?? "").toUpperCase();
        if (speakerOk(speaker)) {
          const style = (ACTING_STYLES as readonly string[]).includes(String(lineIn.style)) ? (lineIn.style as ActingStyle) : undefined;
          const v = speaker === "N" ? narrator?.voice : cast.find((c) => c.key === speaker)?.voice;
          line = { speaker, style: v && voiceInfo(v)?.styles ? style : undefined, text: clean(lineIn.text, 220) };
        }
      }
      const seconds = clamp(Number(s.seconds) || 3.5, SHOT_MIN, maxShot);
      const impacts = (Array.isArray(s.impacts) ? s.impacts : []).map(Number).filter((t) => t >= 0 && t < seconds).slice(0, 6);
      shots.push({
        id,
        cast: castKeys,
        still,
        motion,
        seconds,
        line,
        talking: !!s.talking && !!line && line.speaker !== "N" && castKeys.includes(line.speaker),
        impacts: impacts.length ? impacts : undefined,
        sfx: clean(s.sfx, 200) || undefined,
        fx: fxList(s.fx),
        transition: transitionOf(s.transition),
      });
      shotCount++;
    }
    if (!shots.length) continue;
    const superIn = b.super as Record<string, unknown> | undefined;
    beats.push({ name: clean(b.name, 40) || `beat ${beats.length + 1}`, mood, super: superIn && clean(superIn.title, 40) ? { title: clean(superIn.title, 40).toUpperCase(), sub: clean(superIn.sub, 60).toUpperCase() || undefined } : undefined, shots });
  }
  if (!shotCount) throw new Error("The plan had no shots that can be filmed. Try describing the story in a little more detail.");
  const series = clean(p.series, 40) || clean(p.title, 40) || "Untitled";
  const title = clean(p.title, 60) || series;
  // Every episode gets a title card: after the first beat (the cold open) when the writer didn't place one.
  if (!beats.some((b) => b.card)) {
    const at = Math.min(1, beats.length);
    beats.splice(at, 0, { name: "title", mood: "golden", card: { title: series.toUpperCase(), sub: title.toUpperCase() === series.toUpperCase() ? undefined : title.toUpperCase(), seconds: 3.5, style: "series" } });
  }
  const accent = /^#[0-9a-f]{6}$/i.test(String(p.accent ?? "")) ? String(p.accent) : "#E8C470";
  return { series, title, logline: clean(p.logline, 300), look: clean(p.look, 400) || "photoreal cinematic film still, anamorphic lens, natural skin texture, rich color with deep shadows, subtle film grain", accent, narrator, cast, beats, music: clean(p.music, 400) || "cinematic score, emotional strings and low piano, steady pulse" };
}

export const allShots = (plan: EpisodePlan) => plan.beats.flatMap((b) => b.shots ?? []);

/** Name tags: each cast member's first shot where no other tag is shown yet. */
export function nameTags(plan: EpisodePlan): Record<string, { name: string; role: string }> {
  const tags: Record<string, { name: string; role: string }> = {};
  const done = new Set<string>();
  for (const s of allShots(plan)) {
    const who = s.line && s.cast.includes(s.line.speaker) && !done.has(s.line.speaker) ? s.line.speaker : s.cast.find((k) => !done.has(k));
    if (!who || tags[s.id]) continue;
    const c = plan.cast.find((x) => x.key === who);
    if (!c) continue;
    tags[s.id] = { name: c.name.toUpperCase(), role: c.role };
    done.add(who);
  }
  return tags;
}

/** The first-frame picture prompt for a shot, with each cast member's look tied to their reference image. */
export function stillPrompt(plan: EpisodePlan, shot: Shot): string {
  const people = shot.cast
    .map((k, i) => {
      const c = plan.cast.find((x) => x.key === k);
      return c ? `Image ${i + 1} is ${c.key}: ${c.look}` : "";
    })
    .filter(Boolean)
    .join(". ");
  return `${shot.still}. ${people ? `${people}. Keep each person's exact face and wardrobe from their reference image. ` : ""}${plan.look}. No text, no watermark, no captions.`;
}

/** A cast member's reference portrait prompt. */
export const portraitPrompt = (plan: EpisodePlan, c: CastMember) =>
  `Cinematic portrait of ${c.look}, chest-up, facing the camera, neutral expression, soft key light, plain dark background, sharp focus on the face. ${plan.look}. No text, no watermark.`;

/** The attempt that asks for the simplest motion there is, so a shot that keeps failing still comes back as footage. */
export const LAST_RESORT_TAKE = 3;
const SIMPLE_MOTION = "A slow, steady camera push-in. Everyone in the frame breathes, blinks and shifts their weight naturally; hair and clothes move slightly; the background stays alive.";

/** The motion prompt the video engine receives, with the rules that keep people moving like people. */
export const motionPrompt = (shot: Shot, retake = 0) =>
  `${retake ? "Continuous, clearly visible natural movement from the first frame to the last. " : ""}${retake >= LAST_RESORT_TAKE ? SIMPLE_MOTION : shot.motion} The people stay in place and keep facing the same way. Natural human motion, real-time speed. Photoreal cinematic film footage, consistent faces, natural lighting.`;

/**
 * The prompt for Gemini Omni, which has no negative prompt: the motion, what to avoid, and the sound (replaced by the
 * episode's own mix, so ambience only). A talking shot asks for natural speech movement on the speaker's face.
 */
export const omniPrompt = (shot: Shot, retake = 0) =>
  `${motionPrompt(shot, retake)}${shot.talking && retake < LAST_RESORT_TAKE ? " The person speaking talks naturally, lips and jaw moving with the words." : ""} Avoid: ${negativeFor(shot)}. Sound: natural ambience only, no music.`;

export const NEGATIVE =
  "blurry, distorted face, deformed hands, extra fingers, extra limbs, frozen, static, still image, slow motion, text, watermark, subtitles, cartoon, turning around, spinning, morphing, melting face, faces merging";
export const negativeFor = (shot: Shot) => (shot.impacts?.length ? `${NEGATIVE}, muzzle flash, flames, fire, explosion, sparks` : NEGATIVE);
