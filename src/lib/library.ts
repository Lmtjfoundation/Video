import "server-only";
import { asUser, db, gdb, GLOBAL } from "./db";
import { kvGet, kvSet } from "./repo";
import { readFile, signedUrl, storeFile, deleteFile } from "./media";
import type { MediaItem } from "./types";
import { nowIso, uid } from "./utils";
import { LENGTHS, TEMPOS, type AssetKind, type SortId } from "./library-tags";

/**
 * The Library: music, sound effects and footage to put in videos, like a stock catalog. Two shelves:
 *  - the catalog: tracks and clips the app's owner published for every subscriber (stored under the app-wide owner);
 *  - "My library": everything a person made with the AI generators, private to them.
 * Favorites and boards (named collections) are per person and can hold assets from both.
 * Everything in it was made by Ghost Post's own models, so it comes with Ghost Post's license (licenseText).
 */
export interface LibraryAsset {
  id: string;
  kind: AssetKind;
  title: string;
  /** What it was made from (the prompt), shown as its description. */
  description: string;
  /** "_global" for the catalog, otherwise the person who made it. */
  owner: string;
  /** Full quality: WAV for audio, MP4 for footage. */
  mediaId: string;
  /** For playing in the browser: MP3 for audio (the same file for footage). */
  previewId: string;
  /** Footage: a still for the grid. */
  posterId?: string;
  seconds: number;
  bpm?: number;
  key?: string;
  vocals?: boolean;
  lyrics?: string;
  aspect?: string;
  genres: string[];
  moods: string[];
  themes: string[];
  instruments: string[];
  /** Sound effects and footage. */
  category?: string;
  /** Loudness outline for the waveform (about 120 values, 0..1). */
  peaks: number[];
  model: string;
  downloads: number;
  createdAt: string;
}

export interface Board {
  id: string;
  name: string;
  assetIds: string[];
  createdAt: string;
}

const CATALOG = "library-catalog";
const MINE = "library";
const BOARDS = "library-boards";
const FAVORITES = "library-favorites";
const MAX_BOARDS = 50;

/* Writes to one list go one at a time, so two finishing generations can't overwrite each other. */
let writes: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = writes.then(fn);
  writes = next.catch(() => {});
  return next;
}

export const catalog = async () => ((await gdb().get<{ id: string; value: LibraryAsset[] }>("kv", CATALOG))?.value ?? []);
const saveCatalog = (list: LibraryAsset[]) => gdb().upsert("kv", { id: CATALOG, value: list });
export const myAssets = async () => (await kvGet<LibraryAsset[]>(MINE)) ?? [];

/** Adds a finished asset to the signed-in person's library (or, with owner "_global", to the catalog). */
export function addAsset(a: LibraryAsset) {
  return serial(async () => {
    if (a.owner === GLOBAL) await saveCatalog([a, ...(await catalog()).filter((x) => x.id !== a.id)]);
    else await kvSet(MINE, [a, ...(await myAssets()).filter((x) => x.id !== a.id)]);
    return a;
  });
}

/** One asset the signed-in person may use: theirs or the catalog's. */
export async function findAsset(id: string): Promise<LibraryAsset | null> {
  return (await myAssets()).find((a) => a.id === id) ?? (await catalog()).find((a) => a.id === id) ?? null;
}

export interface LibraryQuery {
  kind: AssetKind;
  shelf?: "all" | "catalog" | "mine" | "favorites" | "board";
  boardId?: string;
  q?: string;
  genres?: string[];
  moods?: string[];
  themes?: string[];
  instruments?: string[];
  categories?: string[];
  vocals?: "instrumental" | "vocals";
  tempo?: string;
  length?: string;
  sort?: SortId;
  /** "More like this": rank by closeness to this asset. */
  similarTo?: string;
  limit?: number;
}

const anyOf = (have: string[] | undefined, want?: string[]) => !want?.length || want.some((w) => (have ?? []).includes(w));

/** How alike two assets are: shared tags, then tempo. */
export function closeness(a: LibraryAsset, b: LibraryAsset) {
  const share = (x: string[] = [], y: string[] = []) => x.filter((t) => y.includes(t)).length;
  let s = share(a.genres, b.genres) * 3 + share(a.moods, b.moods) * 2 + share(a.themes, b.themes) + share(a.instruments, b.instruments);
  if (a.category && a.category === b.category) s += 3;
  if (a.bpm && b.bpm) s += Math.max(0, 2 - Math.abs(a.bpm - b.bpm) / 10);
  if (a.vocals === b.vocals) s += 0.5;
  return s;
}

