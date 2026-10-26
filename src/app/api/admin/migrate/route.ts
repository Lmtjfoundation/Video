import { authed, ok } from "@/lib/http-api";
import { createMigrateCode } from "@/lib/migrate";

export const dynamic = "force-dynamic";

/** Admin → App settings → Move to a new server: a one-time code for the new server (15 minutes). */
export const POST = authed(async () => ok(await createMigrateCode()), { admin: true });
