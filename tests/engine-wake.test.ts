import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-wake-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "GEMINI_API_KEY", "VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN", "VM_WAKE"]) delete process.env[k];

const T = "11111111-2222-3333-4444-555555555555";
const LINE = `tenant=${T};client=${T};secret=s3cr3t~value.123;subscription=${T};group=GHOSTPOST;vm=Ghost`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

beforeEach(async () => {
  (await import("@/lib/own-video")).resetEngineCapabilities();
  process.env.VIDEO_ENGINE_URL = "https://ghost.example";
  process.env.VIDEO_ENGINE_TOKEN = "engine-token-123";
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN", "VM_WAKE"]) delete process.env[k];
});

describe("engine capabilities and wake on use", () => {
  it("reads the wake line only when every part is there", async () => {
    const { parseWake } = await import("@/lib/vm-wake");
    expect(parseWake(LINE)).toEqual({ tenant: T, client: T, secret: "s3cr3t~value.123", subscription: T, group: "GHOSTPOST", vm: "Ghost" });
    expect(parseWake(` ${LINE.replace("secret=s3cr3t~value.123", "secret=a=b=c-long")} `)?.secret).toBe("a=b=c-long");
    expect(parseWake(LINE.replace(";vm=Ghost", ""))).toBeNull();
    expect(parseWake(LINE.replace(`tenant=${T}`, "tenant=nope"))).toBeNull();
    expect(parseWake("")).toBeNull();
  });

  it("lets a machine without a GPU do only its tools", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (String(u).endsWith("/v1/info") ? Response.json({ profile: "tools", capabilities: ["upscale", "remove-bg", "isolate"] }) : new Response("{}", { status: 404 }))));
    const { ownEngineReady, testOwnEngine } = await import("@/lib/own-video");
    const { picturesReady } = await import("@/lib/pictures");
    expect(await ownEngineReady("upscale")).toBe(true);
    expect(await ownEngineReady("isolate")).toBe(true);
    expect(await ownEngineReady("speech")).toBe(false);
    expect(await ownEngineReady()).toBe(false); // the full (GPU) engine
    expect(await picturesReady()).toBeNull(); // no GPU and no Gemini key: pictures say so clearly
    expect((await testOwnEngine()).message).toContain("without a GPU");
  });

  it("remembers what the engine can do while its machine is switched off", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ profile: "tools", capabilities: ["upscale"] })));
    const { ownEngineReady, resetEngineCapabilities } = await import("@/lib/own-video");
    expect(await ownEngineReady("upscale")).toBe(true);
    resetEngineCapabilities();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    expect(await ownEngineReady("upscale")).toBe(true);
    expect(await ownEngineReady("pictures")).toBe(false);
  });

  it("starts the switched-off VM through Azure, waits for the engine, then does the job", async () => {
    process.env.VM_WAKE = LINE;
    let up = false;
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      const url = String(u);
      calls.push(`${init?.method ?? "GET"} ${url.replace(/\?.*/, "")}`);
      if (url.startsWith("https://login.microsoftonline.com/")) {
        expect(String(init?.body)).toContain("scope=https%3A%2F%2Fmanagement.azure.com%2F.default");
        return Response.json({ access_token: "azure-token" });
      }
      if (url.startsWith("https://management.azure.com/")) {
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer azure-token");
        up = true;
        return new Response(null, { status: 202 });
      }
      if (!up) throw new TypeError("fetch failed: connect ETIMEDOUT");
      if (url.endsWith("/health")) return Response.json({ ok: true });
      if (url.endsWith("/v1/images") && init?.method === "POST") return Response.json({ id: "j1", status: "queued" });
      if (url.endsWith("/v1/images/j1")) return Response.json({ status: "succeeded" });
      if (url.endsWith("/v1/images/j1/file")) return new Response(new Uint8Array(PNG));
      return new Response("{}", { status: 404 });
    }));
    const { ownImageTool } = await import("@/lib/own-video");
    const out = await ownImageTool({ op: "upscale", image: PNG, mime: "image/png" });
    expect(out.equals(PNG)).toBe(true);
    expect(calls.filter((c) => c.includes("management.azure.com"))).toEqual([`POST https://management.azure.com/subscriptions/${T}/resourceGroups/GHOSTPOST/providers/Microsoft.Compute/virtualMachines/Ghost/start`]);
    expect(calls.indexOf("GET https://ghost.example/health")).toBeGreaterThan(calls.findIndex((c) => c.includes("management.azure.com")));
  });

  it("says plainly when the machine is off and wake isn't set up", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const { ownImageTool } = await import("@/lib/own-video");
    await expect(ownImageTool({ op: "upscale", image: PNG, mime: "image/png" })).rejects.toThrow(/didn't answer at https:\/\/ghost.example/);
  });
});
