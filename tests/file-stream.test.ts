import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileStream } from "@/lib/file-stream";

const dir = mkdtempSync(path.join(tmpdir(), "fs-test-"));
const file = path.join(dir, "a.bin");
const data = new Uint8Array(1_000_000).map((_, i) => i % 251);
writeFileSync(file, data);

async function readAll(s: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(s).arrayBuffer());
}

describe("fileStream", () => {
  it("streams the whole file", async () => {
    expect(await readAll(fileStream(file))).toEqual(data);
  });
  it("streams an inclusive byte range", async () => {
    expect(await readAll(fileStream(file, 1000, 300_999, 4096))).toEqual(data.subarray(1000, 301_000));
  });
  it("survives the client cancelling mid-stream", async () => {
    const r = fileStream(file, 0, undefined, 1024).getReader();
    await r.read();
    await r.cancel();
    await new Promise((ok) => setTimeout(ok, 50));
    expect((await r.read().catch(() => ({ done: true }))).done).toBe(true);
  });
  it("errors cleanly on a missing file", async () => {
    await expect(readAll(fileStream(path.join(dir, "nope")))).rejects.toThrow();
  });
});
