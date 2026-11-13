import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "ghost-post-keyless-"));
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);

// The managed identity, faked: a token per scope, so the test can see which scope each call asked for.
vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: class {
    async getToken(scope: string) {
      return { token: `tok:${scope}`, expiresOnTimestamp: Date.now() + 3600_000 };
    }
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["AZURE_APIM_URL", "AZURE_AI_ENDPOINT", "AZURE_AI_KEY", "APPLICATIONINSIGHTS_CONNECTION_STRING", "AZURE_AI_FLUX2"]) delete process.env[k];
});

describe("Keyless Azure (managed identity)", () => {
  it("sends model and speech calls through API Management with the identity's token, no key", async () => {
    process.env.AZURE_APIM_URL = "https://gp-apim.azure-api.net/";
    const { foundryAuth, speechAuth } = await import("@/lib/azure-identity");
    const f = await foundryAuth();
    expect(f).toMatchObject({ base: "https://gp-apim.azure-api.net/ai", via: "apim" });
    expect(f!.headers.Authorization).toBe("Bearer tok:https://management.azure.com/.default");
    expect(JSON.stringify(f!.headers)).not.toMatch(/api-key/i);
    expect((await speechAuth("tts"))!.url).toBe("https://gp-apim.azure-api.net/speech/tts/cognitiveservices/v1");
    expect((await speechAuth("avatar"))!.url).toBe("https://gp-apim.azure-api.net/speech/avatar/batchsyntheses");
  });

  it("pictures go to the gateway, signed with the identity", async () => {
    process.env.AZURE_APIM_URL = "https://gp-apim.azure-api.net";
    process.env.AZURE_AI_FLUX2 = "off";
    const seen: { url: string; auth: string | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      seen.push({ url: String(u), auth: new Headers(init?.headers).get("authorization") });
      return Response.json({ data: [{ b64_json: Buffer.from("png").toString("base64") }] });
    }));
    const { foundryImage } = await import("@/lib/azure-foundry");
    await foundryImage({ prompt: "A rooftop at night", aspect: "9:16" });
    expect(seen[0].url).toBe("https://gp-apim.azure-api.net/ai/openai/deployments/flux-kontext/images/generations?api-version=2025-04-01-preview");
    expect(seen[0].auth).toBe("Bearer tok:https://management.azure.com/.default");
  });

  it("keeps the endpoint + key path when API Management isn't set", async () => {
    process.env.AZURE_AI_ENDPOINT = "https://res.services.ai.azure.com/";
    process.env.AZURE_AI_KEY = "k".repeat(84);
    const { foundryAuth } = await import("@/lib/azure-identity");
    expect(await foundryAuth()).toMatchObject({ base: "https://res.services.ai.azure.com", via: "key", headers: { "api-key": "k".repeat(84) } });
  });

  it("logs events to Application Insights with the identity (key-based ingestion is off)", async () => {
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = "InstrumentationKey=00000000-0000-0000-0000-000000000001;IngestionEndpoint=https://eastus-8.in.applicationinsights.azure.com/";
    const seen: { url: string; auth: string | null; body: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      seen.push({ url: String(u), auth: new Headers(init?.headers).get("authorization"), body: String(init?.body) });
      return new Response("{}");
    }));
    const { trackEvent } = await import("@/lib/telemetry");
    await trackEvent("RenderQueued", { prompt: "A man sprints", settings: { frames: 33 } });
    expect(seen[0].url).toBe("https://eastus-8.in.applicationinsights.azure.com/v2.1/track");
    expect(seen[0].auth).toBe("Bearer tok:https://monitor.azure.com/.default");
    const ev = JSON.parse(seen[0].body)[0];
    expect(ev.data.baseData).toMatchObject({ name: "RenderQueued", properties: { prompt: "A man sprints", settings: '{"frames":33}' } });
  });
});

describe("Multi-tenant context", () => {
  it("maps each account to its own tenant and plan, with no tenant borrowed outside a request", async () => {
    const { SERVICE_PLAN, tenantIdFor, tenantHeaders } = await import("@/lib/tenancy");
    expect(SERVICE_PLAN).toEqual({ free: "free", creator: "pro", pro: "studio", unlimited: "studio" });
    expect(tenantIdFor("abc")).toBe("user-abc");
    expect(tenantIdFor("abc")).not.toBe(tenantIdFor("abd"));
    // A background job (no signed-in user) sends no tenant headers, so it can never act as someone else's tenant.
    expect(await tenantHeaders()).toEqual({});
  });
});
