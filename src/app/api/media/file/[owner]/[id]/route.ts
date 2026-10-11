import { asUser, db } from "@/lib/db";
import { readFile, verifySignature } from "@/lib/media";
import type { MediaItem } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Serves an uploaded file through a signed, expiring link.
 * Public on purpose: Instagram and other platforms fetch post images from this URL.
 */
export async function GET(req: Request, { params }: { params: Promise<{ owner: string; id: string }> }) {
  const { owner, id } = await params;
  const url = new URL(req.url);
  if (!verifySignature(owner, id, url.searchParams.get("exp"), url.searchParams.get("sig"))) {
    return new Response("Link expired or invalid", { status: 403 });
  }
  return asUser(owner, async () => {
    const item = await db().get<MediaItem>("media", id);
    if (!item) return new Response("Not found", { status: 404 });
    const bytes = await readFile(item).catch(() => null);
    if (!bytes) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": item.type, "Content-Length": String(bytes.length), "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
    });
  });
}
