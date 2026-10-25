import "server-only";
import { createHash, randomBytes } from "crypto";
import { gdb } from "./db";
import { getUser, type User } from "./auth";
import { kvGet, kvSet } from "./repo";
import { nowIso, uid } from "./utils";

/**
 * Personal API keys for the developer API (/api/v1): music, sound effects and footage from code, like Artlist's
 * Music API. A key is shown once; Ghost Post keeps only its SHA-256, plus an app-wide index from that hash to the
 * owner so a request can be matched without a session. Requests count against the owner's credits.
 */
export interface ApiKey {
  id: string;
  name: string;
  /** The first characters, to tell keys apart ("gp_live_ab12…"). */
  prefix: string;
  hash: string;
  createdAt: string;
  lastUsedAt?: string;
}
const ROW = "api-keys";
const MAX_KEYS = 10;
const indexId = (hash: string) => `apikey-${hash}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export const listKeys = async () => (await kvGet<ApiKey[]>(ROW)) ?? [];

/** Makes a key for the signed-in person; the full key is returned only here. */
export async function createKey(userId: string, name: string): Promise<{ key: string; record: ApiKey }> {
  const list = await listKeys();
  if (list.length >= MAX_KEYS) throw new Error(`You can have up to ${MAX_KEYS} keys. Revoke one first.`);
  const key = `gp_live_${randomBytes(24).toString("base64url")}`;
  const record: ApiKey = { id: uid("key"), name: name.trim().slice(0, 40) || "API key", prefix: key.slice(0, 12), hash: sha(key), createdAt: nowIso() };
  await kvSet(ROW, [record, ...list]);
  await gdb().upsert("kv", { id: indexId(record.hash), value: { userId, keyId: record.id } });
  return { key, record };
}

export async function revokeKey(keyId: string) {
  const list = await listKeys();
  const k = list.find((x) => x.id === keyId);
  if (!k) throw new Error("That key wasn't found.");
  await kvSet(ROW, list.filter((x) => x.id !== keyId));
  await gdb().remove("kv", indexId(k.hash));
}

/** The active account a Bearer key belongs to, or null. */
export async function userForKey(key: string): Promise<{ user: User; keyId: string } | null> {
  if (!/^gp_live_[A-Za-z0-9_-]{20,}$/.test(key)) return null;
  const row = await gdb().get<{ id: string; value: { userId: string; keyId: string } }>("kv", indexId(sha(key)));
  if (!row) return null;
  const user = await getUser(row.value.userId);
  if (!user || user.status !== "active") return null;
  return { user, keyId: row.value.keyId };
}

/** Notes when a key was last used (at most once a minute per key, to keep writes low). */
export async function touchKey(keyId: string) {
  const list = await listKeys();
  const k = list.find((x) => x.id === keyId);
  if (!k || (k.lastUsedAt && Date.now() - Date.parse(k.lastUsedAt) < 60_000)) return;
  k.lastUsedAt = nowIso();
  await kvSet(ROW, list);
}

/** At most `limit` requests a minute per key (in this server's memory). */
const hits = new Map<string, number[]>();
export function overLimit(keyId: string, limit = 60, now = Date.now()) {
  const recent = (hits.get(keyId) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(keyId, recent);
  return recent.length > limit;
}
