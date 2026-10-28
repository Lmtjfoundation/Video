import { body, fail, authed, ok } from "@/lib/http-api";
import { credentialStatuses, deleteCredential, getCredential, log, saveCredential } from "@/lib/repo";
import type { Credential, Platform } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";
import { webhookUrlProblem } from "@/lib/platforms/webhook-guard";
import { isAccountId, MAX_EXTRA_ACCOUNTS, MULTI_ACCOUNT, newAccountId, withAccount } from "@/lib/account-slot";

export const dynamic = "force-dynamic";

/** Never returns secret values — only which fields are stored. */
export const GET = authed(async () => ok(await credentialStatuses()));

export const POST = authed(async (req: Request) => {
  const { platform, account: rawAccount, ...fields } = await body<{ platform: Platform; account?: string } & Credential>(req);
  if (!PLATFORMS.includes(platform)) return fail("Unknown platform");
  // account: "new" adds another account on this network with a pasted token; an existing id updates that account.
  let account: string | undefined;
  if (rawAccount) {
    if (!MULTI_ACCOUNT.includes(platform)) return fail("This network holds one account.");
    const st = (await credentialStatuses()).find((s) => s.platform === platform);
    if (rawAccount === "new") {
      if (!st?.direct) return fail("Connect your main account first, then add more.");
      if ((st.accounts?.length ?? 0) >= MAX_EXTRA_ACCOUNTS) return fail(`Up to ${MAX_EXTRA_ACCOUNTS + 1} accounts per network.`);
      account = newAccountId();
    } else if (isAccountId(rawAccount) && st?.accounts?.some((a) => a.id === rawAccount)) account = rawAccount;
    else return fail("That account isn't connected anymore.");
  }
  return withAccount(account, () => saveFields(platform, fields));
});

async function saveFields(platform: Platform, fields: Credential) {
  const existing = (await getCredential(platform)) ?? {};
  // Blank inputs keep the stored value, so users can update one field at a time.
  const merged: Credential = { ...existing };
  (Object.keys(fields) as (keyof Credential)[]).forEach((k) => {
    const v = fields[k];
    if (typeof v === "string" && v.trim()) merged[k] = v.trim();
  });
  if (platform === "webhook") {
    if (!merged.accessToken) return fail("Paste your webhook URL.");
    const problem = webhookUrlProblem(merged.accessToken);
    if (problem) return fail(problem);
    merged.method = "manual";
  }
  if (!merged.accessToken) return fail("An access token is required.");
  // A pasted Page token switches Facebook to automatic Page posting.
  if (platform === "facebook") merged.mode = "page";
  await saveCredential(platform, merged);
  await log("info", "system", `Credentials updated for ${platform}${merged.handle ? ` (${merged.handle})` : ""}`, { platform });
  return ok(await withAccount(undefined, credentialStatuses));
}

export const DELETE = authed(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const platform = q.get("platform") as Platform;
  if (!PLATFORMS.includes(platform)) return fail("Unknown platform");
  const account = q.get("account");
  if (account && !isAccountId(account)) return fail("Unknown account");
  // Connected through the social connect service: unlink it there too (safe when it wasn't).
  const up = await import("@/lib/upload-post");
  if (!account && up.isUpPlatform(platform) && (await up.uploadPostReady())) await up.disconnect(platform).catch(() => {});
  await withAccount(account ?? undefined, () => deleteCredential(platform));
  // Disconnecting the main account: the next extra account becomes the main one, so none are hidden.
  const next = !account ? (await credentialStatuses()).find((s) => s.platform === platform)?.accounts?.[0] : undefined;
  if (next) {
    const cred = await withAccount(next.id, () => getCredential(platform));
    if (cred) await saveCredential(platform, cred);
    await withAccount(next.id, () => deleteCredential(platform));
  }
  await log("info", "system", `Disconnected ${account ? "an extra" : "the main"} ${platform} account`, { platform });
  return ok(await credentialStatuses());
});
