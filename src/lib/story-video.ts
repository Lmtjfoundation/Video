import "server-only";
import dns from "dns/promises";
import { promises as fs } from "fs";
import net from "net";
import os from "os";
import path from "path";
import { db } from "./db";
import { startSession, getSession, type DirectorSession } from "./director";
import { SPEECH_LANGUAGES } from "./languages";
import { readFile, storeFile } from "./media";
import { ownImage } from "./own-video";
import { runCmd } from "./render";
import { getPost, kvGet, kvSet, savePost } from "./repo";
import { toSrt } from "./speech-text";
import { storyTemplate, type StorySourceKind } from "./story-templates";
import type { MediaItem, Platform, Post, Settings, VideoPlan } from "./types";
import { nowIso } from "./utils";
import type { VoiceChoice } from "./voice-catalog";
import { zip } from "./zip";

/**
 * Story to Video: a whole narrated video from an idea, a script, a recording or video, a web page or a text file, in
 * a story template, in any of 23 languages. It starts a Director session, so every scene can then be changed by
 * chat or on the timeline; Instant mode also starts the render straight away. A finished story exports as a
 * package (.zip) with the script, captions, scene pictures, the video, a YouTube description and the thumbnail.
 */

export const STORY_MAX_CHARS = 20_000;

/** True for addresses a server must never fetch for a user: loopback, private, link-local, metadata, multicast. */
export function privateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

/** Readable text from a web page's HTML: the article (or main) part, without scripts, menus and footers. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  let body = html.replace(/<!--[\s\S]*?-->/g, " ");
  for (const tag of ["script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "form", "iframe", "template"]) body = body.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
  const main = body.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ?? body.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? body;
  const text = main
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 2)
    .join("\n");
  return { title: htmlToText.decode(title), text };
}
htmlToText.decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

/**
 * Fetches a public web page's text. Only http(s) on the usual ports, never to a private or local address (checked
 * on every redirect), at most 3 MB and 15 seconds.
 */
export async function pageText(raw: string, deps: { lookup?: (host: string) => Promise<string[]> } = {}): Promise<{ title: string; text: string }> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("That link isn't a web address.");
  }
  const lookup = deps.lookup ?? (async (h: string) => (await dns.lookup(h, { all: true })).map((a) => a.address));
  for (let hop = 0; hop < 4; hop++) {
    if (!/^https?:$/.test(url.protocol) || (url.port && !["80", "443"].includes(url.port)) || url.username || url.password) throw new Error("Only ordinary http(s) web pages can be read.");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const ips = net.isIP(host) ? [host] : await lookup(host).catch(() => [] as string[]);
    if (!ips.length) throw new Error("That website couldn't be found.");
    if (ips.some(privateAddress)) throw new Error("That address isn't a public website.");
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "GhostPost/1.0 (+story-to-video)", Accept: "text/html,text/plain" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new Error(`That page couldn't be read (HTTP ${res.status}).`);
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/(html|plain)|application\/xhtml/.test(type)) throw new Error("That link isn't a web page with text.");
    const reader = res.body?.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 3_000_000) {
        await reader.cancel();
        break;
      }
      parts.push(value);
    }
    const body = Buffer.concat(parts).toString("utf8");
    const page = type.includes("text/plain") ? { title: "", text: body } : htmlToText(body);
    if (page.text.length < 80) throw new Error("That page has too little readable text (it may need a login or run on JavaScript).");
    return { title: page.title, text: page.text.slice(0, STORY_MAX_CHARS) };
  }
  throw new Error("That link redirects too many times.");
}

export interface StoryInput {
  template: string;
  source: { kind: StorySourceKind; text?: string; mediaId?: string; url?: string; fileName?: string };
  /** The language the story is told in (and a second one for bilingual templates). */
  language: string;
  secondLanguage?: string;
  narrator: VoiceChoice;
  characterIds: string[];
  look?: string;
  platform: Platform;
  length?: "s30" | "s60" | "s90" | "m3";
  /** Instant: render as soon as the storyboard is written. */
  instant: boolean;
}

