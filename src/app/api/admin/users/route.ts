import { authed, body, fail, ok } from "@/lib/http-api";
import { adminUpdateUser, adminUsers, type UserPatch } from "@/lib/admin";
import { getUser, issueResetToken } from "@/lib/auth";
import { appOrigin } from "@/lib/oauth";
import { log } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const GET = authed(async () => ok(await adminUsers()), { admin: true });
export const PATCH = authed(async (req, user) => ok(await adminUpdateUser(user, await body<UserPatch>(req))), { admin: true });

/** `{ action: "reset-link", id }`: a one-hour, single-use "choose a new password" link to send the person yourself. */
export const POST = authed(async (req, admin) => {
  const b = await body<{ action?: string; id?: string }>(req);
  if (b.action !== "reset-link") return fail("Unknown action.");
  const u = await getUser(String(b.id ?? ""));
  if (!u) return fail("User not found.", 404);
  if (u.status !== "active") return fail("Reactivate this account first.");
  const link = `${appOrigin(req)}/reset?token=${encodeURIComponent(await issueResetToken(u.id))}`;
  await log("info", "system", `${admin.email} made a password reset link for ${u.email}`).catch(() => {});
  return ok({ link, email: u.email, expiresInMinutes: 60 });
}, { admin: true });
