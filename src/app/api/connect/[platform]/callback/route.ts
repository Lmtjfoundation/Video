import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { appOrigin, finishAuth, pendingAccount } from "@/lib/oauth";
import { withAccount } from "@/lib/account-slot";
import { OAUTH, isOAuthPlatform } from "@/lib/oauth-config";
import { credentialStatuses, log, saveCredential } from "@/lib/repo";
import { listFacebookPages } from "@/lib/facebook-pages";
import type { Platform } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The platform sends the user back here with ?code=…&state=… after they approve (or ?error=… if they cancel). */
export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.redirect(`${appOrigin(req)}/login?next=${encodeURIComponent("/platforms")}`);
  return asUser(user.id, () => run(req, ctx));
}

async function run(req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const url = new URL(req.url);
  const origin = appOrigin(req);
  // Back to where linking started: the "Connect your accounts" screen after sign-in, or the Platforms tab.
  const ret = req.headers.get("cookie")?.match(/(?:^|;\s*)gp_connect_return=([^;]+)/)?.[1];
  const base = ret && /^\/(connect|platforms)(\?|$)/.test(decodeURIComponent(ret)) ? decodeURIComponent(ret) : "/platforms";
  const back = (q: Record<string, string>) => {
    const res = NextResponse.redirect(`${origin}${base}${base.includes("?") ? "&" : "?"}${new URLSearchParams(q)}`);
    res.cookies.delete("gp_connect_return");
    return res;
  };
  if (!PLATFORMS.includes(platform as Platform) || !isOAuthPlatform(platform)) return back({ error: "Unknown platform." });
  const p = platform;
  const label = OAUTH[p].label;

  const denied = url.searchParams.get("error");
  if (denied) {
    const why = url.searchParams.get("error_description") || url.searchParams.get("error_reason") || denied;
    await log("warn", "system", `${label} linking cancelled: ${why}`, { platform: p });
    return back({ error: `${label} linking was cancelled (${why}).` });
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back({ error: `${label} didn't return a sign-in code. Try again.` });

  try {
    const account = await pendingAccount(state);
    const cred = await finishAuth(p, code, state);
    if (account) {
      // An extra account: save it beside the main one. Signing in to an account that's already here just refreshes it.
      const all = (await credentialStatuses()).find((s) => s.platform === p);
      const same = cred.handle && all ? [{ id: undefined as string | undefined, handle: all.handle }, ...(all.accounts ?? [])].find((a) => a.handle === cred.handle) : undefined;
      await withAccount(same ? same.id : account, () => saveCredential(p, cred));
      await log("info", "system", same ? `${label} account ${cred.handle} was already connected — refreshed it` : `Added another ${label} account ${cred.handle ?? ""}`.trim(), { platform: p });
      return back({ connected: p });
    }
    await saveCredential(p, cred);
    if (p === "facebook" && cred.mode === "profile") {
      await log("info", "system", `Linked Facebook profile ${cred.handle ?? ""} — posts are prepared for you to share with one tap`.trim(), { platform: p });
      return back({ connected: p, mode: "profile" });
    }
    await log("info", "system", `Linked ${label} account ${cred.handle ?? ""}`.trim(), { platform: p });
    // A Page was found: the person can still switch to their own profile, or to another Page, on the Facebook card.
    if (p === "facebook" && (await listFacebookPages()).length >= 1) return back({ connected: p, pick: "facebook" });
    return back({ connected: p });
  } catch (e) {
    await log("error", "system", `${label} linking failed: ${(e as Error).message}`, { platform: p });
    return back({ error: `${label} linking failed: ${(e as Error).message.slice(0, 200)}` });
  }
}
