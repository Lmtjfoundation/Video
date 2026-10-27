import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { promises as fs } from "fs";
import path from "path";

/**
 * Multi-tenant storage.
 * Every row belongs to an owner: a user id, or "_global" for app-wide data (users, sessions, platform app keys).
 * Per-user tables are scoped automatically to the signed-in user via `asUser()`; reading or writing them
 * without a user in context throws, so one customer's data can never leak into another's.
 */
export type Table =
  | "posts" | "replies" | "comments" | "logs" | "credentials" | "kv" | "rate_events"
  | "media" | "stories" | "reports"
  | "users" | "sessions" | "billing_events";

export interface Row {
  id: string;
}

const GLOBAL_TABLES: Table[] = ["users", "sessions", "billing_events"];
export const GLOBAL = "_global";

const tenant = new AsyncLocalStorage<string>();
/** Run `fn` with all per-user tables scoped to `userId`. */
export const asUser = <T>(userId: string, fn: () => Promise<T>) => tenant.run(userId, fn);
export const currentUserId = () => tenant.getStore() ?? null;
/** For one-off scripts and tests only: scope everything after this call to `userId`. */
export const enterUserForScript = (userId: string) => tenant.enterWith(userId);

interface Backend {
  all<T extends Row>(table: Table, owner: string | null, limit: number): Promise<{ owner: string; row: T }[]>;
  get<T extends Row>(table: Table, owner: string, id: string): Promise<T | null>;
  upsertMany<T extends Row>(table: Table, owner: string, rows: T[]): Promise<void>;
  removeMany(table: Table, owner: string, ids: string[]): Promise<void>;
  removeOwner(table: Table, owner: string): Promise<void>;
}

const pk = (owner: string, id: string) => `${owner}::${id}`;

/* ───────────────────────── Supabase backend ───────────────────────── */

class SupabaseBackend implements Backend {
  constructor(private sb: SupabaseClient) {}

  async all<T extends Row>(table: Table, owner: string | null, limit: number): Promise<{ owner: string; row: T }[]> {
    let q = this.sb.from(table).select("owner,data").order("updated_at", { ascending: false }).limit(limit);
    if (owner) q = q.eq("owner", owner);
    const { data, error } = await q;
    if (error) throw new Error(`Supabase ${table}: ${error.message}`);
    return (data ?? []).map((r: { owner: string; data: T }) => ({ owner: r.owner, row: r.data }));
  }

  async get<T extends Row>(table: Table, owner: string, id: string): Promise<T | null> {
    const { data, error } = await this.sb.from(table).select("data").eq("id", pk(owner, id)).maybeSingle();
    if (error) throw new Error(`Supabase ${table}: ${error.message}`);
    return (data?.data as T | undefined) ?? null;
  }

  async upsertMany<T extends Row>(table: Table, owner: string, rows: T[]) {
    if (!rows.length) return;
    const now = new Date().toISOString();
    const { error } = await this.sb.from(table).upsert(rows.map((r) => ({ id: pk(owner, r.id), owner, data: r, updated_at: now })));
    if (error) throw new Error(`Supabase ${table}: ${error.message}`);
  }

  async removeMany(table: Table, owner: string, ids: string[]) {
    if (!ids.length) return;
    const { error } = await this.sb.from(table).delete().in("id", ids.map((id) => pk(owner, id)));
    if (error) throw new Error(`Supabase ${table}: ${error.message}`);
  }

  async removeOwner(table: Table, owner: string) {
    const { error } = await this.sb.from(table).delete().eq("owner", owner);
    if (error) throw new Error(`Supabase ${table}: ${error.message}`);
  }
}

/* ───────────────────────── Local JSON backend ─────────────────────────
   Single-process only. Good for local use and a single VPS. Use Supabase on serverless. */

type Entry = { owner: string; row: Row; ts: number };
type LocalData = Partial<Record<Table, Record<string, Entry>>>;
const MAX_PER_OWNER: Partial<Record<Table, number>> = { logs: 3000, rate_events: 3000, comments: 3000 };
const g = globalThis as unknown as { __ghostPostLocal2?: { data: LocalData | null; chain: Promise<void> } };

