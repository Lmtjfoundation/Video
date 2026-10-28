import { listUsers, userFromRequest } from "@/lib/auth";
import { importStatus } from "@/lib/migrate";

export const dynamic = "force-dynamic";

/** New server: how the move is going, and whether this server already has data (no secrets in it). */
export async function GET(req: Request) {
  if (!process.env.MIGRATE_FROM) return Response.json({ error: "Not set up to receive a move." }, { status: 404 });
  const [status, users, me] = await Promise.all([importStatus(), listUsers(), userFromRequest(req).catch(() => null)]);
  return Response.json(
    { ...status, from: process.env.MIGRATE_FROM, hasAccounts: users.length > 0, signedInOwner: me?.role === "admin" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
