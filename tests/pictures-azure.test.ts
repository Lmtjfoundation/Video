import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "ghost-post-azure-"));
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN", "GEMINI_API_KEY", "REPLICATE_API_TOKEN"]) delete process.env[k];

const OUT = Buffer.from("89504e470d0a1a0a" + "11".repeat(32), "hex");
const BASE = "https://ghostpost-test.services.ai.azure.com";
type Seen = { url: string; headers: Headers; json?: Record<string, unknown>; form?: FormData };

function stubAzure(seen: Seen[], status = 200) {
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    const url = String(u);
    const s: Seen = { url, headers: new Headers(init?.headers) };
    if (typeof init?.body === "string") s.json = JSON.parse(init.body);
    if (init?.body instanceof FormData) s.form = init.body;
    seen.push(s);
    if (url.startsWith(BASE) && status === 200) return Response.json({ data: [{ b64_json: OUT.toString("base64") }] });
    if (url.startsWith(BASE)) return new Response('{"error":{"message":"bad key"}}', { status });
    return new Response("{}", { status: 404 });
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["AZURE_AI_ENDPOINT", "AZURE_AI_KEY", "AZURE_AI_IMAGE_DEPLOYMENT", "REPLICATE_API_TOKEN"]) delete process.env[k];
});

describe("Pictures on Azure's GPUs (Azure AI Foundry, FLUX Kontext)", () => {
  it("makes a picture from a description at the right size, and says pictures are on", async () => {
    process.env.AZURE_AI_ENDPOINT = `${BASE}/`;
    process.env.AZURE_AI_KEY = "a".repeat(84);
    const seen: Seen[] = [];
    stubAzure(seen);
    const { makeImage, picturesReady } = await import("@/lib/pictures");
    const img = await makeImage({ prompt: "A trumpet in a New Orleans bar", aspect: "9:16" });
    expect(img.bytes.equals(OUT)).toBe(true);
    expect(seen[0].url).toBe(`${BASE}/openai/deployments/flux-kontext/images/generations?api-version=2025-04-01-preview`);
    expect(seen[0].headers.get("api-key")).toBe("a".repeat(84));
    expect(seen[0].json).toMatchObject({ prompt: "A trumpet in a New Orleans bar", size: "768x1344" });
    expect(await picturesReady()).toBe("azure");
  });

  it("keeps faces: references go to the edit endpoint, two people joined side by side", async () => {
    process.env.AZURE_AI_ENDPOINT = `${BASE}/openai/v1`;
    process.env.AZURE_AI_KEY = "b".repeat(84);
    process.env.AZURE_AI_IMAGE_DEPLOYMENT = "my-kontext";
    const seen: Seen[] = [];
    stubAzure(seen);
    const face = async (c: string) => (await sharp({ create: { width: 200, height: 300, channels: 3, background: c } }).png().toBuffer()).toString("base64");
    const { makeImage } = await import("@/lib/pictures");
    await makeImage({ prompt: "They share beignets at dawn", refs: [{ mimeType: "image/png", base64: await face("#a00") }, { mimeType: "image/png", base64: await face("#0a0") }], aspect: "16:9" });
    expect(seen[0].url).toBe(`${BASE}/openai/deployments/my-kontext/images/edits?api-version=2025-04-01-preview`);
    const f = seen[0].form!;
    expect(f.get("size")).toBe("1344x768");
    expect(String(f.get("prompt"))).toMatch(/2 people side by side/);
    const joined = await sharp(Buffer.from(await (f.get("image") as Blob).arrayBuffer())).metadata();
    expect(joined.height).toBe(1024);
    expect(joined.width).toBeGreaterThan(1300); // two 2:3 portraits at 1024 tall
  });

  it("falls through to the next maker when Azure refuses the key", async () => {
    process.env.AZURE_AI_ENDPOINT = BASE;
    process.env.AZURE_AI_KEY = "c".repeat(84);
    const seen: Seen[] = [];
    stubAzure(seen, 401);
    const { foundryImage } = await import("@/lib/azure-foundry");
    await expect(foundryImage({ prompt: "x", aspect: "1:1" })).rejects.toThrow(/check the endpoint, key and deployment/);
  });
});
