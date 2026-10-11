import "server-only";
import { db } from "./db";
import { decrypt, encrypt } from "./crypto";

/** A Facebook Page the linked person manages. `token` is a Page access token (secret). */
export interface FbPage {
  id: string;
  name: string;
  token: string;
}

const KEY = "fb_pages";

/** Page tokens are secrets, so the list is stored encrypted like other credentials. */
export async function saveFacebookPages(pages: FbPage[]) {
  await db().upsert("kv", { id: KEY, value: { cipher: encrypt(JSON.stringify(pages)) } });
}

export async function listFacebookPages(): Promise<FbPage[]> {
  const row = await db().get<{ id: string; value: { cipher: string } }>("kv", KEY);
  if (!row?.value?.cipher) return [];
  try {
    return JSON.parse(decrypt(row.value.cipher)) as FbPage[];
  } catch {
    return [];
  }
}

export async function clearFacebookPages() {
  await db().remove("kv", KEY);
}
