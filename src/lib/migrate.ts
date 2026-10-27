import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { createReadStream, createWriteStream, promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { gdb, storageMode } from "./db";
import { OAUTH } from "./oauth-config";

/**
 * Moving Ghost Post to a new server, server to server, without secrets passing through anyone's hands:
 *   1. On the old server the owner makes a one-time code (Admin → App settings → Move to a new server).
 *   2. On the new server (empty, started with MIGRATE_FROM = the old address) the owner pastes the code.
 *   3. The new server asks the old one for its settings and the list of its files, copies every file, writes the
 *      settings where the service manager reads them, and restarts as the same app.
 *   4. The old server then sends every visitor to the new address and stops its scheduler, so nothing posts twice.
 */
const ROW = "migrate";
const CODE_MINUTES = 15;
/** After the code is used, the new server has this long to copy the files. */
const COPY_HOURS = 6;

type MigrateState = { hash: string; expires: number; claimedAt?: number; movedTo?: string };

/** The server settings that travel. Everything else (address, port, data folder) belongs to the new server. */
const CARRY = [
  "ADMIN_EMAILS", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "ANTHROPIC_PREMIUM_MODEL", "ANTHROPIC_WORKSPACE_ID", "COMMUNITY_POOL_DAILY_MAX",
  "CONTENT_INBOX", "CONTENT_INBOX_OWNER", "CONTENT_INBOX_URL", "CRON_SECRET", "ELEVENLABS_API_KEY", "ELEVENLABS_MODEL_ID", "ELEVENLABS_VOICE_ID",
  "EMAIL_FROM", "ENCRYPTION_KEY", "FACEBOOK_GRAPH_VERSION", "FREE_VOICE", "GEMINI_API_KEY", "GEMINI_IMAGE_MODEL", "GEMINI_MODEL", "LEGAL_JURISDICTION",
  "LEGAL_NAME", "LINKEDIN_API_VERSION", "MAX_UPLOAD_MB", "META_GRAPH_HOST", "META_GRAPH_VERSION", "METRICOOL_API_URL", "OMNI_MODEL", "PEXELS_API_KEY",
  "PIXABAY_API_KEY", "REPLICATE_API_TOKEN", "RESEND_API_KEY", "SETUP_CODE", "STRIPE_PORTAL_CONFIGURATION", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL", "SUPPORT_EMAIL", "VEO_MODEL", "VIDEO_ENGINE_GPU_TOKEN", "VIDEO_ENGINE_GPU_URL", "VIDEO_ENGINE_TOKEN",
  "VIDEO_ENGINE_URL", "VM_WAKE", "VM_WAKE_GPU", "WHISPER_MODEL", "YOUTUBE_CATEGORY_ID", "YOUTUBE_PRIVACY",
];
const CARRY_PREFIX = ["STRIPE_PRICE_", "STRIPE_COUPON_"];
/** Folders inside the data folder that are only caches (AI models download again by themselves). */
const SKIP = new Set(["models", "tmp", ".cache"]);

export const dataDir = () => process.env.DATA_DIR || path.join(process.cwd(), ".data");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

async function state() {
  return (await gdb().get<{ id: string; value: MigrateState }>("kv", ROW))?.value ?? null;
}
async function setState(v: MigrateState) {
  await gdb().upsert("kv", { id: ROW, value: v });
}

/** Step 1, old server: a new one-time code. Any earlier code stops working. */
export async function createMigrateCode() {
  const code = randomBytes(24).toString("base64url");
  await setState({ hash: sha(code), expires: Date.now() + CODE_MINUTES * 60_000 });
  return { code, minutes: CODE_MINUTES };
}

export class MigrateError extends Error {}

/** Whether `code` is the current code. `forFiles`: the code was already used and the copy window is still open. */
async function check(code: string, forFiles: boolean) {
  const s = await state();
  const ok = !!s && code.length > 20 && timingSafeEqual(Buffer.from(sha(code)), Buffer.from(s.hash));
  if (!ok || !s) throw new MigrateError("That code isn't valid. Make a new one on the old server.");
  if (forFiles) {
    if (!s.claimedAt || Date.now() > s.claimedAt + COPY_HOURS * 3_600_000) throw new MigrateError("This move has expired. Make a new code on the old server.");
  } else {
    if (s.claimedAt) throw new MigrateError("That code was already used. Make a new one on the old server.");
    if (Date.now() > s.expires) throw new MigrateError("That code has expired (codes last 15 minutes). Make a new one on the old server.");
  }
  return s;
}

/** Every file in the data folder, as paths relative to it. */
async function listFiles(dir = dataDir(), rel = ""): Promise<{ path: string; size: number }[]> {
  const out: { path: string; size: number }[] = [];
  let entries: import("fs").Dirent[] = [];
  try {
    entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (!rel && (SKIP.has(e.name) || e.name.startsWith(".migrate") || e.name === "app.env")) continue;
    if (/\.(tmp|part|incoming)$/.test(e.name)) continue; // half-written files
    if (e.isDirectory()) out.push(...(await listFiles(dir, r)));
    else if (e.isFile()) out.push({ path: r, size: (await fs.stat(path.join(dir, r))).size });
  }
  return out;
}

export type Manifest = { storage: "local" | "supabase"; env: Record<string, string>; files: { path: string; size: number }[] };

/** Step 3, old server: what the new server needs. Works once per code. */
export async function exportManifest(code: string): Promise<Manifest> {
  const s = await check(code, false);
  await setState({ ...s, claimedAt: Date.now() });
  const oauthEnv = Object.values(OAUTH).flatMap((o) => [o.env.id, o.env.secret]);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => !!v && (CARRY.includes(k) || oauthEnv.includes(k) || CARRY_PREFIX.some((p) => k.startsWith(p)))) as [string, string][],
  );
  const storage = storageMode();
  return { storage, env, files: storage === "local" ? await listFiles() : [] };
}

