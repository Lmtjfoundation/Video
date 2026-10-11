import { authed, ok } from "@/lib/http-api";
import { adminStats } from "@/lib/admin";

export const dynamic = "force-dynamic";

export const GET = authed(async () => ok(await adminStats()), { admin: true });
