import { NextResponse } from "next/server";
import { authed, body, fail } from "@/lib/http-api";
import { destroyAllSessions, listUsers, sessionCookie, verifyPassword } from "@/lib/auth";
import { gdb, purgeOwner } from "@/lib/db";
import { deleteFile, listMedia } from "@/lib/media";
import { cancelSubscription } from "@/lib/billing";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Self-serve account deletion (required by the App Store): cancels any subscription,
 * deletes uploads and every post, reply, log and linked account token, then the account itself.
 */
export const POST = authed(async (req, user) => {
  const { password, confirm } = await body<{ password: string; confirm: string }>(req);
  if (confirm !== "DELETE") return fail('Type DELETE to confirm.');
  if (!(await verifyPassword(password ?? "", user.passwordHash))) return fail("Password is incorrect.", 403);
  if (user.role === "admin" && (await listUsers()).filter((u) => u.role === "admin" && u.status === "active").length <= 1) {
    return fail("You're the only admin. Make someone else an admin first, or keep the account.");
  }
  if (user.billing?.subscriptionId) await cancelSubscription(user.billing.subscriptionId).catch(() => {});
  for (const m of await listMedia()) await deleteFile(m).catch(() => {});
  await purgeOwner(user.id);
  await destroyAllSessions(user.id);
  await gdb().removeMany("users", [user.id, `email:${user.email}`]);
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", sessionCookie(null));
  return res;
});
