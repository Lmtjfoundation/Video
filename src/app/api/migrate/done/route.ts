import { markMoved, MigrateError } from "@/lib/migrate";

export const dynamic = "force-dynamic";

/** Old server: the copy finished; send visitors to the new address and stop the scheduler. */
export async function POST(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    await markMoved(q.get("code") ?? "", q.get("to") ?? "");
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof MigrateError ? 403 : 400 });
  }
}
