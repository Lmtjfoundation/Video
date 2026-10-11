import { body, fail, authed, ok } from "@/lib/http-api";
import { credentialStatuses, deleteCredential, getCredential, log, saveCredential } from "@/lib/repo";
import type { Credential, Platform } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Never returns secret values — only which fields are stored. */
export const GET = authed(async () => ok(await credentialStatuses()));

export const POST = authed(async (req: Request) => {
  const { platform, ...fields } = await body<{ platform: Platform } & Credential>(req);
  if (!PLATFORMS.includes(platform)) return fail("Unknown platform");
  const existing = (await getCredential(platform)) ?? {};
  // Blank inputs keep the stored value, so users can update one field at a time.
  const merged: Credential = { ...existing };
  (Object.keys(fields) as (keyof Credential)[]).forEach((k) => {
    const v = fields[k];
    if (typeof v === "string" && v.trim()) merged[k] = v.trim();
  });
  if (!merged.accessToken) return fail("An access token is required.");
  await saveCredential(platform, merged);
  await log("info", "system", `Credentials updated for ${platform}`, { platform });
  return ok(await credentialStatuses());
});

export const DELETE = authed(async (req: Request) => {
  const platform = new URL(req.url).searchParams.get("platform") as Platform;
  if (!PLATFORMS.includes(platform)) return fail("Unknown platform");
  await deleteCredential(platform);
  await log("info", "system", `Disconnected ${platform}`, { platform });
  return ok(await credentialStatuses());
});
