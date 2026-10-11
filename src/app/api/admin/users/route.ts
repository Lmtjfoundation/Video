import { authed, body, ok } from "@/lib/http-api";
import { adminUpdateUser, adminUsers, type UserPatch } from "@/lib/admin";

export const dynamic = "force-dynamic";

export const GET = authed(async () => ok(await adminUsers()), { admin: true });
export const PATCH = authed(async (req, user) => ok(await adminUpdateUser(user, await body<UserPatch>(req))), { admin: true });
