import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-wake-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "GEMINI_API_KEY", "VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN", "VM_WAKE", "VIDEO_ENGINE_GPU_URL", "VIDEO_ENGINE_GPU_TOKEN", "VM_WAKE_GPU"]) delete process.env[k];

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
  for (const k of ["VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN", "VM_WAKE", "VIDEO_ENGINE_GPU_URL", "VIDEO_ENGINE_GPU_TOKEN", "VM_WAKE_GPU"]) delete process.env[k];
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

  it("also wakes the VM when a proxy in front of it answers for the switched-off machine", async () => {
    process.env.VM_WAKE = LINE;
    let up = false;
    let starts = 0;
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      const url = String(u);
      if (url.startsWith("https://login.microsoftonline.com/")) return Response.json({ access_token: "t" });
      if (url.startsWith("https://management.azure.com/")) {
        starts++;
        up = true;
        return new Response(null, { status: 202 });
      }
      if (!up) return new Response("upstream connect error or disconnect/reset before headers", { status: 503, headers: { "content-type": "text/plain" } });
      if (url.endsWith("/health")) return Response.json({ ok: true });
      if (url.endsWith("/v1/info")) return Response.json({ profile: "tools", capabilities: ["upscale"], ready: true, device: "cpu", vram_gb: 0, queue: 0, model: "-" });
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }));
    const { testOwnEngine } = await import("@/lib/own-video");
    expect((await testOwnEngine()).ok).toBe(true);
    expect(starts).toBe(1);
  });

  it("keeps the engine's own 503 as its answer (no wake)", async () => {
    process.env.VM_WAKE = LINE;
    process.env.VIDEO_ENGINE_URL = "https://never-answered.example"; // no capabilities remembered for this one
    let starts = 0;
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      const url = String(u);
      if (url.startsWith("https://management.azure.com/")) starts++;
      if (url.endsWith("/health")) return Response.json({ ok: true });
      return Response.json({ detail: "This engine runs without a GPU" }, { status: 503 });
    }));
    const { ownImage } = await import("@/lib/own-video");
    await expect(ownImage({ prompt: "a cat", aspect: "1:1" })).rejects.toThrow(/without a GPU/);
    expect(starts).toBe(0);
  });

  it("says plainly when the machine is off and wake isn't set up", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const { ownImageTool } = await import("@/lib/own-video");
    await expect(ownImageTool({ op: "upscale", image: PNG, mime: "image/png" })).rejects.toThrow(/didn't answer at https:\/\/ghost.example/);
  });

  it("sends tools to the always-on engine and the rest to the GPU engine, waking only the GPU machine", async () => {
    const GPU_LINE = LINE.replace("vm=Ghost", "vm=GhostGPU");
    process.env.VIDEO_ENGINE_URL = "https://tools.example";
    process.env.VIDEO_ENGINE_GPU_URL = "https://gpu.example";
    process.env.VIDEO_ENGINE_GPU_TOKEN = "gpu-token-123456";
    process.env.VM_WAKE_GPU = GPU_LINE;
    let gpuUp = false;
    const hits: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      const url = String(u);
      if (url.startsWith("https://login.microsoftonline.com/")) return Response.json({ access_token: "t" });
      if (url.startsWith("https://management.azure.com/")) {
        hits.push(`start ${url.match(/virtualMachines\/([^/]+)/)?.[1]}`);
        gpuUp = true;
        return new Response(null, { status: 202 });
      }
      if (url.startsWith("https://tools.example")) {
        if (url.endsWith("/v1/info")) return Response.json({ profile: "tools", capabilities: ["upscale", "remove-bg", "isolate"] });
        if (url.endsWith("/health")) return Response.json({ ok: true });
        hits.push(`tools ${init?.method ?? "GET"} ${url.replace("https://tools.example", "")}`);
        if (url.endsWith("/v1/images")) return Response.json({ id: "t1" });
        if (url.endsWith("/v1/images/t1")) return Response.json({ status: "succeeded" });
        return new Response(new Uint8Array(PNG));
      }
      // The GPU machine is off until woken; while off, its info is unknown.
      if (!gpuUp) throw new TypeError("fetch failed: connect ETIMEDOUT");
      if (url.endsWith("/v1/info")) return Response.json({ profile: "full", capabilities: ["pictures", "clips", "speech", "lipsync"] });
      if (url.endsWith("/health")) return Response.json({ ok: true });
      hits.push(`gpu ${init?.method ?? "GET"} ${url.replace("https://gpu.example", "")}`);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer gpu-token-123456");
      if (url.endsWith("/v1/images")) return Response.json({ id: "g1" });
      if (url.endsWith("/v1/images/g1")) return Response.json({ status: "succeeded" });
      return new Response(new Uint8Array(PNG));
    }));
    const { ownImageTool, ownImage, ownEngineReady } = await import("@/lib/own-video");
    expect(await ownEngineReady("upscale")).toBe(true);
    expect(await ownEngineReady("pictures")).toBe(true); // the GPU engine hasn't answered yet: benefit of the doubt
    await ownImageTool({ op: "upscale", image: PNG, mime: "image/png" });
    expect(hits).toEqual(["tools POST /v1/images", "tools GET /v1/images/t1", "tools GET /v1/images/t1/file"]);
    hits.length = 0;
    await ownImage({ prompt: "a cat", aspect: "1:1" });
    expect(hits).toEqual(["start GhostGPU", "gpu POST /v1/images", "gpu GET /v1/images/g1", "gpu GET /v1/images/g1/file"]);
  });

  it("estimates engine hours from use: boot and idle tail for a new session, the gap within one", async () => {
    const { addedMinutes, IDLE_MINUTES } = await import("@/lib/engine-hours");
    const t = Date.parse("2026-10-26T10:00:00Z");
    expect(addedMinutes(0, t)).toBe(3 + IDLE_MINUTES);
    expect(addedMinutes(t, t + 5 * 60_000)).toBe(5);
    expect(addedMinutes(t, t + (IDLE_MINUTES + 1) * 60_000)).toBe(3 + IDLE_MINUTES);
  });
});
