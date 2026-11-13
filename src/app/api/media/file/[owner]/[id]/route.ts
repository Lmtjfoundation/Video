import { asUser, db } from "@/lib/db";
import { promises as fs } from "fs";
import { fileStream } from "@/lib/file-stream";
import { localPath, readFile, storeOf, verifySignature } from "@/lib/media";
import { blobReadUrl } from "@/lib/azure-blob";
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
    // ?dl=name.mp4 saves the file (e.g. to post it on a Facebook profile from a computer) instead of playing it.
    const dl = url.searchParams.get("dl")?.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 100);
    const where = storeOf(item);
    // Kept in Azure: a short-lived signed link straight to the bucket, which streams and seeks by itself.
    if (where === "azure") {
      const to = await blobReadUrl(item.storagePath, 3600, dl || undefined).catch(() => null);
      return to ? Response.redirect(to, 302) : new Response("Not found", { status: 404 });
    }
    const headers: Record<string, string> = { "Content-Type": item.type, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" };
    if (dl) headers["Content-Disposition"] = `attachment; filename="${dl}"`;
    // On this server's disk: streamed from the file, never read whole (long movies are gigabytes).
    if (where === "local") {
      const file = localPath(item);
      const size = (await fs.stat(file).catch(() => null))?.size;
      if (size === undefined) return new Response("Not found", { status: 404 });
      const range = parseRange(req.headers.get("range"), size);
      if (range === null) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
      const [start, end] = range === "none" ? [0, size - 1] : [range.start, range.end];
      const body = fileStream(file, start, end);
      return new Response(body, range === "none" ? { headers: { ...headers, "Content-Length": String(size) } } : { status: 206, headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` } });
    }
    const bytes = await readFile(item).catch(() => null);
    if (!bytes) return new Response("Not found", { status: 404 });
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
