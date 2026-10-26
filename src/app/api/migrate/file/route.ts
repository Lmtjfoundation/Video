import { exportFile, MigrateError } from "@/lib/migrate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Old server: one file of the data folder, for the new server holding the code. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const f = await exportFile(q.get("code") ?? "", q.get("path") ?? "");
    return new Response(f.stream, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(f.size), "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof MigrateError ? 403 : 500 });
  }
}
