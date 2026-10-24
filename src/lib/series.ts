import "server-only";
import { claudeJson } from "./llm";
import { kvGet, kvSet } from "./repo";
import { getCharacters } from "./characters";
import { writeMovie } from "./movie";
import { MOVIE_LENGTHS, type MovieLength } from "./video-spec";
import type { Platform, Post, Settings } from "./types";
import { nowIso, uid } from "./utils";

/**
 * Series Studio: plan a whole series once (a story bible and one outline per episode, with a recurring cast), then
 * make each episode from it as a movie with the same characters, art style and continuity.
 */
export interface Episode {
  n: number;
  title: string;
  /** What happens, beat by beat. Editable before the episode is made. */
  outline: string;
  /** The last moment, that makes people watch the next one. */
  hook: string;
  /** The video post made from it, once made. */
  postId?: string;
}

export interface Series {
  id: string;
  title: string;
  logline: string;
  /** World, tone, each character's arc and the rules of the story: the continuity every episode follows. */
  bible: string;
  characterIds: string[];
  look: string;
  platform: Platform;
  length: MovieLength;
  episodes: Episode[];
  createdAt: string;
  updatedAt: string;
}

const ROW = "series";
export const MAX_SERIES = 20;
export const MIN_EPISODES = 3;
export const MAX_EPISODES = 20;

export const listSeries = async (): Promise<Series[]> => (await kvGet<Series[]>(ROW)) ?? [];
export const getSeries = async (id: string) => (await listSeries()).find((s) => s.id === id) ?? null;

export async function saveSeries(s: Series) {
  s.updatedAt = nowIso();
  const list = await listSeries();
  await kvSet(ROW, [s, ...list.filter((x) => x.id !== s.id)]);
  return s;
}

export async function deleteSeries(id: string) {
  await kvSet(ROW, (await listSeries()).filter((s) => s.id !== id));
}

export interface SeriesInput {
  premise: string;
  episodes: number;
  characterIds: string[];
  look: string;
  platform: Platform;
  length: MovieLength;
}

interface RawSeries {
  title?: string;
  logline?: string;
  bible?: string;
  episodes?: { title?: string; outline?: string; hook?: string }[];
}

/** Writes the series bible and every episode outline. The premise can be a sentence or a whole story bible. */
export async function planSeries(o: SeriesInput): Promise<Series> {
  if ((await listSeries()).length >= MAX_SERIES) throw new Error(`You can keep up to ${MAX_SERIES} series. Delete one to make room.`);
  const count = Math.max(MIN_EPISODES, Math.min(MAX_EPISODES, Math.round(o.episodes) || 10));
  const cast = await getCharacters(o.characterIds.slice(0, 6));
  const raw = await claudeJson<RawSeries>({
    system: "You are the showrunner of an award-winning serialized drama. Every episode moves the story, every character has an arc, and every episode ends on a hook that makes people watch the next one.",
    user: `Plan a ${count}-episode series of short vertical episodes. Use what the creator gives you: keep every character, event and line they wrote, in their order, and fill in what's missing.
CREATOR'S MATERIAL:
"""
${o.premise.slice(0, 20_000)}
"""
RECURRING CAST (use these names exactly):
${cast.length ? cast.map((c) => `- ${c.name}: ${c.description || "(see portrait)"}`).join("\n") : "- (none chosen: create the cast in the bible)"}
Write:
- "title" and a one-sentence "logline".
- "bible": the continuity every episode must follow: setting, tone, each main character's want, secret and arc across the series, key facts (names, numbers, places, dates), and the series' central question. 150–350 words, plain text.
- exactly ${count} "episodes", in order, each with "title" (2–4 words), "outline" (5–8 short beats, one per line, starting with "- ", including any lines of dialogue as Name: "line"), and "hook" (the final moment).
Reply with ONLY JSON: {"title":"…","logline":"…","bible":"…","episodes":[{"title":"…","outline":"- …\\n- …","hook":"…"}]}`,
    maxTokens: Math.min(16_000, 2500 + count * 450),
    temperature: 0.8,
  });
  const eps = (raw.episodes ?? []).filter((e) => e?.outline).slice(0, count);
  if (eps.length < Math.min(count, MIN_EPISODES)) throw new Error("The series plan came back incomplete. Try again.");
  const t = nowIso();
  return saveSeries({
    id: uid("ser"),
    title: String(raw.title ?? "Untitled series").slice(0, 120),
    logline: String(raw.logline ?? "").slice(0, 400),
    bible: String(raw.bible ?? "").slice(0, 6000),
    characterIds: cast.map((c) => c.id),
    look: o.look,
    platform: o.platform,
    length: MOVIE_LENGTHS.includes(o.length) ? o.length : "m3",
    episodes: eps.map((e, i) => ({ n: i + 1, title: String(e.title ?? `Episode ${i + 1}`).slice(0, 80), outline: String(e.outline).slice(0, 3000), hook: String(e.hook ?? "").slice(0, 400) })),
    createdAt: t,
    updatedAt: t,
  });
}

/** The brief Movie Studio writes the episode from: the bible, what happened before, and this episode's outline. */
export function episodeBrief(s: Series, n: number): string {
  const ep = s.episodes.find((e) => e.n === n);
  if (!ep) throw new Error("That episode isn't in the series.");
  const before = s.episodes.filter((e) => e.n < n).map((e) => `Episode ${e.n}, "${e.title}": ends on ${e.hook || "(see outline)"}`);
  const next = s.episodes.find((e) => e.n === n + 1);
  return [
    `"${s.title}", Episode ${n} of ${s.episodes.length}: "${ep.title}". ${s.logline}`,
    `SERIES BIBLE (continuity to follow exactly):\n${s.bible}`,
    before.length ? `PREVIOUSLY:\n${before.join("\n")}` : "This is the first episode: introduce the world and the cast.",
    `THIS EPISODE, beat by beat (keep every beat and line, in order):\n${ep.outline}`,
    ep.hook ? `END ON THIS HOOK: ${ep.hook}` : "",
    next ? `It must set up the next episode, "${next.title}", without giving it away.` : "This is the finale: pay off the series' central question.",
    `Open with a 1-second title card line: "${s.title}, Episode ${n}: ${ep.title}".`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Writes one episode as a movie with the series' cast, look and length. */
export async function writeEpisode(s: Series, n: number, settings: Settings): Promise<Post> {
  const characters = await getCharacters(s.characterIds);
  const post = await writeMovie({ kind: "movie", brief: episodeBrief(s, n), characters, look: s.look, platform: s.platform, length: s.length, veoScenes: 0 }, settings);
  const ep = s.episodes.find((e) => e.n === n)!;
  post.topic = `${s.title} · Episode ${n}: ${ep.title}`.slice(0, 140);
  return post;
}
