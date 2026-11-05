import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "ghost-post-cpu-pics-"));
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN", "REPLICATE_API_TOKEN", "VM_WAKE", "VM_WAKE_GPU"]) delete process.env[k];
vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));

const PNG = Buffer.from("89504e470d0a1a0a" + "00".repeat(64), "hex");
const ENGINE = "https://pics.example.sslip.io";

describe("the CPU picture machine", () => {
  it("makes the picture when Gemini's billing is off, and is recognised as a pictures engine", async () => {
    process.env.GEMINI_API_KEY = "AIza-test-key-123456789012345678901234";
    process.env.VIDEO_ENGINE_GPU_URL = ENGINE;
    process.env.VIDEO_ENGINE_GPU_TOKEN = "engine-token-123456";
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      const url = String(u);
      seen.push(url);
      if (url.startsWith("https://generativelanguage.googleapis.com/")) return Response.json({ error: { status: "FAILED_PRECONDITION", message: "This model needs billing enabled on a paid tier" } }, { status: 400 });
      if (url === `${ENGINE}/health`) return Response.json({ ok: true });
      if (url === `${ENGINE}/v1/info`) return Response.json({ profile: "pictures", capabilities: ["pictures", "upscale", "remove-bg"], device: "cpu", ready: true });
      if (url === `${ENGINE}/v1/images`) return Response.json({ id: "j1", status: "queued" });
      if (url === `${ENGINE}/v1/images/j1`) return Response.json({ id: "j1", status: "succeeded", progress: 1 });
      if (url === `${ENGINE}/v1/images/j1/file`) return new Response(new Uint8Array(PNG));
      return new Response("{}", { status: 404 });
    }));
    const { makeImage } = await import("@/lib/pictures");
    const img = await makeImage({ prompt: "A school hallway at night", aspect: "9:16" });
    expect(img.bytes.equals(PNG)).toBe(true);
    expect(seen.some((u) => u === `${ENGINE}/v1/images`)).toBe(true);
    const { testOwnEngine, engineFirst } = await import("@/lib/own-video");
    expect((await testOwnEngine("gpu")).message).toMatch(/picture machine/);
    expect(await engineFirst("pictures")).toBe(true);
    expect(await engineFirst("clips")).toBe(false);
    vi.unstubAllGlobals();
  });
});
