import "server-only";
import { claude, claudeJson } from "./llm";
import { kvGet, kvSet } from "./repo";
import { nowIso, uid } from "./utils";

/**
 * Writers' Room: develops an original film the way a professional room does, one stage at a time —
 * development (titles, logline, theme, world, cast with backstories, structure, scene outline), screenplay pages,
 * an honest craft review against what juries and readers look for, revisions from notes, and a promotion kit.
 * A finished project hands its story and cast to Movie Studio to be made. Stored as one list per account.
 */
const ROW = "films";
export const MAX_FILMS = 30;

export const FILM_FORMATS = ["short", "feature", "series"] as const;
export type FilmFormat = (typeof FILM_FORMATS)[number];
export const FILM_GENRES = ["Drama", "Romance", "Thriller", "Crime", "Comedy", "Dramedy", "Horror", "Sci-fi", "Fantasy", "Mystery", "Action", "Family", "Animation", "Coming-of-age"] as const;

const FORMAT_BRIEF: Record<FilmFormat, { label: string; structure: string; scenes: string }> = {
  short: { label: "short film (5–15 minutes)", structure: "three movements: setup, confrontation, resolution, with one clear turning point and a final image that reframes the opening", scenes: "8–14" },
  feature: { label: "feature film (90–110 minutes)", structure: "three acts in eight sequences: opening image, inciting incident, lock-in (end of act one), first-half rising action, midpoint reversal, second-half complications, all-is-lost, climax and resolution", scenes: "30–45" },
  series: { label: "series pilot (about 30–50 minutes) with a season arc", structure: "a teaser/cold open and four acts for the pilot, each act ending on a turn, plus a season arc of 6–8 episode loglines", scenes: "18–28" },
};

export interface FilmCharacter {
  name: string;
  role: string;
  /** How they look and dress, for casting and for the AI portrait. */
  look: string;
  backstory: string;
  /** The wound: the past hurt that shapes them. */
  wound: string;
  want: string;
  need: string;
  flaw: string;
  arc: string;
  /** How they talk: rhythm, vocabulary, what they never say. */
  voice: string;
  /** Who they are to the others. */
  relationships: string;
}

export interface FilmScene {
  number: number;
  heading: string;
  summary: string;
  /** Why the scene exists in the story. */
  purpose: string;
  conflict: string;
  /** The value shift: how things are different at the end of the scene. */
  turn: string;
}

export interface FilmReview {
  /** One line, honest, no flattery. */
  verdict: string;
  scores: { area: string; score: number; note: string }[];
  strengths: string[];
  fixes: string[];
  /** Festivals or awards categories the finished film could suit, with why. Advice only. */
  fit: string[];
  reviewedAt: string;
}

export interface FilmPromo {
  tagline: string;
  synopsis: string;
  posterPrompt: string;
  trailer: string[];
  characterSpotlights: { name: string; caption: string }[];
  behindTheStory: string;
  hashtags: string[];
  madeAt: string;
}

