import { movedTo } from "@/lib/migrate";

export const dynamic = "force-dynamic";

/** Where this server moved to, if it did (read by the middleware to send visitors there). */
export async function GET() {
  return Response.json({ to: await movedTo() }, { headers: { "Cache-Control": "no-store" } });
}
