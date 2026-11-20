import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { promises as fs } from "fs";
import path from "path";

/**
 * Live previews: while a video is being made, each piece that finishes (a clip from the GPU engine, a picture, a
 * rendered scene) is kept here so the person can watch the video take shape in the jobs tray, instead of waiting on
 * a progress bar. A background job or a render opens a scope (its job id or post id); code that makes a piece calls
 * `showPreview` and it lands in the scope it runs in (outside one, nothing happens). The latest few pieces are kept
 * on this server's disk and removed a day after they're made.
 */
export interface PreviewItem {
  n: number;
  mime: string;
  label: string;
  at: string;
}

const KEEP = 8;
const MAX_AGE_MS = 24 * 3600_000;
const MAX_BYTES = 80 * 1024 * 1024;
const scope = new AsyncLocalStorage<{ owner: string; key: string; label?: string }>();

const safe = (s: string) => s.replace(/[^\w-]/g, "").slice(0, 80);
export const previewDir = (owner: string, key: string) => path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "previews", safe(owner), safe(key));
const EXT: Record<string, string> = { "video/mp4": "mp4", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Runs `fn` with its pieces shown under `key` (a job id or a post id) for `owner`. */
export const withPreview = <T>(owner: string, key: string, fn: () => Promise<T>) => scope.run({ owner, key }, fn);
/** Pieces made inside `fn` carry this label ("Shot 2", "Scene 3"), unless they give their own. */
export function previewLabel<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const s = scope.getStore();
  return s ? scope.run({ ...s, label }, fn) : fn();
}

const chains = new Map<string, Promise<unknown>>();
/** Adds a piece to the current scope's live preview. Never throws: a preview must not break the video it shows. */
export async function showPreview(piece: { bytes?: Buffer; file?: string; mime: string; label?: string }): Promise<void> {
  const s = scope.getStore();
  const ext = EXT[piece.mime];
  if (!s || !ext) return;
  const dir = previewDir(s.owner, s.key);
  const run = (chains.get(dir) ?? Promise.resolve()).then(async () => {
    try {
      const size = piece.bytes?.length ?? (piece.file ? (await fs.stat(piece.file)).size : 0);
      if (!size || size > MAX_BYTES) return;
      await fs.mkdir(dir, { recursive: true });
      const items = await readIndex(dir);
      const n = (items.at(-1)?.n ?? 0) + 1;
      const name = path.join(dir, `${n}.${ext}`);
      if (piece.bytes) await fs.writeFile(name, piece.bytes);
      else await fs.copyFile(piece.file!, name);
      const next = [...items, { n, mime: piece.mime, label: (piece.label ?? s.label ?? "").slice(0, 60), at: new Date().toISOString() }];
      for (const old of next.splice(0, Math.max(0, next.length - KEEP))) await fs.rm(path.join(dir, `${old.n}.${EXT[old.mime]}`), { force: true });
      await fs.writeFile(path.join(dir, "index.json"), JSON.stringify(next));
    } catch (e) {
      console.warn(`[preview] couldn't keep a piece: ${(e as Error).message.slice(0, 160)}`);
    }
  });
  chains.set(dir, run);
  await run;
  if (chains.get(dir) === run) chains.delete(dir);
}

async function readIndex(dir: string): Promise<PreviewItem[]> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, "index.json"), "utf8")) as PreviewItem[];
  } catch {
    return [];
  }
}

/** The pieces shown so far for `key` (oldest first), or none once they're older than a day. */
export async function listPreview(owner: string, key: string): Promise<PreviewItem[]> {
  const dir = previewDir(owner, key);
  const items = await readIndex(dir);
  if (items.length && Date.now() - Date.parse(items.at(-1)!.at) > MAX_AGE_MS) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    return [];
  }
  return items;
}

/** One piece's file on disk, if it's still kept. */
export async function previewFile(owner: string, key: string, n: number): Promise<{ file: string; mime: string } | null> {
  const item = (await listPreview(owner, key)).find((i) => i.n === n);
  if (!item) return null;
  const file = path.join(previewDir(owner, key), `${item.n}.${EXT[item.mime]}`);
  return (await fs.stat(file).catch(() => null)) ? { file, mime: item.mime } : null;
}

/** Removes previews of everything older than a day (called now and then; previews are only for watching live). */
export async function prunePreviews(owner: string): Promise<void> {
  const root = path.dirname(previewDir(owner, "x"));
  for (const key of await fs.readdir(root).catch(() => [] as string[])) await listPreview(owner, key);
}
