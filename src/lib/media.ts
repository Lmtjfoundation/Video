import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { db, asUser } from "./db";
import type { MediaItem } from "./types";
import { nowIso, uid } from "./utils";

/**
 * Media library: images and videos users upload to attach to posts.
 * Files live in Supabase Storage (bucket "media") when Supabase is configured, otherwise in ./.data/uploads.
 * Platforms like Instagram fetch images by URL, so each file can be served through a signed, expiring link.
 */
export const ALLOWED_TYPES: Record<string, { ext: string; kind: MediaItem["kind"] }> = {
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/png": { ext: "png", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "image/gif": { ext: "gif", kind: "image" },
  "video/mp4": { ext: "mp4", kind: "video" },
  "video/quicktime": { ext: "mov", kind: "video" },
  "video/webm": { ext: "webm", kind: "video" },
  // Voice lines, music and sound for the Film Engine (Seedance lip-syncs to them).
  "audio/mpeg": { ext: "mp3", kind: "audio" },
  "audio/wav": { ext: "wav", kind: "audio" },
  "audio/x-wav": { ext: "wav", kind: "audio" },
  "audio/mp4": { ext: "m4a", kind: "audio" },
  "audio/x-m4a": { ext: "m4a", kind: "audio" },
  // Recorded in the browser (My Voices).
  "audio/webm": { ext: "webm", kind: "audio" },
  "audio/ogg": { ext: "ogg", kind: "audio" },
};
/** Largest file a person can upload or link (MAX_UPLOAD_MB, 2 GB by default). Videos Ghost Post makes itself have no cap. */
export const MAX_FILE_BYTES = Math.max(1, Number(process.env.MAX_UPLOAD_MB) || 2048) * 1024 * 1024;
export const MAX_FILE_LABEL = MAX_FILE_BYTES >= 1024 ** 3 ? `${+(MAX_FILE_BYTES / 1024 ** 3).toFixed(1)} GB` : `${Math.round(MAX_FILE_BYTES / 1024 ** 2)} MB`;

const supa = () =>
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;
const localDir = (owner: string) => path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "uploads", owner.replace(/[^\w-]/g, ""));

export async function storeFile(owner: string, file: { name: string; type: string; bytes: Buffer }, opts: { uncapped?: boolean } = {}): Promise<MediaItem> {
  const t = ALLOWED_TYPES[file.type];
  if (!t) throw new Error("That file type isn't supported. Use JPG, PNG, WebP, GIF, MP4, MOV, MP3, WAV, M4A, WebM or OGG.");
  if (!opts.uncapped && file.bytes.length > MAX_FILE_BYTES) throw new Error(`Files can be up to ${MAX_FILE_LABEL}.`);
  const id = uid("med");
  const storagePath = `${owner}/${id}.${t.ext}`;
  const sb = supa();
  if (sb) {
    const { error } = await sb.storage.from("media").upload(storagePath, file.bytes, { contentType: file.type, upsert: false });
    if (error) throw new Error(`Upload failed: ${error.message}`);
  } else {
    await fs.mkdir(localDir(owner), { recursive: true });
    await fs.writeFile(path.join(localDir(owner), `${id}.${t.ext}`), file.bytes);
  }
  const item: MediaItem = { id, name: file.name.slice(0, 160), type: file.type, size: file.bytes.length, kind: t.kind, storagePath, createdAt: nowIso() };
  await db().upsert("media", item);
  return item;
}

export async function readFile(item: MediaItem): Promise<Buffer> {
  const sb = supa();
  if (sb) {
    const { data, error } = await sb.storage.from("media").download(item.storagePath);
    if (error || !data) throw new Error("File not found.");
    return Buffer.from(await data.arrayBuffer());
  }
  const [owner, fileName] = item.storagePath.split("/");
  return fs.readFile(path.join(localDir(owner), fileName));
}

export async function deleteFile(item: MediaItem) {
  const sb = supa();
  if (sb) await sb.storage.from("media").remove([item.storagePath]);
  else {
    const [owner, fileName] = item.storagePath.split("/");
    await fs.rm(path.join(localDir(owner), fileName), { force: true });
  }
  await db().remove("media", item.id);
}

