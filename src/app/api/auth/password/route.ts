import { NextResponse } from "next/server";
import { authed, body, fail } from "@/lib/http-api";
import { createSession, destroyAllSessions, hashPassword, saveUser, sessionCookie, validatePassword, verifyPassword } from "@/lib/auth";
import { log } from "@/lib/repo";

export const dynamic = "force-dynamic";

/** Change your own password. Signs out every other device. */
export const POST = authed(async (req, user) => {
  const b = await body<{ current: string; next: string }>(req);
  if (!(await verifyPassword(b.current ?? "", user.passwordHash))) return fail("Your current password is incorrect.", 403);
  const bad = validatePassword(b.next ?? "");
  if (bad) return fail(bad);
  user.passwordHash = await hashPassword(b.next);
  await saveUser(user);
  await destroyAllSessions(user.id);
  const token = await createSession(user.id);
  await log("info", "system", "Password changed; other devices signed out");
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", sessionCookie(token));
  return res;
});
