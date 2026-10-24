import "server-only";
import { claudeJson } from "./llm";
import { getCharacters } from "./characters";
import { writeMovie } from "./movie";
import { getPost, kvGet, kvSet, savePost } from "./repo";
import { MOVIE_LENGTHS, type MovieLength } from "./video-spec";
import type { Platform, Post, Settings, VideoScene } from "./types";
import { nowIso, uid } from "./utils";

/**
 * Director: make a video by talking. The first message becomes a storyboard (a movie with your characters); every
 * message after that changes it ("make scene 3 darker", "add Dre to the ending", "cut the bank scene"). The scene
 * strip under the chat is the timeline: reorder, edit, swap a picture or delete a scene by hand, then render.
 */
export interface DirectorMessage {
  role: "you" | "director";
  text: string;
  at: string;
}

export interface DirectorSession {
  id: string;
  title: string;
  postId: string;
  characterIds: string[];
  look: string;
  platform: Platform;
  length: MovieLength;
  messages: DirectorMessage[];
  createdAt: string;
  updatedAt: string;
}

const ROW = "director";
export const MAX_SESSIONS = 40;
export const MAX_SCENES = 40;

export const listSessions = async (): Promise<DirectorSession[]> => (await kvGet<DirectorSession[]>(ROW)) ?? [];
export const getSession = async (id: string) => (await listSessions()).find((s) => s.id === id) ?? null;

async function saveSession(s: DirectorSession) {
  s.updatedAt = nowIso();
  await kvSet(ROW, [s, ...(await listSessions()).filter((x) => x.id !== s.id)].slice(0, MAX_SESSIONS));
  return s;
}

export async function deleteSession(id: string) {
  await kvSet(ROW, (await listSessions()).filter((s) => s.id !== id));
}

const say = (role: DirectorMessage["role"], text: string): DirectorMessage => ({ role, text: text.slice(0, 4000), at: nowIso() });

/** First message: write the storyboard as a movie and open a session around it. */
export async function startSession(
  o: { message: string; characterIds: string[]; look: string; platform: Platform; length: MovieLength },
  settings: Settings,
): Promise<{ session: DirectorSession; post: Post }> {
  const characters = await getCharacters(o.characterIds.slice(0, 6));
  const length = MOVIE_LENGTHS.includes(o.length) ? o.length : "s60";
  const post = await writeMovie({ kind: "movie", brief: o.message.slice(0, 12_000), characters, look: o.look, platform: o.platform, length, veoScenes: 0 }, settings);
  await savePost(post);
  const n = post.video?.scenes.length ?? 0;
  const t = nowIso();
  const session = await saveSession({
    id: uid("dir"),
    title: (post.hook || o.message).slice(0, 80),
    postId: post.id,
    characterIds: characters.map((c) => c.id),
    look: o.look,
    platform: o.platform,
    length,
    messages: [
      say("you", o.message),
      say("director", `Here's “${post.hook}”: ${n} scenes${characters.length ? ` with ${characters.map((c) => c.name).join(", ")}` : ""}. Tell me what to change, or press Render when it looks right.`),
    ],
    createdAt: t,
    updatedAt: t,
  });
  return { session, post };
}

interface Revision {
  reply?: string;
  scenes?: Partial<VideoScene>[];
}

/** Scene fields the Director may rewrite; everything else on a scene (a chosen picture, the painted one) is kept when the shot is unchanged. */
function sceneView(s: VideoScene, i: number) {
  return { n: i + 1, narration: s.narration, onScreen: s.onScreen, visual: s.visual, motion: s.motion, cast: s.cast ?? [] };
}

