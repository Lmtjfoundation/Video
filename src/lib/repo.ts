import "server-only";
import { credKey, currentAccount, MULTI_ACCOUNT } from "./account-slot";
import { db } from "./db";
import { decrypt, encrypt } from "./crypto";
import { mergeSettings } from "./defaults";
import type {
  Credential,
  CredentialStatus,
  LogEntry,
  LogKind,
  LogLevel,
  Platform,
  Post,
  Reply,
  Settings,
  SocialComment,
} from "./types";
import { PLATFORMS } from "./types";
import { nowIso, uid } from "./utils";
import { appKeyStatus } from "./app-keys";
import { clearFacebookPages, listFacebookPages } from "./facebook-pages";
import { getMetricool, isMcPlatform } from "./metricool";

/* Settings */
export async function getSettings(): Promise<Settings> {
  const row = await db().get<{ id: string; value: Partial<Settings> }>("kv", "settings");
  return mergeSettings(row?.value);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = mergeSettings({ ...current, ...patch });
  await db().upsert("kv", { id: "settings", value: next });
  return next;
}

/* Generic kv */
export async function kvGet<T>(id: string): Promise<T | null> {
  const row = await db().get<{ id: string; value: T }>("kv", id);
  return row?.value ?? null;
}
export async function kvSet<T>(id: string, value: T) {
  await db().upsert("kv", { id, value });
}

/* Logs */
export async function log(
  level: LogLevel,
  kind: LogKind,
  message: string,
  meta?: Record<string, unknown> & { platform?: Platform },
) {
  const entry: LogEntry = { id: uid("log"), at: nowIso(), level, kind, message, platform: meta?.platform, meta };
  try {
    await db().upsert("logs", entry as unknown as LogEntry);
  } catch (e) {
    console.error("[ghost-post] failed to write log", e);
  }
  if (level === "error") console.error(`[ghost-post:${kind}] ${message}`, meta ?? "");
  return entry;
}

export const listLogs = (limit = 1000) => db().all<LogEntry>("logs", limit);

/* Posts */
export const listPosts = () => db().all<Post>("posts", 3000);
export const getPost = (id: string) => db().get<Post>("posts", id);
export async function savePost(p: Post) {
  p.updatedAt = nowIso();
  return db().upsert("posts", p as Post);
}
export const savePosts = (ps: Post[]) => {
  const t = nowIso();
  ps.forEach((p) => (p.updatedAt = t));
  return db().upsertMany("posts", ps as (Post)[]);
};
export const deletePost = (id: string) => db().remove("posts", id);

/* Comments + replies */
export const listComments = () => db().all<SocialComment>("comments", 5000);
export const saveComments = (cs: SocialComment[]) =>
  db().upsertMany("comments", cs as (SocialComment)[]);
export const listReplies = () => db().all<Reply>("replies", 3000);
export const getReply = (id: string) => db().get<Reply>("replies", id);
export async function saveReply(r: Reply) {
  r.updatedAt = nowIso();
  return db().upsert("replies", r as Reply);
}

/* Credentials — stored encrypted, never returned to the browser */
interface CredRow {
  id: string;
  cipher: string;
  fields: string[];
  updatedAt: string;
  /** Non-secret display info, safe to send to the browser. */
  handle?: string;
  expiresAt?: string;
  method?: string;
  /** Facebook: "page" or "profile" (non-secret, shown in the UI). */
  mode?: string;
  profileName?: string;
}

export async function getCredential(platform: Platform): Promise<Credential | null> {
  const row = await db().get<CredRow>("credentials", credKey(platform));
  if (!row) return null;
  try {
    return JSON.parse(decrypt(row.cipher)) as Credential;
  } catch {
    await log("error", "system", `Could not decrypt ${platform} credentials. Was ENCRYPTION_KEY changed?`, { platform });
    return null;
  }
}

export async function saveCredential(platform: Platform, cred: Credential) {
  const clean: Credential = {};
  (Object.keys(cred) as (keyof Credential)[]).forEach((k) => {
    const v = cred[k];
    if (typeof v === "string" && v.trim()) clean[k] = v.trim();
  });
  const row: CredRow = {
    id: credKey(platform),
    cipher: encrypt(JSON.stringify(clean)),
    fields: Object.keys(clean),
    updatedAt: nowIso(),
    handle: clean.handle,
    expiresAt: clean.expiresAt,
    method: clean.method ?? "manual",
    mode: clean.mode,
    profileName: clean.profileName,
  };
  await db().upsert("credentials", row as CredRow);
}

/** Merge new values into an existing credential (used after token refresh). */
export async function patchCredential(platform: Platform, patch: Partial<Credential>) {
  const cur = (await getCredential(platform)) ?? {};
  await saveCredential(platform, { ...cur, ...patch });
}

export async function deleteCredential(platform: Platform) {
  await db().remove("credentials", credKey(platform));
  if (platform === "facebook" && !currentAccount()) await clearFacebookPages();
}

export async function credentialStatuses(): Promise<CredentialStatus[]> {
  const rows = await db().all<CredRow>("credentials", 200);
  const fbPages = await listFacebookPages();
  const mc = await getMetricool();
  const keys = Object.fromEntries(await Promise.all(PLATFORMS.map(async (p) => [p, await appKeyStatus(p)] as const)));
  return PLATFORMS.map((p) => {
    const r = rows.find((x) => x.id === p);
    // A Facebook profile connection has no token: Facebook doesn't let apps post to profiles, so those posts are handed to the person.
    const profile = p === "facebook" && r?.mode === "profile";
    const direct = !!r && (r.fields.includes("accessToken") || profile);
    const viaMc = !!mc && isMcPlatform(p) && !!mc.use[p];
    return {
      platform: p,
      connected: direct || viaMc,
      direct,
      via: viaMc ? ("metricool" as const) : undefined,
      fields: r?.fields ?? [],
      updatedAt: r?.updatedAt,
      handle: r?.handle,
      expiresAt: r?.expiresAt,
      method: r?.method,
      oauthReady: keys[p].configured,
      keySource: keys[p].configured ? keys[p].source : undefined,
      keyPreview: keys[p].configured ? keys[p].idPreview : undefined,
      choices: p === "facebook" && fbPages.length ? fbPages.map(({ id, name }) => ({ id, name })) : undefined,
      mode: p === "facebook" && r ? (profile ? "profile" : "page") : undefined,
      profileName: p === "facebook" ? r?.profileName : undefined,
      viaInstagram: profile && r!.fields.includes("viaInstagram") ? true : undefined,
      accounts: MULTI_ACCOUNT.includes(p)
        ? rows.filter((x) => x.id.startsWith(`${p}:`)).map((x) => ({ id: x.id.slice(p.length + 1), handle: x.handle, method: x.method, updatedAt: x.updatedAt }))
        : undefined,
    };
  });
}
