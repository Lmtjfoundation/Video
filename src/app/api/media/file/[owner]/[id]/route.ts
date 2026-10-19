import { asUser, db } from "@/lib/db";
import { readFile, verifySignature } from "@/lib/media";
import type { MediaItem } from "@/lib/types";
import { parseRange } from "@/lib/byte-range";

export const dynamic = "force-dynamic";

/**
 * Serves an uploaded file through a signed, expiring link.
 * Public on purpose: Instagram and other platforms fetch post images from this URL.
 * Supports byte ranges, which Safari and iPhones need to play a video at all (and every browser uses to seek).
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
    const headers: Record<string, string> = { "Content-Type": item.type, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" };
    // ?dl=name.mp4 saves the file (e.g. to post it on a Facebook profile from a computer) instead of playing it.
    const dl = url.searchParams.get("dl")?.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 100);
    if (dl) headers["Content-Disposition"] = `attachment; filename="${dl}"`;
    const range = parseRange(req.headers.get("range"), bytes.length);
    if (range === null) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${bytes.length}` } });
    if (range === "none") return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Length": String(bytes.length) } });
    const part = bytes.subarray(range.start, range.end + 1);
    return new Response(new Uint8Array(part), {
      status: 206,
      headers: { ...headers, "Content-Length": String(part.length), "Content-Range": `bytes ${range.start}-${range.end}/${bytes.length}` },
    });
  });
}
