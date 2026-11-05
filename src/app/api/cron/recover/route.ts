import { cronAuthorized, fail, handle, ok } from "@/lib/http-api";
import { recoverAccount } from "@/lib/auth";
import { appOrigin } from "@/lib/oauth";
import { log } from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * Owner recovery for someone locked out (no email set up yet): POST with the server's CRON_SECRET and
 * { email }. Clears the sign-in lock and returns a one-hour, single-use "choose a new password" link.
 * Only someone with access to the server's settings can call it.
 */
export const POST = handle(async (req: Request) => {
  if (!cronAuthorized(req)) return fail("Unauthorized", 401);
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  const r = await recoverAccount(String(email ?? ""));
  if (!r) return fail("No account with that email.", 404);
  await log("info", "system", `Owner recovery: reset link made for ${r.user.email}`).catch(() => {});
  return ok({ link: `${appOrigin(req)}/reset?token=${encodeURIComponent(r.token)}`, email: r.user.email, expiresInMinutes: 60 });
});
