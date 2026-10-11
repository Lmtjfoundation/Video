import { authed, body, ok } from "@/lib/http-api";
import { adminContent, adminReview, type ReviewAction } from "@/lib/admin";

export const dynamic = "force-dynamic";

export const GET = authed(async (req) => ok(await adminContent(new URL(req.url).searchParams.get("status") ?? "pending_review")), { admin: true });
export const PATCH = authed(async (req, user) => ok(await adminReview(user, await body<ReviewAction>(req))), { admin: true });