class LocalBackend implements Backend {
  private file = path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "db.json");
  private state = (g.__ghostPostLocal2 ??= { data: null, chain: Promise.resolve() });

  private async load(): Promise<LocalData> {
    if (this.state.data) return this.state.data;
    // A database moved here from another server (src/lib/migrate.ts) arrives under its own name and takes its place
    // only now, when the server starts: the process that received it still holds the old one in memory and could
    // otherwise write that back over it.
    await fs.rename(this.file + ".incoming", this.file).catch(() => {});
    try {
      this.state.data = JSON.parse(await fs.readFile(this.file, "utf8")) as LocalData;
    } catch {
      this.state.data = {};
    }
    return this.state.data!;
  }

  private persist() {
    this.state.chain = this.state.chain
      .then(async () => {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const tmp = this.file + ".tmp";
        await fs.writeFile(tmp, JSON.stringify(this.state.data));
        await fs.rename(tmp, this.file);
      })
      .catch((e) => console.error("[ghost-post] local store write failed", e));
    return this.state.chain;
  }

  private prune(t: Record<string, Entry>, table: Table, owner: string) {
    const max = MAX_PER_OWNER[table];
    if (!max) return;
    const mine = Object.entries(t).filter(([, e]) => e.owner === owner);
    if (mine.length <= max) return;
    mine.sort((a, b) => b[1].ts - a[1].ts);
    for (const [k] of mine.slice(max)) delete t[k];
  }

  async all<T extends Row>(table: Table, owner: string | null, limit: number): Promise<{ owner: string; row: T }[]> {
    const t = (await this.load())[table] ?? {};
    return Object.values(t)
      .filter((e) => !owner || e.owner === owner)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit)
      .map((e) => ({ owner: e.owner, row: structuredClone(e.row) as T }));
  }

  async get<T extends Row>(table: Table, owner: string, id: string): Promise<T | null> {
    const e = (await this.load())[table]?.[pk(owner, id)];
    return e ? (structuredClone(e.row) as T) : null;
  }

  async upsertMany<T extends Row>(table: Table, owner: string, rows: T[]) {
    const data = await this.load();
    const t = (data[table] ??= {});
    const ts = Date.now();
    rows.forEach((r, i) => (t[pk(owner, r.id)] = { owner, row: structuredClone(r), ts: ts + i }));
    this.prune(t, table, owner);
    await this.persist();
  }

  async removeMany(table: Table, owner: string, ids: string[]) {
    const t = (await this.load())[table];
    if (!t) return;
    ids.forEach((id) => delete t[pk(owner, id)]);
    await this.persist();
  }

  async removeOwner(table: Table, owner: string) {
    const t = (await this.load())[table];
    if (!t) return;
    for (const [k, e] of Object.entries(t)) if (e.owner === owner) delete t[k];
    await this.persist();
  }
}

let backend: Backend | null = null;
function be(): Backend {
  if (backend) return backend;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  backend = url && key ? new SupabaseBackend(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })) : new LocalBackend();
  return backend;
}

/** A store bound to one owner. */
export class Store {
  constructor(private ownerFor: (table: Table) => string) {}
  async all<T extends Row>(table: Table, limit = 2000): Promise<T[]> {
    return (await be().all<T>(table, this.ownerFor(table), limit)).map((r) => r.row);
  }
  get<T extends Row>(table: Table, id: string) {
    return be().get<T>(table, this.ownerFor(table), id);
  }
  async upsert<T extends Row>(table: Table, row: T): Promise<T> {
    await be().upsertMany(table, this.ownerFor(table), [row]);
    return row;
  }
  upsertMany<T extends Row>(table: Table, rows: T[]) {
    return be().upsertMany(table, this.ownerFor(table), rows);
  }
  remove(table: Table, id: string) {
    return be().removeMany(table, this.ownerFor(table), [id]);
  }
  removeMany(table: Table, ids: string[]) {
    return be().removeMany(table, this.ownerFor(table), ids);
  }
}

/** Per-user tables use the current user; app-wide tables use the global owner. */
export function db(): Store {
  return new Store((table) => {
    if (GLOBAL_TABLES.includes(table)) return GLOBAL;
    const uid = currentUserId();
    if (!uid) throw new Error(`No signed-in user for "${table}". Wrap the call in asUser().`);
    return uid;
  });
}

/** App-wide store: platform app keys, admin settings. */
export const gdb = () => new Store(() => GLOBAL);

const USER_TABLES: Table[] = ["posts", "replies", "comments", "logs", "credentials", "kv", "rate_events", "media", "stories", "reports"];
/** Permanently deletes every per-user row for one account (account deletion). */
export async function purgeOwner(owner: string) {
  if (!owner || owner === GLOBAL) throw new Error("Refusing to purge global data.");
  for (const t of USER_TABLES) await be().removeOwner(t, owner);
}

/** Admin: read a table across every user. */
export async function allOwners<T extends Row>(table: Table, limit = 5000) {
  return be().all<T>(table, null, limit);
}

export const storageMode = () => (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "local");