export const listMedia = () => db().all<MediaItem>("media", 5000);

/* Finished videos hosted outside the app (Claude's content inbox keeps episodes on GitHub). */

/** Returns the URL when it is an https MP4 on a host the app trusts, otherwise null. */
export function trustedVideoUrl(u: unknown): string | null {
  if (typeof u !== "string" || !u.trim()) return null;
  try {
    const url = new URL(u.trim());
    const hosts = ["raw.githubusercontent.com"];
    try {
      if (process.env.CONTENT_INBOX_URL) hosts.push(new URL(process.env.CONTENT_INBOX_URL).host);
    } catch {
      /* ignore a malformed inbox URL */
    }
    if (url.protocol !== "https:" || !hosts.includes(url.host) || !/\.mp4$/i.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Refuses to fill the server's disk: keeps at least 150 MB free for the database and renders. */
async function ensureSpace(need: number) {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), ".data");
  let free: number | null = null;
  try {
    await fs.mkdir(dir, { recursive: true });
    const st = await fs.statfs(dir);
    free = st.bavail * st.bsize;
  } catch {
    free = null; // statfs unsupported: don't block
  }
  if (free !== null && free - need < 150 * 1024 * 1024) {
    throw new Error("The server's storage is almost full, so the video wasn't saved. Delete old videos in the Media Library or add storage.");
  }
}

/**
 * Downloads a remote MP4 into the Media Library once and returns it. Every post that uses the same URL
 * (e.g. the Instagram and Facebook drafts of one episode) shares the stored copy.
 */
export async function remoteVideoMedia(owner: string, rawUrl: string): Promise<MediaItem> {
  const url = trustedVideoUrl(rawUrl);
  if (!url) throw new Error("That video link isn't from a trusted host.");
  const existing = (await listMedia()).find((m) => m.kind === "video" && m.sourceUrl === url);
  if (existing) return existing;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180_000);
  let bytes: Buffer;
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`Couldn't download the video (HTTP ${res.status}).`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_FILE_BYTES) throw new Error(`The video is over ${MAX_FILE_LABEL}.`);
    bytes = Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
  if (!supa()) await ensureSpace(bytes.length);
  const name = decodeURIComponent(url.split("/").pop() || "video.mp4");
  const item = await storeFile(owner, { name, type: "video/mp4", bytes });
  item.sourceUrl = url;
  item.rendered = true;
  await db().upsert("media", item);
  return item;
}
export const usedBytes = async () => (await listMedia()).reduce((s, m) => s + m.size, 0);

/* Signed public links (HMAC with the app's encryption key). */
const signKey = () => {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) throw new Error("ENCRYPTION_KEY is missing.");
  return `media:${k}`;
};
const sig = (owner: string, id: string, exp: number) => createHmac("sha256", signKey()).update(`${owner}/${id}/${exp}`).digest("base64url");

export function signedUrl(owner: string, id: string, ttlSec = 7 * 86400) {
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `${base}/api/media/file/${owner}/${id}?exp=${exp}&sig=${sig(owner, id, exp)}`;
}

export function verifySignature(owner: string, id: string, exp: string | null, s: string | null) {
  if (!exp || !s || Number(exp) < Date.now() / 1000) return false;
  const want = Buffer.from(sig(owner, id, Number(exp)));
  const got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Public signed links to every attached picture, in order (up to 10, the most a carousel takes). */
export async function imageUrls(owner: string, mediaIds: string[]) {
  return asUser(owner, async () => {
    const out: string[] = [];
    for (const id of mediaIds) {
      const m = await db().get<MediaItem>("media", id);
      if (m?.kind === "image") out.push(signedUrl(owner, m.id, 2 * 86400));
      if (out.length >= 10) break;
    }
    return out;
  });
}

/** Public https URL of the first image attached to a post. */
export async function firstImageUrl(owner: string, mediaIds: string[]) {
  return asUser(owner, async () => {
    for (const id of mediaIds) {
      const m = await db().get<MediaItem>("media", id);
      if (m?.kind === "image") return signedUrl(owner, m.id);
    }
    return null;
  });
}
