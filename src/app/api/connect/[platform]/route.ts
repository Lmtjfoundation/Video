import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { appOrigin, startAuth } from "@/lib/oauth";
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
  try {
    return NextResponse.redirect(await startAuth(platform as Platform, origin));
  } catch (e) {
    await log("error", "system", `Couldn't start ${platform} linking: ${(e as Error).message}`, { platform: platform as Platform });
    return back({ error: (e as Error).message });
  }
}
