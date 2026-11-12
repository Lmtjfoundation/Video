import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "ghost-post-stream-"));
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "AZURE_STORAGE_CONNECTION_STRING"]) delete process.env[k];

describe("media on this server's disk", () => {
  it("streams a file with seeking (206 ranges), records where it's kept, and keeps a long render from disk", async () => {
    const { asUser } = await import("@/lib/db");
    const m = await import("@/lib/media");
    const route = await import("@/app/api/media/file/[owner]/[id]/route");
    const { writeFileSync } = await import("node:fs");
    await asUser("usr_s", async () => {
      const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
      const item = await m.storeFile("usr_s", { name: "clip.mp4", type: "video/mp4", bytes });
      expect(item.store).toBe("local");
      const url = new URL(m.signedUrl("usr_s", item.id, 600), "http://app.test").toString();
      const ctx = { params: Promise.resolve({ owner: "usr_s", id: item.id }) };
      const whole = await route.GET(new Request(url), ctx);
      expect(whole.status).toBe(200);
      expect(Buffer.from(await whole.arrayBuffer()).equals(bytes)).toBe(true);
      const part = await route.GET(new Request(url, { headers: { Range: "bytes=100-109" } }), { params: Promise.resolve({ owner: "usr_s", id: item.id }) });
      expect(part.status).toBe(206);
      expect(part.headers.get("content-range")).toBe("bytes 100-109/1000");
      expect([...Buffer.from(await part.arrayBuffer())]).toEqual(Array.from({ length: 10 }, (_, i) => (100 + i) % 256));

      const f = path.join(process.env.DATA_DIR!, "render.mp4");
      writeFileSync(f, Buffer.alloc(4096, 3));
      const kept = await m.storeFilePath("usr_s", { name: "long.mp4", type: "video/mp4", path: f });
      expect(kept).toMatchObject({ size: 4096, store: "local", kind: "video" });
      expect((await m.readFile(kept)).length).toBe(4096);
    });
  });
});
