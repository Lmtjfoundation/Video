import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "ghost-post-azure-only-"));
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN", "OWN_WRITER_URL"]) delete process.env[k];

const AZ = "https://gp-test.services.ai.azure.com";
const PNG = Buffer.from("89504e470d0a1a0a" + "22".repeat(32), "hex");

function setAll() {
  // Every outside service is set up too: Azure only must still never call them.
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-1234567890abcdefghij";
  process.env.GEMINI_API_KEY = "AIza-test-key-123456789012345678901234";
  process.env.REPLICATE_API_TOKEN = "r8_test_token_1234567890";
  process.env.ELEVENLABS_API_KEY = "el_test_key_1234567890abcdef";
  process.env.PIXABAY_API_KEY = "12345-abcdefabcdefabcdefabcdef";
  process.env.AZURE_AI_ENDPOINT = AZ;
  process.env.AZURE_AI_KEY = "z".repeat(84);
  process.env.AZURE_ONLY = "1";
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "REPLICATE_API_TOKEN", "ELEVENLABS_API_KEY", "PIXABAY_API_KEY", "AZURE_AI_ENDPOINT", "AZURE_AI_KEY", "AZURE_ONLY"]) delete process.env[k];
});

describe("Azure only", () => {
  it("writes with Azure OpenAI (GPT-5 settings, pictures read too) and makes pictures on Azure, never calling anyone else", async () => {
    setAll();
    const hosts: string[] = [];
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      const url = new URL(String(u));
      hosts.push(url.host);
      if (typeof init?.body === "string") bodies.push(JSON.parse(init.body));
      if (url.pathname === "/openai/v1/chat/completions") return Response.json({ choices: [{ message: { content: "Written on Azure." } }] });
      if (url.pathname.includes("/images/")) return Response.json({ data: [{ b64_json: PNG.toString("base64") }] });
      return new Response("not azure", { status: 500 });
    }));
    const { anthropicKey, ownerGemini, replicateKey, elevenlabsKey, pixabayKey, integrationStatus } = await import("@/lib/integrations");
    expect([await anthropicKey(), await ownerGemini(), await replicateKey(), await elevenlabsKey(), await pixabayKey()]).toEqual(["", null, "", "", ""]);

    const { claude } = await import("@/lib/llm");
    expect(await claude({ system: "s", user: "Write a caption", maxTokens: 500 })).toBe("Written on Azure.");
    expect(bodies[0]).toMatchObject({ model: "gpt-5.4-mini", max_completion_tokens: 4000, reasoning_effort: "low" });
    expect(bodies[0]).not.toHaveProperty("temperature");
    expect(await claude({ system: "s", user: "What's in this picture?", images: [{ mediaType: "image/png", base64: PNG.toString("base64") }] })).toBe("Written on Azure.");
    const withPicture = bodies[1] as { messages: { content: unknown }[] };
    expect(JSON.stringify(withPicture.messages[1].content)).toContain("data:image/png;base64,");

    const { makeImage, picturesReady } = await import("@/lib/pictures");
    expect((await makeImage({ prompt: "A trumpet", aspect: "1:1" })).bytes.equals(PNG)).toBe(true);
    expect(await picturesReady()).toBe("azure");

    expect(new Set(hosts)).toEqual(new Set(["gp-test.services.ai.azure.com"]));
    expect((await integrationStatus()).azureOnly).toBe(true);
  });

  it("is off by default: the other services are used as before", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-1234567890abcdefghij";
    const { anthropicKey, azureOnly } = await import("@/lib/integrations");
    expect(await azureOnly()).toBe(false);
    expect(await anthropicKey()).toBe("sk-ant-test-1234567890abcdefghij");
  });
});
