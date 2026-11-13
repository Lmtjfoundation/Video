import { promises as fs } from "fs";

/**
 * A web stream over part of a file on disk, read one chunk at a time as the client asks for it.
 *
 * Used instead of Readable.toWeb(createReadStream()), which can throw "Controller is already closed" as an
 * uncaught exception when a browser cancels a request partway (every video seek does), taking the whole
 * server down. Here reads only happen on pull, cancel closes the file, and no write follows a close.
 */
export function fileStream(file: string, start = 0, end?: number, chunk = 256 * 1024): ReadableStream<Uint8Array> {
  let fh: fs.FileHandle | null = null;
  let pos = start;
  let done = false;
  const close = async () => {
    done = true;
    const h = fh;
    fh = null;
    await h?.close().catch(() => {});
  };
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (done) return;
        try {
          if (!fh) fh = await fs.open(file, "r");
          const last = end ?? Infinity;
          const want = Math.min(chunk, last - pos + 1);
          if (want <= 0) {
            await close();
            controller.close();
            return;
          }
          const buf = new Uint8Array(want);
          const { bytesRead } = await fh.read(buf, 0, want, pos);
          if (done) return; // cancelled while reading
          if (bytesRead === 0) {
            await close();
            controller.close();
            return;
          }
          pos += bytesRead;
          controller.enqueue(bytesRead === want ? buf : buf.subarray(0, bytesRead));
        } catch (e) {
          await close();
          try {
            controller.error(e);
          } catch {
            /* already closed */
          }
        }
      },
      async cancel() {
        await close();
      },
    },
    { highWaterMark: 1 },
  );
}
