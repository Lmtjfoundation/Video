import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { appOrigin, finishAuth } from "@/lib/oauth";
import { OAUTH, isOAuthPlatform } from "@/lib/oauth-config";
import { log, saveCredential } from "@/lib/repo";
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
  const back = (q: Record<string, string>) => NextResponse.redirect(`${origin}/platforms?${new URLSearchParams(q)}`);
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
    const cred = await finishAuth(p, code, state);
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
