import { exportManifest, MigrateError } from "@/lib/migrate";

export const dynamic = "force-dynamic";

/** Old server: the settings and file list, for the new server holding the one-time code. */
export async function GET(req: Request) {
  try {
    return Response.json(await exportManifest(new URL(req.url).searchParams.get("code") ?? ""), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof MigrateError ? 403 : 500 });
  }
}
