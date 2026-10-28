import { listUsers, userFromRequest } from "@/lib/auth";
import { backupBeforeMove, importFrom, importStatus } from "@/lib/migrate";
import { appOrigin } from "@/lib/oauth";

export const dynamic = "force-dynamic";

/**
 * New server: copy everything from the old server (MIGRATE_FROM) with the owner's one-time code, and only from the
 * address the server was set up with. An empty server takes it straight away. A server that already has accounts
 * takes it only from its own signed-in owner who confirmed replacing what's there; that data is set aside first.
 */
export async function POST(req: Request) {
  const from = process.env.MIGRATE_FROM;
  if (!from) return Response.json({ error: "This server wasn't set up to receive a move (MIGRATE_FROM isn't set)." }, { status: 404 });
  if ((await importStatus()).state === "copying") return Response.json({ error: "A move is already copying. Wait for it to finish." }, { status: 409 });
  const { code, replace } = (await req.json().catch(() => ({}))) as { code?: string; replace?: boolean };
  if (!code?.trim()) return Response.json({ error: "Paste the code from the old server." }, { status: 400 });
  if ((await listUsers()).length) {
    const me = await userFromRequest(req);
    if (me?.role !== "admin") {
      return Response.json({ error: "This server already has an account. Sign in here as its owner, then move again: your old server's data replaces what's here (a backup is kept)." }, { status: 409 });
    }
    if (replace !== true) return Response.json({ error: "Confirm that the old server's data should replace what's on this server.", needsReplace: true }, { status: 409 });
    const kept = await backupBeforeMove();
    console.info(`[migrate] replacing this server's data; kept ${kept.join(", ") || "nothing"}`);
  }
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