/** Every message after the first: change the storyboard as asked and say what changed. */
export async function revise(session: DirectorSession, message: string): Promise<{ session: DirectorSession; post: Post }> {
  const post = await getPost(session.postId);
  if (!post?.video) throw new Error("This video was deleted. Start a new one.");
  const cast = await getCharacters(session.characterIds);
  const before = post.video.scenes;
  const recent = session.messages.slice(-8).map((m) => `${m.role === "you" ? "CREATOR" : "DIRECTOR"}: ${m.text}`).join("\n");
  const r = await claudeJson<Revision>({
    system: "You are a film director working with a creator on a storyboard. You change exactly what they ask, keep everything else as it is, and explain the change in one or two plain sentences.",
    user: `THE VIDEO: “${post.hook}”, art style: ${session.look}.
CAST (names exactly as written; their portraits keep their looks): ${cast.length ? cast.map((c) => `${c.name} (${c.description.slice(0, 120)})`).join("; ") : "none"}
CONVERSATION SO FAR:
${recent}
CURRENT SCENES (JSON):
${JSON.stringify(before.map(sceneView))}
THE CREATOR NOW SAYS: ${message}

Return the WHOLE updated scene list in order (at most ${MAX_SCENES} scenes): unchanged scenes copied exactly, changed scenes rewritten, scenes added or removed only if asked. "visual" is one detailed storyboard shot (shot size, who is in frame and what they do, setting, light); "cast" lists the characters visible in it.
Reply with ONLY JSON: {"reply":"what you changed, in 1–2 sentences","scenes":[{"narration":"…","onScreen":"…","visual":"…","motion":"…","cast":["…"]}]}`,
    maxTokens: Math.min(16_000, 1500 + before.length * 220),
    temperature: 0.6,
  });
  const names = new Map(cast.map((c) => [c.name.toLowerCase(), c.name]));
  const next: VideoScene[] = (Array.isArray(r.scenes) ? r.scenes : [])
    .slice(0, MAX_SCENES)
    .filter((s) => String(s?.narration ?? "").trim() || String(s?.visual ?? "").trim())
    .map((s) => {
      const scene: VideoScene = {
        time: "",
        narration: String(s.narration ?? ""),
        onScreen: String(s.onScreen ?? ""),
        visual: String(s.visual ?? ""),
        motion: String(s.motion ?? ""),
        sfx: "",
        cast: (Array.isArray(s.cast) ? s.cast : []).map((n) => names.get(String(n).trim().toLowerCase())).filter((n): n is string => !!n),
      };
      // The same shot as before keeps its chosen picture (and the picture painted for it).
      const same = before.find((b) => b.visual === scene.visual);
      if (same?.mediaId) scene.mediaId = same.mediaId;
      if (same?.painted) scene.painted = same.painted;
      return scene;
    });
  if (!next.length) throw new Error("The Director couldn't make that change. Try saying it another way.");
  post.video.scenes = retime(next);
  post.parts = post.video.scenes.map((s) => `[${s.time}] ${s.narration}`);
  if (post.render?.status === "done") post.render = { ...post.render, message: `${post.render.message} · storyboard changed since this render` };
  await savePost(post);
  session.messages.push(say("you", message), say("director", r.reply?.trim() || "Done. Have a look at the scenes."));
  return { session: await saveSession(session), post };
}

/** Rough timestamps from narration length (about 2.6 words a second), so the storyboard reads like a timeline. */
export function retime(scenes: VideoScene[]): VideoScene[] {
  let t = 0;
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  return scenes.map((s) => {
    const d = Math.max(1.8, s.narration.split(/\s+/).filter(Boolean).length / 2.6);
    const out = { ...s, time: `${clock(t)}–${clock(t + d)}` };
    t += d;
    return out;
  });
}

/** Timeline edits made by hand: the new scene list, in order. Shots are kept as typed; a chosen picture must be the person's own. */
export async function setScenes(session: DirectorSession, scenes: Partial<VideoScene>[], ownsMedia: (id: string) => Promise<boolean>): Promise<Post> {
  const post = await getPost(session.postId);
  if (!post?.video) throw new Error("This video was deleted. Start a new one.");
  const cast = new Map((await getCharacters(session.characterIds)).map((c) => [c.name.toLowerCase(), c.name]));
  const before = post.video.scenes;
  const next: VideoScene[] = [];
  for (const s of scenes.slice(0, MAX_SCENES)) {
    const scene: VideoScene = {
      time: "",
      narration: String(s.narration ?? "").slice(0, 1000),
      onScreen: String(s.onScreen ?? "").slice(0, 120),
      visual: String(s.visual ?? "").slice(0, 1500),
      motion: String(s.motion ?? "").slice(0, 400),
      sfx: "",
      cast: (Array.isArray(s.cast) ? s.cast : []).map((n) => cast.get(String(n).toLowerCase())).filter((n): n is string => !!n),
    };
    if (s.mediaId && (await ownsMedia(String(s.mediaId)))) scene.mediaId = String(s.mediaId);
    const same = before.find((b) => b.visual === scene.visual && b.painted);
    if (same?.painted) scene.painted = same.painted;
    if (scene.narration.trim() || scene.visual.trim()) next.push(scene);
  }
  if (!next.length) throw new Error("A video needs at least one scene.");
  post.video.scenes = retime(next);
  post.parts = post.video.scenes.map((s) => `[${s.time}] ${s.narration}`);
  await savePost(post);
  await saveSession(session);
  return post;
}
