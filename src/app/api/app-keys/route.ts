import { body, fail, authed, ok } from "@/lib/http-api";
import { deleteAppKeys, getAppKeys, saveAppKeys } from "@/lib/app-keys";
import { OAUTH } from "@/lib/oauth-config";
import { credentialStatuses, log } from "@/lib/repo";
import type { Platform } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Save a platform's developer-app ID and secret from the Setup Wizard (stored encrypted). */
export const POST = authed(async (req: Request) => {
  const { platform, id, secret } = await body<{ platform: Platform; id: string; secret: string }>(req);
  if (!PLATFORMS.includes(platform)) return fail("Unknown platform");
  const label = OAUTH[platform].label;
  if (!id?.trim() || !secret?.trim()) return fail(`Paste both the ${label} app ID and the secret.`);
  if (/\s/.test(id.trim()) || /\s/.test(secret.trim())) return fail("The ID and secret can't contain spaces. Copy them again without extra text.");
  if (id.trim() === secret.trim()) return fail("The ID and the secret are the same. The secret is a different, longer value in the developer portal.");
  const current = await getAppKeys(platform);
  if (current?.source === "env") return fail(`${label} keys are set in your environment variables, which take priority. Change them there.`);
  await saveAppKeys(platform, id, secret);
  await log("info", "system", `${label} app keys saved — the Connect button is now active`, { platform });
  return ok(await credentialStatuses());
}, { admin: true });

export const DELETE = authed(async (req: Request) => {
  const platform = new URL(req.url).searchParams.get("platform") as Platform;
  if (!PLATFORMS.includes(platform)) return fail("Unknown platform");
  await deleteAppKeys(platform);
  await log("info", "system", `${OAUTH[platform].label} app keys removed`, { platform });
  return ok(await credentialStatuses());
}, { admin: true });
