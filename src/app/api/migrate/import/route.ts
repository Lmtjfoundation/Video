import { listUsers } from "@/lib/auth";
import { importFrom, importStatus } from "@/lib/migrate";
import { appOrigin } from "@/lib/oauth";

export const dynamic = "force-dynamic";

/**
 * New server: copy everything from the old server (MIGRATE_FROM) with the owner's one-time code. Only while this
 * server has no accounts, and only from the address the server was set up with, so nobody else can load data into it.
 */
export async function POST(req: Request) {
  const from = process.env.MIGRATE_FROM;
  if (!from) return Response.json({ error: "This server wasn't set up to receive a move (MIGRATE_FROM isn't set)." }, { status: 404 });
  if ((await listUsers()).length) return Response.json({ error: "This server already has accounts, so it can't receive a move." }, { status: 409 });
  if ((await importStatus()).state === "copying") return Response.json({ error: "A move is already copying." }, { status: 409 });
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  if (!code?.trim()) return Response.json({ error: "Paste the code from the old server." }, { status: 400 });
  const self = appOrigin(req);
  void importFrom(from, code.trim(), self)
    .then(() => {
      // The service manager starts the app again with the moved settings and data.
      console.info("[migrate] finished; restarting with the moved settings");
      setTimeout(() => process.exit(0), 1500);
    })
    .catch((e) => console.error("[migrate] failed:", (e as Error).message));
  return Response.json({ started: true, from }, { status: 202 });
}
