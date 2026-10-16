import "server-only";
import { db } from "./db";
import { decrypt, encrypt } from "./crypto";
import { nowIso } from "./utils";
import { AI_PROVIDERS, type AiProvider, type OwnAiStatus } from "./ai-providers";

/**
 * A subscriber's own AI connection, stored in their own (tenant-scoped) kv row, with the key encrypted
 * (AES-256-GCM, ENCRYPTION_KEY). When it's set, every AI call for that subscriber goes to their provider,
 * on their key, and uses no credits. Without it, the app's own Claude key is used as before.
 */
const ROW = "own_ai";

interface Stored {
  provider: AiProvider;
  model: string;
  cipher: string;
  preview: string;
  updatedAt: string;
}

export interface OwnAi {
  provider: AiProvider;
  model: string;
  apiKey: string;
}

const mask = (v: string) => (v.length > 12 ? `${v.slice(0, 6)}…${v.slice(-4)}` : "••••");

async function read(): Promise<Stored | null> {
  const row = await db().get<{ id: string; value?: Stored | null }>("kv", ROW);
  return row?.value?.cipher ? row.value : null;
}

/** The current subscriber's own AI, or null to use the app's Claude key. */
export async function getOwnAi(): Promise<OwnAi | null> {
  let s: Stored | null;
  try {
    s = await read();
  } catch {
    return null; // no signed-in scope (e.g. a background job without a user): use the app's key
  }
  if (!s || !(s.provider in AI_PROVIDERS)) return null;
  try {
    return { provider: s.provider, model: s.model || AI_PROVIDERS[s.provider].defaultModel, apiKey: decrypt(s.cipher) };
  } catch {
    return null;
  }
}

export async function ownAiStatus(): Promise<OwnAiStatus | null> {
  const s = await read();
  return s ? { provider: s.provider, model: s.model, keyPreview: s.preview, updatedAt: s.updatedAt } : null;
}

/** Saves the provider, model and (optionally new) key. Keeps the stored key when `apiKey` is blank and the provider is unchanged. */
export async function saveOwnAi(provider: AiProvider, model: string, apiKey?: string) {
  const current = await read();
  const key = apiKey?.trim();
  let cipher: string;
  let preview: string;
  if (key) {
    cipher = encrypt(key);
    preview = mask(key);
  } else if (current && current.provider === provider) {
    cipher = current.cipher;
    preview = current.preview;
  } else {
    throw new Error(`Paste your ${AI_PROVIDERS[provider].name} API key.`);
  }
  const value: Stored = { provider, model: model.trim().slice(0, 120) || AI_PROVIDERS[provider].defaultModel, cipher, preview, updatedAt: nowIso() };
  await db().upsert("kv", { id: ROW, value });
  return ownAiStatus();
}

export async function clearOwnAi() {
  await db().upsert("kv", { id: ROW, value: null });
}