export async function searchLibrary(o: LibraryQuery): Promise<{ items: LibraryAsset[]; total: number }> {
  const shelf = o.shelf ?? "all";
  let pool: LibraryAsset[] = [];
  if (shelf === "all" || shelf === "catalog") pool.push(...(await catalog()));
  if (shelf === "all" || shelf === "mine") pool.push(...(await myAssets()));
  if (shelf === "favorites" || shelf === "board") {
    const ids = shelf === "favorites" ? await favorites() : ((await boards()).find((b) => b.id === o.boardId)?.assetIds ?? []);
    const all = [...(await myAssets()), ...(await catalog())];
    pool = ids.map((id) => all.find((a) => a.id === id)).filter((a): a is LibraryAsset => !!a);
  }
  const tempo = TEMPOS.find((t) => t.id === o.tempo);
  const length = LENGTHS.find((l) => l.id === o.length);
  const words = (o.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  let items = pool.filter((a) => {
    if (a.kind !== o.kind) return false;
    if (!anyOf(a.genres, o.genres) || !anyOf(a.moods, o.moods) || !anyOf(a.themes, o.themes) || !anyOf(a.instruments, o.instruments)) return false;
    if (o.categories?.length && !o.categories.includes(a.category ?? "")) return false;
    if (o.vocals === "instrumental" && a.vocals) return false;
    if (o.vocals === "vocals" && !a.vocals) return false;
    if (tempo && !(a.bpm && a.bpm >= tempo.min && a.bpm <= tempo.max)) return false;
    if (length && !(a.seconds >= length.min && a.seconds <= length.max)) return false;
    if (words.length) {
      const hay = [a.title, a.description, a.category, a.key, ...a.genres, ...a.moods, ...a.themes, ...a.instruments].join(" ").toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  if (o.similarTo) {
    const ref = await findAsset(o.similarTo);
    if (ref) items = items.filter((a) => a.id !== ref.id).sort((a, b) => closeness(ref, b) - closeness(ref, a));
  } else {
    const by: Record<SortId, (a: LibraryAsset, b: LibraryAsset) => number> = {
      new: (a, b) => b.createdAt.localeCompare(a.createdAt),
      popular: (a, b) => b.downloads - a.downloads || b.createdAt.localeCompare(a.createdAt),
      short: (a, b) => a.seconds - b.seconds,
      long: (a, b) => b.seconds - a.seconds,
    };
    if (shelf !== "board" && shelf !== "favorites") items.sort(by[o.sort ?? "new"]);
  }
  return { items: items.slice(0, Math.min(200, o.limit ?? 60)), total: items.length };
}

/* ── Favorites and boards ─────────────────────────────────────── */
export const favorites = async () => (await kvGet<string[]>(FAVORITES)) ?? [];
export async function toggleFavorite(assetId: string): Promise<boolean> {
  if (!(await findAsset(assetId))) throw new Error("That item isn't in the Library any more.");
  const list = await favorites();
  const on = !list.includes(assetId);
  await kvSet(FAVORITES, on ? [assetId, ...list].slice(0, 2000) : list.filter((x) => x !== assetId));
  return on;
}

export const boards = async () => (await kvGet<Board[]>(BOARDS)) ?? [];
export async function createBoard(name: string): Promise<Board> {
  const n = name.trim().slice(0, 60);
  if (!n) throw new Error("Name the board.");
  const list = await boards();
  if (list.length >= MAX_BOARDS) throw new Error(`You can have up to ${MAX_BOARDS} boards.`);
  const b: Board = { id: uid("brd"), name: n, assetIds: [], createdAt: nowIso() };
  await kvSet(BOARDS, [b, ...list]);
  return b;
}
export async function updateBoard(boardId: string, change: { add?: string; remove?: string; name?: string; delete?: boolean }) {
  const list = await boards();
  const b = list.find((x) => x.id === boardId);
  if (!b) throw new Error("That board wasn't found.");
  if (change.delete) return kvSet(BOARDS, list.filter((x) => x.id !== boardId));
  if (change.name?.trim()) b.name = change.name.trim().slice(0, 60);
  if (change.add) {
    if (!(await findAsset(change.add))) throw new Error("That item isn't in the Library any more.");
    if (!b.assetIds.includes(change.add)) b.assetIds = [change.add, ...b.assetIds].slice(0, 1000);
  }
  if (change.remove) b.assetIds = b.assetIds.filter((x) => x !== change.remove);
  await kvSet(BOARDS, list);
}

/* ── Files, downloads and the license ─────────────────────────── */
async function mediaOf(owner: string, id: string) {
  return asUser(owner, () => db().get<MediaItem>("media", id));
}

/** Links the browser plays and shows (for a few hours). */
export function assetUrls(a: LibraryAsset) {
  return {
    previewUrl: signedUrl(a.owner, a.previewId, 6 * 3600),
    posterUrl: a.posterId ? signedUrl(a.owner, a.posterId, 6 * 3600) : undefined,
  };
}

export const licenseText = (a: LibraryAsset, licensee: { name?: string; email: string }, when = nowIso()) =>
  [
    "GHOST POST CONTENT LICENSE",
    "",
    `Item: ${a.title} (${a.kind === "sfx" ? "sound effect" : a.kind}, ${a.id})`,
    `Licensed to: ${licensee.name ? `${licensee.name} <${licensee.email}>` : licensee.email}`,
    `Date: ${when.slice(0, 10)}`,
    `Made with: ${a.model}, run on Ghost Post's own engine`,
    "",
    "You may use this item, edited or as it is, in videos, podcasts, ads, social media posts, films, games and other",
    "projects, for personal and commercial use, worldwide and with no further fee, including after your subscription",
    "ends for projects published while it was active.",
    "You may not sell, share or give away the item on its own (as a file, in a sound or music library, or as a",
    "template), claim it as your own composition with a rights-collection society, or register it with a content",
    "identification system (such as YouTube Content ID).",
    "The item was generated by AI. Like any AI-made work it may resemble existing works by chance; you are",
    "responsible for checking your finished project does not infringe anyone else's rights, trademarks or likeness.",
  ].join("\n");

/** Whether the person's plan includes downloading (free accounts can listen, watch and save to boards). */
export const canDownload = (plan: string | undefined, role?: string) => role === "admin" || (!!plan && plan !== "free");

/** A one-time download link for the full-quality file, and the download count goes up. */
export async function downloadLink(a: LibraryAsset): Promise<{ url: string; fileName: string }> {
  const m = await mediaOf(a.owner, a.mediaId);
  if (!m) throw new Error("That file is missing from storage.");
  const ext = m.type === "video/mp4" ? "mp4" : m.type === "audio/mpeg" ? "mp3" : "wav";
  const fileName = `${a.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || a.kind}-ghostpost.${ext}`;
  await serial(async () => {
    if (a.owner === GLOBAL) {
      const list = await catalog();
      const it = list.find((x) => x.id === a.id);
      if (it) {
        it.downloads++;
        await saveCatalog(list);
      }
    } else {
      const list = await myAssets();
      const it = list.find((x) => x.id === a.id);
      if (it) {
        it.downloads++;
        await kvSet(MINE, list);
      }
    }
  });
  return { url: `${signedUrl(a.owner, a.mediaId, 15 * 60)}&dl=${fileName}`, fileName };
}

/* ── Catalog management (admins) ──────────────────────────────── */
/** Copies one of the admin's own assets into the catalog for every subscriber. */
export async function publishToCatalog(assetId: string): Promise<LibraryAsset> {
  const a = (await myAssets()).find((x) => x.id === assetId);
  if (!a) throw new Error("Only things in your own library can be published.");
  const copy = async (mediaId: string | undefined) => {
    if (!mediaId) return undefined;
    const m = await db().get<MediaItem>("media", mediaId);
    if (!m) throw new Error("A file of that item is missing.");
    const bytes = await readFile(m);
    return (await asUser(GLOBAL, () => storeFile(GLOBAL, { name: m.name, type: m.type, bytes }, { uncapped: true }))).id;
  };
  const mediaId = (await copy(a.mediaId))!;
  const previewId = a.previewId === a.mediaId ? mediaId : (await copy(a.previewId))!;
  const out: LibraryAsset = { ...a, id: uid("cat"), owner: GLOBAL, mediaId, previewId, posterId: await copy(a.posterId), downloads: 0, createdAt: nowIso() };
  return addAsset(out);
}

/** Removes an asset (the person's own, or, for admins, a catalog item) and its files. */
export async function deleteAsset(assetId: string, isAdmin: boolean) {
  await serial(async () => {
    const mine = await myAssets();
    let a = mine.find((x) => x.id === assetId);
    if (a) await kvSet(MINE, mine.filter((x) => x.id !== assetId));
    else if (isAdmin) {
      const cat = await catalog();
      a = cat.find((x) => x.id === assetId);
      if (a) await saveCatalog(cat.filter((x) => x.id !== assetId));
    }
    if (!a) throw new Error("That item wasn't found.");
    const owner = a.owner;
    const ids = [...new Set([a.mediaId, a.previewId, a.posterId].filter(Boolean) as string[])];
    await asUser(owner, async () => {
      for (const id of ids) {
        const m = await db().get<MediaItem>("media", id);
        if (m) await deleteFile(m);
      }
    });
  });
}