/** The text a story is made from, whatever it came as. */
export async function sourceText(s: StoryInput["source"], deps: { hear?: (file: string) => Promise<{ text: string }[]>; lookup?: (host: string) => Promise<string[]> } = {}): Promise<{ text: string; label: string }> {
  if (s.kind === "idea" || s.kind === "script" || s.kind === "file") {
    const text = String(s.text ?? "").replace(/\r/g, "").trim().slice(0, STORY_MAX_CHARS);
    if (text.length < (s.kind === "idea" ? 3 : 20)) throw new Error(s.kind === "idea" ? "Describe the story." : s.kind === "file" ? "That file has no text in it." : "Paste the script.");
    return { text, label: s.kind === "file" ? `the file “${String(s.fileName ?? "upload").slice(0, 80)}”` : s.kind };
  }
  if (s.kind === "link") {
    const page = await pageText(String(s.url ?? ""), deps);
    return { text: page.title ? `${page.title}\n\n${page.text}` : page.text, label: "a web page" };
  }
  const m = await db().get<MediaItem>("media", String(s.mediaId ?? ""));
  if (!m || (m.kind !== "audio" && m.kind !== "video")) throw new Error("Choose a recording or video from your Media Library.");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ghost-post-story-"));
  try {
    const src = path.join(dir, `in.${m.storagePath.split(".").pop()}`);
    await fs.writeFile(src, await readFile(m));
    const wav = path.join(dir, "sound.wav");
    await runCmd("ffmpeg", ["-hide_banner", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-t", "1800", wav], 10 * 60_000);
    const lines = deps.hear ? await deps.hear(wav) : await (await import("./transcribe")).transcribe(wav);
    const text = lines.map((l) => l.text.trim()).filter(Boolean).join(" ").slice(0, STORY_MAX_CHARS);
    if (text.length < 20) throw new Error("No speech was heard in that file.");
    return { text, label: `the ${m.kind === "video" ? "video" : "recording"} “${m.name}”` };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** The Director's first message for a story: the template's brief, the language rules and the source. */
export function storyBrief(o: Pick<StoryInput, "template" | "language" | "secondLanguage">, source: { kind: StorySourceKind; text: string; label: string }) {
  const t = storyTemplate(o.template);
  const lang = SPEECH_LANGUAGES[o.language] ?? "English";
  const second = t.bilingual && o.secondLanguage && o.secondLanguage !== o.language ? SPEECH_LANGUAGES[o.secondLanguage] : undefined;
  const lines = [
    `Make a ${t.name.toLowerCase()} video. ${t.guide}`,
    t.kids ? "It's for children: keep every picture and word gentle, kind and age-appropriate." : "",
    second
      ? `Write each scene's narration in ${lang}, then the same words in ${second} (as "${lang} sentence / ${second} sentence"). Write the title, caption and on-screen text in ${lang}.`
      : `Write all narration, on-screen text, the titles and the caption in ${lang}.`,
    source.kind === "script"
      ? `Use this script as the narration, word for word, split into scenes at natural pauses${o.language !== "en" ? ` (translate it into ${lang} if it's in another language)` : ""}:`
      : source.kind === "idea"
        ? "The story:"
        : `Base the story on ${source.label}, keeping its facts and meaning:`,
    source.text,
  ];
  return lines.filter(Boolean).join("\n\n").slice(0, 12_000);
}

/** What Story to Video keeps per story, next to its Director session. */
export interface StoryRecord {
  id: string;
  postId: string;
  template: string;
  language: string;
  thumbnailId?: string;
  createdAt: string;
}
const STORIES = "stories";
export const listStories = async () => (await kvGet<StoryRecord[]>(STORIES)) ?? [];
async function saveStory(r: StoryRecord) {
  await kvSet(STORIES, [r, ...(await listStories()).filter((x) => x.id !== r.id)].slice(0, 100));
}

/** Writes the story's storyboard (a Director session) with its narrator; the caller starts the render in Instant mode. */
export async function startStory(o: StoryInput, source: { kind: StorySourceKind; text: string; label: string }, settings: Settings): Promise<{ session: DirectorSession; post: Post }> {
  const t = storyTemplate(o.template);
  const { session, post } = await startSession({ message: storyBrief(o, source), characterIds: o.characterIds, look: o.look || t.look, platform: o.platform, length: o.length ?? t.length }, settings);
  if (post.video) {
    post.video.narrator = o.narrator;
    await savePost(post);
  }
  await saveStory({ id: session.id, postId: post.id, template: t.id, language: o.language, createdAt: nowIso() });
  return { session, post };
}

/** A thumbnail for the story: a picture from its thumbnail idea with its 2–4 words set in big bold type. */
export async function makeThumbnail(userId: string, storyId: string): Promise<MediaItem> {
  const rec = (await listStories()).find((s) => s.id === storyId);
  const post = rec ? await getPost(rec.postId) : null;
  if (!rec || !post?.video) throw new Error("That story wasn't found.");
  const v = post.video;
  const landscape = post.platform === "youtube";
  const look = v.ai?.look ?? storyTemplate(rec.template).look;
  const picture = await ownImage({ prompt: `${v.thumbnail.prompt || v.scenes[0]?.visual || post.hook}. ${look}. Eye-catching thumbnail composition, one clear subject, strong contrast, space for a title. No text.`, aspect: landscape ? "16:9" : "9:16" });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ghost-post-thumb-"));
  try {
    const [W, H] = landscape ? [1280, 720] : [1080, 1920];
    await fs.writeFile(path.join(dir, "pic.png"), picture);
    const words = (v.thumbnail.text || v.titles[0] || post.hook).toUpperCase().slice(0, 40);
    await fs.writeFile(path.join(dir, "t.txt"), words);
    const font = path.join(process.cwd(), "assets", "fonts", "Poppins-Bold.ttf");
    const size = Math.round(W * (landscape ? 0.085 : 0.1) * Math.min(1, 14 / Math.max(8, words.length)));
    // A soft dark gradient over the lower part keeps the title readable on any picture.
    const fc = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}[bg];gradients=s=${W}x${H}:c0=0x00000000:c1=0x000000c8:x0=0:y0=${Math.round(H * 0.5)}:x1=0:y1=${H}:d=1,format=rgba[g];[bg][g]overlay=format=auto,drawtext=fontfile='${font}':textfile='${path.join(dir, "t.txt")}':fontsize=${size}:fontcolor=white:borderw=${Math.round(size / 12)}:bordercolor=black:x=(w-text_w)/2:y=h*0.8-text_h/2`;
    await runCmd("ffmpeg", ["-hide_banner", "-y", "-i", path.join(dir, "pic.png"), "-filter_complex", fc, "-frames:v", "1", "-q:v", "2", path.join(dir, "thumb.jpg")], 60_000);
    const item = await storeFile(userId, { name: `thumbnail-${(v.titles[0] || post.hook).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "story"}.jpg`, type: "image/jpeg", bytes: await fs.readFile(path.join(dir, "thumb.jpg")) });
    await saveStory({ ...rec, thumbnailId: item.id });
    return item;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Scene start times in seconds, from the plan's "0:00–0:05" times (or evenly when a time is missing). */
function sceneTimes(v: VideoPlan): { start: number; end: number }[] {
  const sec = (t: string) => {
    const m = t.match(/(\d+):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  };
  let at = 0;
  return v.scenes.map((s) => {
    const [a, b] = s.time.split(/[–-]/).map(sec);
    const start = Number.isFinite(a) ? a : at;
    const end = Number.isFinite(b) && b > start ? b : start + Math.max(2, s.narration.split(/\s+/).length / 2.6);
    at = end;
    return { start, end };
  });
}

/** The YouTube description: the hook, the caption, chapters from the scene times, and the hashtags. */
export function youtubeText(post: Post) {
  const v = post.video!;
  const times = sceneTimes(v);
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const chapters = v.scenes.length >= 3 ? v.scenes.map((s, i) => `${clock(i === 0 ? 0 : times[i].start)} ${(s.onScreen || s.narration).split(/[.!?]/)[0].slice(0, 60).trim()}`) : [];
  return [
    `TITLE: ${v.titles[0] ?? post.hook}`,
    v.titles.length > 1 ? `Other titles: ${v.titles.slice(1).join(" | ")}` : "",
    "",
    post.hook,
    "",
    post.body,
    chapters.length ? `\nChapters:\n${chapters.join("\n")}` : "",
    "",
    post.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" "),
  ]
    .filter((l) => l !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The story package: script, storyboard, captions, YouTube text, scene pictures, the video and the thumbnail. */
export async function storyPackage(storyId: string): Promise<{ name: string; bytes: Buffer }> {
  const rec = (await listStories()).find((s) => s.id === storyId);
  const session = rec ? await getSession(rec.id) : null;
  const post = rec ? await getPost(rec.postId) : null;
  if (!rec || !post?.video) throw new Error("That story wasn't found.");
  const v = post.video;
  const slug = (v.titles[0] || post.hook).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "story";
  const times = sceneTimes(v);
  const files: { name: string; data: Buffer }[] = [];
  const text = (name: string, s: string) => files.push({ name: `${slug}/${name}`, data: Buffer.from(s, "utf8") });
  text("script.txt", v.scenes.map((s) => s.narration).join("\n\n"));
  text(
    "storyboard.md",
    [`# ${v.titles[0] ?? post.hook}`, "", ...v.scenes.flatMap((s, i) => [`## Scene ${i + 1} (${s.time})`, "", `**Narration:** ${s.narration}`, s.onScreen ? `**On screen:** ${s.onScreen}` : "", `**Picture:** ${s.visual}`, s.motion ? `**Camera:** ${s.motion}` : "", ""])].filter((l) => l !== "").join("\n\n"),
  );
  text("captions.srt", toSrt(v.scenes.map((s, i) => ({ start: times[i].start, end: times[i].end, text: s.narration }))));
  text("youtube-description.txt", youtubeText(post));
  const add = async (id: string | undefined, name: string) => {
    const m = id ? await db().get<MediaItem>("media", id) : null;
    if (m) files.push({ name: `${slug}/${name}.${m.storagePath.split(".").pop()}`, data: await readFile(m) });
  };
  for (const [i, s] of v.scenes.entries()) await add(s.mediaId ?? s.painted?.mediaId, `scenes/${String(i + 1).padStart(2, "0")}`);
  await add(post.render?.status === "done" ? post.render.mediaId : undefined, "video");
  await add(rec.thumbnailId, "thumbnail");
  if (session) text("README.txt", `Made with Ghost Post's Story to Video.\nStory: ${session.title}\nLanguage: ${SPEECH_LANGUAGES[rec.language] ?? rec.language}\nScenes: ${v.scenes.length}\n${post.render?.status === "done" ? "" : "The video isn't rendered yet: render it in the Director to include it here.\n"}`);
  return { name: `${slug}.zip`, bytes: zip(files) };
}
