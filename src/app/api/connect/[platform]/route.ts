import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { appOrigin, startAuth } from "@/lib/oauth";
import { MAX_EXTRA_ACCOUNTS, MULTI_ACCOUNT, newAccountId } from "@/lib/account-slot";
import { credentialStatuses } from "@/lib/repo";
import { log } from "@/lib/repo";
import type { Platform } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";

export const dynamic = "force-dynamic";

/** "Connect with …" — sends the browser to the platform's own sign-in page. */
export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.redirect(`${appOrigin(req)}/login?next=${encodeURIComponent("/platforms")}`);
  return asUser(user.id, () => run(req, ctx));
}

async function run(req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const origin = appOrigin(req);
  const back = (q: Record<string, string>) => NextResponse.redirect(`${origin}/platforms?${new URLSearchParams(q)}`);
  if (!PLATFORMS.includes(platform as Platform)) return back({ error: "Unknown platform." });
  // ?account=new adds another account on this network (e.g. a second Instagram) instead of replacing the main one.
  let account: string | undefined;
  if (new URL(req.url).searchParams.get("account") === "new") {
    if (!MULTI_ACCOUNT.includes(platform as Platform)) return back({ error: "This network holds one account. Facebook switches between your Pages and profile on its card." });
    const st = (await credentialStatuses()).find((s) => s.platform === platform);
    if (!st?.direct) return back({ error: "Connect your main account first, then add more." });
    if ((st.accounts?.length ?? 0) >= MAX_EXTRA_ACCOUNTS) return back({ error: `Up to ${MAX_EXTRA_ACCOUNTS + 1} accounts per network.` });
    account = newAccountId();
  }
  try {
    return NextResponse.redirect(await startAuth(platform as Platform, origin, account));
  } catch (e) {
    await log("error", "system", `Couldn't start ${platform} linking: ${(e as Error).message}`, { platform: platform as Platform });
    return back({ error: (e as Error).message });
  }
}
