import "server-only";
import { gdb } from "./db";
import { decrypt, encrypt } from "./crypto";
import { OAUTH, isOAuthPlatform } from "./oauth-config";
import type { Platform } from "./types";

/**
 * Each platform's developer-app ID and secret ("app keys").
 * They can come from environment variables, or be pasted in the in-app Setup Wizard
 * (stored encrypted). Environment variables win when both exist.
 */
export interface AppKeys {
  id: string;
  secret: string;
  source: "env" | "app";
}

const key = (p: Platform) => `appkeys_${p}`;

export async function getAppKeys(platform: Platform): Promise<AppKeys | null> {
  if (!isOAuthPlatform(platform)) return null;
  const e = OAUTH[platform].env;
  const envId = process.env[e.id];
  const envSecret = process.env[e.secret];
  if (envId && envSecret) return { id: envId, secret: envSecret, source: "env" };
  const row = await gdb().get<{ id: string; value: { cipher: string } }>("kv", key(platform));
  if (!row?.value?.cipher) return null;
  try {
    const v = JSON.parse(decrypt(row.value.cipher)) as { id: string; secret: string };
    return v.id && v.secret ? { ...v, source: "app" } : null;
  } catch {
    return null;
  }
}

export async function saveAppKeys(platform: Platform, id: string, secret: string) {
  await gdb().upsert("kv", { id: key(platform), value: { cipher: encrypt(JSON.stringify({ id: id.trim(), secret: secret.trim() })) } });
}

export async function deleteAppKeys(platform: Platform) {
  await gdb().remove("kv", key(platform));
}

export async function oauthConfigured(platform: Platform) {
  return !!(await getAppKeys(platform));
}

/** Safe summary for the browser: never includes the secret. */
export async function appKeyStatus(platform: Platform) {
  const k = await getAppKeys(platform);
  if (!k) return { configured: false as const };
  const masked = k.id.length > 8 ? `${k.id.slice(0, 4)}…${k.id.slice(-4)}` : "••••";
  return { configured: true as const, source: k.source, idPreview: masked };
}