/** A file inside the data folder, never outside it. */
export function safeDataPath(rel: string) {
  const root = path.resolve(dataDir());
  const full = path.resolve(root, rel);
  if (!rel || rel.includes("\0") || !full.startsWith(root + path.sep)) throw new MigrateError("Not a file the move can copy.");
  return full;
}

/** Step 3, old server: one file's bytes. */
export async function exportFile(code: string, rel: string) {
  await check(code, true);
  const full = safeDataPath(rel);
  const st = await fs.stat(full).catch(() => null);
  if (!st?.isFile()) throw new MigrateError("That file isn't there any more.");
  return { stream: Readable.toWeb(createReadStream(full)) as ReadableStream, size: st.size };
}

/** Step 4, old server: from now on every visitor goes to the new address and the scheduler stops. */
export async function markMoved(code: string, to: string) {
  const s = await check(code, true);
  const url = new URL(to);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname); // a test on one machine
  if (url.protocol !== "https:" && !local) throw new MigrateError("The new address must start with https://.");
  await setState({ ...s, movedTo: url.origin });
  movedCache = { to: url.origin, at: Date.now() };
}

let movedCache: { to: string | null; at: number } | null = null;
/** The new address once this server has been moved (checked at most every 30 seconds). */
export async function movedTo(): Promise<string | null> {
  if (process.env.MOVED_TO) return process.env.MOVED_TO.replace(/\/$/, "");
  if (movedCache && Date.now() - movedCache.at < 30_000) return movedCache.to;
  const to = (await state().catch(() => null))?.movedTo ?? null;
  movedCache = { to, at: Date.now() };
  return to;
}

/* ---------------- New server ---------------- */

export type ImportStatus = { state: "idle" | "copying" | "done" | "failed"; copied: number; total: number; bytes: number; message?: string; at: number };
const statusFile = () => path.join(dataDir(), ".migrate-status.json");
export async function importStatus(): Promise<ImportStatus> {
  try {
    return JSON.parse(await fs.readFile(statusFile(), "utf8")) as ImportStatus;
  } catch {
    return { state: "idle", copied: 0, total: 0, bytes: 0, at: 0 };
  }
}
const writeStatus = (s: Omit<ImportStatus, "at">) => fs.mkdir(dataDir(), { recursive: true }).then(() => fs.writeFile(statusFile(), JSON.stringify({ ...s, at: Date.now() })));

/** Env file line for systemd's EnvironmentFile: double-quoted, with backslashes, quotes and newlines escaped. */
export const envLine = (k: string, v: string) => `${k}="${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;

/**
 * Step 3, new server: copies everything from `from` with `code`, then writes the settings to DATA_DIR/app.env
 * (the service reads it on start) and tells the old server it moved. Database last, so a half-finished copy never
 * looks like a working app. Returns when finished; the caller restarts the server.
 */
export async function importFrom(from: string, code: string, self: string, fetcher: typeof fetch = fetch) {
  const base = from.replace(/\/$/, "");
  const q = (p: string) => `${base}/api/migrate/${p}${p.includes("?") ? "&" : "?"}code=${encodeURIComponent(code)}`;
  try {
    const res = await fetcher(q("export"), { cache: "no-store" });
    const j = (await res.json().catch(() => ({}))) as Manifest & { error?: string };
    if (!res.ok) throw new Error(j.error || `The old server answered ${res.status}.`);
    const files = [...j.files].sort((a, b) => Number(a.path === "db.json") - Number(b.path === "db.json"));
    let copied = 0;
    let bytes = 0;
    await writeStatus({ state: "copying", copied, total: files.length, bytes });
    for (const f of files) {
      // The database takes its place when the server restarts (see LocalBackend.load in db.ts).
      const dest = safeDataPath(f.path === "db.json" ? "db.json.incoming" : f.path);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      const r = await fetcher(q(`file?path=${encodeURIComponent(f.path)}`), { cache: "no-store" });
      if (!r.ok || !r.body) throw new Error(`Couldn't copy ${f.path} (${r.status}).`);
      const tmp = `${dest}.part`;
      await pipeline(Readable.fromWeb(r.body as import("stream/web").ReadableStream), createWriteStream(tmp));
      await fs.rename(tmp, dest);
      copied++;
      bytes += f.size;
      if (copied % 20 === 0) await writeStatus({ state: "copying", copied, total: files.length, bytes });
    }
    const lines = Object.entries(j.env).map(([k, v]) => envLine(k, v));
    await fs.writeFile(path.join(dataDir(), "app.env"), `# Settings moved from ${base} on ${new Date().toISOString()}\n${lines.join("\n")}\n`, { mode: 0o600 });
    await fetcher(q(`done?to=${encodeURIComponent(self)}`), { method: "POST" }).catch(() => null);
    await writeStatus({ state: "done", copied, total: files.length, bytes, message: `Moved ${copied} files and ${Object.keys(j.env).length} settings.` });
  } catch (e) {
    await writeStatus({ state: "failed", copied: 0, total: 0, bytes: 0, message: (e as Error).message });
    throw e;
  }
}
