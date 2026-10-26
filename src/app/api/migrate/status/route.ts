import { importStatus } from "@/lib/migrate";

export const dynamic = "force-dynamic";

/** New server: how the move is going (no secrets in it). */
export async function GET() {
  if (!process.env.MIGRATE_FROM) return Response.json({ error: "Not set up to receive a move." }, { status: 404 });
  return Response.json({ ...(await importStatus()), from: process.env.MIGRATE_FROM }, { headers: { "Cache-Control": "no-store" } });
}