export interface FilmProject {
  id: string;
  title: string;
  titles: string[];
  logline: string;
  genre: string;
  format: FilmFormat;
  tone: string;
  premise: string;
  influences?: string;
  theme: string;
  /** The question the film asks, which the ending answers. */
  dramaticQuestion: string;
  world: { setting: string; era: string; rules: string; look: string; sound: string };
  characters: FilmCharacter[];
  structure: { name: string; summary: string }[];
  scenes: FilmScene[];
  /** Season arc for a series: one logline per episode. */
  episodes?: string[];
  /** Screenplay pages by scene number. */
  pages: Record<string, string>;
  review?: FilmReview;
  promo?: FilmPromo;
  /** Notes from earlier revisions, newest last. */
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

const SYSTEM =
  "You are the head writer of an acclaimed writers' room: you've written festival-winning shorts, features and prestige series. " +
  "You write ORIGINAL fiction only: never real private people or public figures, never another writer's characters or plots. " +
  "Your standards: specific over generic, conflict in every scene, characters who want something and are changed by trying to get it, a theme the story argues rather than states, dialogue with subtext, images that tell the story without words. " +
  "No clichés unless subverted. No padding. Tell the truth about weaknesses.";

const clean = (s: unknown, max = 2000) => String(s ?? "").replace(/\u0000/g, "").trim().slice(0, max);
const list = <T>(v: unknown, max: number): T[] => (Array.isArray(v) ? (v.slice(0, max) as T[]) : []);

export async function listFilms(): Promise<FilmProject[]> {
  return (await kvGet<FilmProject[]>(ROW)) ?? [];
}
export async function getFilm(id: string) {
  return (await listFilms()).find((f) => f.id === id) ?? null;
}
export async function saveFilm(f: FilmProject) {
  f.updatedAt = nowIso();
  const all = (await listFilms()).filter((x) => x.id !== f.id);
  await kvSet(ROW, [f, ...all].slice(0, MAX_FILMS));
  return f;
}
export async function deleteFilm(id: string) {
  await kvSet(ROW, (await listFilms()).filter((f) => f.id !== id));
}

type Dev = Partial<Pick<FilmProject, "titles" | "logline" | "theme" | "dramaticQuestion" | "world" | "characters" | "structure" | "scenes" | "episodes" | "tone">>;

function devPrompt(input: { premise: string; genre: string; format: FilmFormat; tone: string; influences?: string }, prior?: FilmProject, notes?: string) {
  const f = FORMAT_BRIEF[input.format];
  const base = prior
    ? `REVISE this project. Keep what works; fix what the notes ask for, and anything the notes reveal is weak. Keep character names unless a note says otherwise.
CURRENT PROJECT (JSON):
${JSON.stringify({ title: prior.title, logline: prior.logline, theme: prior.theme, dramaticQuestion: prior.dramaticQuestion, world: prior.world, characters: prior.characters, structure: prior.structure, scenes: prior.scenes, episodes: prior.episodes }).slice(0, 40_000)}
NOTES TO ADDRESS:
${notes}`
    : `DEVELOP an original ${f.label} from this idea.
IDEA: ${input.premise}`;
  return `${base}
GENRE: ${input.genre}. TONE: ${input.tone || "your call — what serves the story"}.${input.influences ? `\nINSPIRED BY THE FEEL OF (don't copy plots or characters): ${input.influences}` : ""}
STRUCTURE: ${f.structure}.
DELIVER:
- "titles": 5 title options, strongest first: short, evocative, unforgettable, not generic.
- "logline": one sentence — protagonist with a defining trait, the inciting incident, the goal, the stakes, the antagonistic force. Under 45 words.
- "theme": what the film argues about life, in one sentence. "dramaticQuestion": the yes/no question the climax answers.
- "world": setting (specific place and texture), era, rules (what's normal here, what's forbidden, what it costs), look (cinematography, palette, lenses, light), sound (score and soundscape).
- "characters": 3–7 people. For each: name, role in the story, look (appearance and wardrobe, for casting), backstory (specific events, not adjectives), wound, want (external goal), need (inner truth they must accept), flaw, arc (who they are at the start vs. the end), voice (how they talk — rhythm, words they use, what they never say), relationships (what they are to the others and the tension between them). The antagonist must believe they are right.
- "structure": the beats named above, each with a 2–4 sentence summary of what happens and what changes.
- "scenes": ${f.scenes} scenes in order: number, heading (INT./EXT. PLACE — DAY/NIGHT), summary, purpose (why it must exist), conflict (who wants what against whom), turn (how the situation or a relationship is different at the end).${input.format === "series" ? '\n- "episodes": 6–8 one-line episode loglines for the season.' : ""}
Reply with ONLY JSON: {"titles":[],"logline":"","theme":"","dramaticQuestion":"","tone":"","world":{"setting":"","era":"","rules":"","look":"","sound":""},"characters":[{"name":"","role":"","look":"","backstory":"","wound":"","want":"","need":"","flaw":"","arc":"","voice":"","relationships":""}],"structure":[{"name":"","summary":""}],"scenes":[{"number":1,"heading":"","summary":"","purpose":"","conflict":"","turn":""}]${input.format === "series" ? ',"episodes":[]' : ""}}`;
}

function applyDev(f: FilmProject, d: Dev) {
  const titles = list<string>(d.titles, 5).map((t) => clean(t, 120)).filter(Boolean);
  if (titles.length) {
    f.titles = titles;
    if (!f.title || !titles.includes(f.title)) f.title = titles[0];
  }
  f.logline = clean(d.logline, 600) || f.logline;
  f.theme = clean(d.theme, 400) || f.theme;
  f.dramaticQuestion = clean(d.dramaticQuestion, 300) || f.dramaticQuestion;
  f.tone = clean(d.tone, 200) || f.tone;
  if (d.world) f.world = { setting: clean(d.world.setting), era: clean(d.world.era, 300), rules: clean(d.world.rules), look: clean(d.world.look), sound: clean(d.world.sound, 800) };
  const chars = list<FilmCharacter>(d.characters, 8)
    .map((c) => ({
      name: clean(c?.name, 60), role: clean(c?.role, 200), look: clean(c?.look, 600), backstory: clean(c?.backstory, 1500), wound: clean(c?.wound, 500),
      want: clean(c?.want, 400), need: clean(c?.need, 400), flaw: clean(c?.flaw, 400), arc: clean(c?.arc, 600), voice: clean(c?.voice, 500), relationships: clean(c?.relationships, 800),
    }))
    .filter((c) => c.name);
  if (chars.length) f.characters = chars;
  const beats = list<{ name: string; summary: string }>(d.structure, 16).map((b) => ({ name: clean(b?.name, 80), summary: clean(b?.summary, 1200) })).filter((b) => b.name);
  if (beats.length) f.structure = beats;
  const scenes = list<FilmScene>(d.scenes, 60)
    .map((s, i) => ({ number: i + 1, heading: clean(s?.heading, 140), summary: clean(s?.summary, 1200), purpose: clean(s?.purpose, 400), conflict: clean(s?.conflict, 400), turn: clean(s?.turn, 400) }))
    .filter((s) => s.summary);
  if (scenes.length) {
    // Pages written for scenes whose outline changed no longer match: drop them.
    const before = new Map(f.scenes.map((s) => [s.number, s.summary]));
    for (const s of scenes) if (before.get(s.number) !== s.summary) delete f.pages[String(s.number)];
    for (const k of Object.keys(f.pages)) if (Number(k) > scenes.length) delete f.pages[k];
    f.scenes = scenes;
  }
  const eps = list<string>(d.episodes, 10).map((e) => clean(e, 400)).filter(Boolean);
  if (eps.length) f.episodes = eps;
  if (!f.scenes.length || !f.characters.length) throw new Error("The writers' room came back without a full outline. Try again.");
}

export async function developFilm(input: { premise: string; genre: string; format: FilmFormat; tone: string; influences?: string }): Promise<FilmProject> {
  const d = await claudeJson<Dev>({ system: SYSTEM, user: devPrompt(input), maxTokens: input.format === "short" ? 9000 : 16000, temperature: 0.85 });
  const t = nowIso();
  const f: FilmProject = {
    id: uid("film"), title: "", titles: [], logline: "", genre: input.genre, format: input.format, tone: input.tone, premise: input.premise, influences: input.influences,
    theme: "", dramaticQuestion: "", world: { setting: "", era: "", rules: "", look: "", sound: "" }, characters: [], structure: [], scenes: [], pages: {}, notes: [], createdAt: t, updatedAt: t,
  };
  applyDev(f, d);
  return f;
}

export async function reviseFilm(f: FilmProject, notes: string): Promise<FilmProject> {
  const d = await claudeJson<Dev>({ system: SYSTEM, user: devPrompt(f, f, notes), maxTokens: f.format === "short" ? 9000 : 16000, temperature: 0.7 });
  applyDev(f, d);
  f.notes = [...f.notes, notes].slice(-20);
  f.review = undefined; // the old review was of the old draft
  return f;
}

/** Screenplay pages for a run of scenes, in standard screenplay format (Fountain-style plain text). */
export async function writePages(f: FilmProject, from: number, to: number): Promise<FilmProject> {
  const run = f.scenes.filter((s) => s.number >= from && s.number <= to);
  if (!run.length) throw new Error("Pick scenes from the outline.");
  const prev = f.scenes.find((s) => s.number === from - 1);
  const prevPages = prev ? f.pages[String(prev.number)] : undefined;
  const user = `Write the screenplay pages for scenes ${from}–${to} of "${f.title}".
LOGLINE: ${f.logline}
THEME: ${f.theme}
WORLD: ${JSON.stringify(f.world)}
CHARACTERS (keep every voice distinct and true to this):
${f.characters.map((c) => `- ${c.name} (${c.role}). Want: ${c.want}. Need: ${c.need}. Flaw: ${c.flaw}. Voice: ${c.voice}`).join("\n")}
FULL OUTLINE (for continuity):
${f.scenes.map((s) => `${s.number}. ${s.heading} — ${s.summary}`).join("\n").slice(0, 12_000)}
${prevPages ? `THE PAGE BEFORE (match its style and pick up from it):\n${prevPages.slice(-2500)}\n` : ""}SCENES TO WRITE NOW:
${run.map((s) => `${s.number}. ${s.heading}\n   What happens: ${s.summary}\n   Conflict: ${s.conflict}\n   Turn: ${s.turn}`).join("\n")}
RULES: standard screenplay format as plain text — SCENE HEADING in caps, action lines in present tense (short, visual, no camera directions unless essential), CHARACTER NAME in caps above dialogue, (parentheticals) only when needed. Subtext over exposition: people rarely say what they mean. Enter late, leave early. Every scene ends changed. Original fiction only.
Write each scene starting with a line "### SCENE <number>" and nothing else on that line. No commentary before or after.`;
  const text = await claude({ system: SYSTEM, user, maxTokens: Math.min(14000, 2200 * run.length + 800), temperature: 0.8 });
  const parts = text.split(/^###\s*SCENE\s+(\d+)\s*$/im);
  let wrote = 0;
  for (let i = 1; i < parts.length; i += 2) {
    const n = Number(parts[i]);
    const body = (parts[i + 1] ?? "").trim();
    if (run.some((s) => s.number === n) && body) {
      f.pages[String(n)] = body.slice(0, 20_000);
      wrote++;
    }
  }
  if (!wrote) throw new Error("The pages came back in the wrong shape. Try again.");
  return f;
}

/** An honest craft review against what festival juries, script readers and awards voters look for. */
export async function reviewFilm(f: FilmProject): Promise<FilmProject> {
  const pages = Object.entries(f.pages).sort((a, b) => Number(a[0]) - Number(b[0])).map(([, p]) => p).join("\n\n").slice(0, 30_000);
  const user = `Give this project the review a top script reader or festival programmer would — honest, specific, useful. Don't flatter: the writer wants it to be genuinely award-worthy, so name every weakness and how to fix it.
PROJECT: ${JSON.stringify({ title: f.title, format: f.format, genre: f.genre, logline: f.logline, theme: f.theme, dramaticQuestion: f.dramaticQuestion, world: f.world, characters: f.characters, structure: f.structure, scenes: f.scenes }).slice(0, 40_000)}
${pages ? `SCREENPLAY PAGES SO FAR:\n${pages}` : "No screenplay pages yet: judge the development and outline."}
Score 1–10 (10 is rare: reserve it for work that would stand out at a major festival) for: Premise & originality, Character depth, Structure & pacing, Theme, Dialogue & voice${pages ? "" : " (judge from the voice notes)"}, Visual storytelling, Emotional impact, Audience & marketability.
Then: 3–5 real strengths; 4–8 specific fixes in order of impact (each says exactly what to change); 2–4 festivals or awards categories the finished film could suit, each with why (advice, not a promise).
Reply with ONLY JSON: {"verdict":"one honest sentence","scores":[{"area":"","score":7,"note":""}],"strengths":[],"fixes":[],"fit":[]}`;
  const r = await claudeJson<Partial<FilmReview>>({ system: SYSTEM, user, maxTokens: 4000, temperature: 0.4 });
  const scores = list<{ area: string; score: number; note: string }>(r.scores, 10)
    .map((s) => ({ area: clean(s?.area, 60), score: Math.max(1, Math.min(10, Math.round(Number(s?.score) || 0))), note: clean(s?.note, 500) }))
    .filter((s) => s.area && s.score);
  if (!scores.length) throw new Error("The review came back empty. Try again.");
  f.review = {
    verdict: clean(r.verdict, 400),
    scores,
    strengths: list<string>(r.strengths, 6).map((x) => clean(x, 400)).filter(Boolean),
    fixes: list<string>(r.fixes, 10).map((x) => clean(x, 600)).filter(Boolean),
    fit: list<string>(r.fit, 5).map((x) => clean(x, 400)).filter(Boolean),
    reviewedAt: nowIso(),
  };
  return f;
}

/** Everything to promote the film: tagline, synopsis, poster, trailer beats and a spotlight post per character. */
export async function promoteFilm(f: FilmProject): Promise<FilmProject> {
  const user = `Build the promotion kit for "${f.title}" (${f.genre} ${f.format}).
LOGLINE: ${f.logline}
THEME: ${f.theme}
WORLD: ${f.world.setting} — ${f.world.look}
CHARACTERS: ${f.characters.map((c) => `${c.name} (${c.role}): ${c.want}; ${c.flaw}`).join(" | ")}
STRUCTURE: ${f.structure.map((b) => `${b.name}: ${b.summary}`).join(" | ").slice(0, 6000)}
DELIVER:
- "tagline": the poster line — under 10 words, intriguing, no spoilers.
- "synopsis": 90–130 words for festival submissions and the video description. No spoiler of the ending.
- "posterPrompt": a detailed key-art description for an AI image (composition, characters by action and look, palette, mood). No text in the image.
- "trailer": 8–12 beats for a 60-second trailer, each one line (what we see + any line of dialogue), building to a cliffhanger, never revealing the ending.
- "characterSpotlights": one social caption per main character (hook first line, 2–4 lines, ends with a question that gets comments).
- "behindTheStory": 60–100 words on why this story matters, in the creator's voice, for a pinned post.
- "hashtags": 6–10 without "#".
Reply with ONLY JSON: {"tagline":"","synopsis":"","posterPrompt":"","trailer":[],"characterSpotlights":[{"name":"","caption":""}],"behindTheStory":"","hashtags":[]}`;
  const r = await claudeJson<Partial<FilmPromo>>({ system: SYSTEM, user, maxTokens: 4000, temperature: 0.8 });
  if (!r.tagline || !r.synopsis) throw new Error("The promotion kit came back empty. Try again.");
  f.promo = {
    tagline: clean(r.tagline, 160),
    synopsis: clean(r.synopsis, 1500),
    posterPrompt: clean(r.posterPrompt, 1500),
    trailer: list<string>(r.trailer, 14).map((x) => clean(x, 300)).filter(Boolean),
    characterSpotlights: list<{ name: string; caption: string }>(r.characterSpotlights, 8).map((c) => ({ name: clean(c?.name, 60), caption: clean(c?.caption, 800) })).filter((c) => c.caption),
    behindTheStory: clean(r.behindTheStory, 1200),
    hashtags: list<string>(r.hashtags, 12).map((h) => clean(h, 40).replace(/^#/, "")).filter(Boolean),
    madeAt: nowIso(),
  };
  return f;
}

/** The text the promo posts are written from. */
export function promoSource(f: FilmProject) {
  const p = f.promo;
  if (!p) return "";
  return `Original ${f.genre.toLowerCase()} ${f.format === "series" ? "series" : "film"}: "${f.title}". Tagline: ${p.tagline}
Synopsis: ${p.synopsis}
Characters: ${p.characterSpotlights.map((c) => `${c.name}: ${c.caption}`).join(" | ")}
Behind the story: ${p.behindTheStory}
It's fiction. Hashtags to draw on: ${p.hashtags.join(", ")}`;
}
