import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "ghost-post-azure-premium-"));
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN", "OWN_WRITER_URL", "AZURE_APIM_URL"]) delete process.env[k];

const AZ = "https://gp-test.services.ai.azure.com";
const ENV = ["AZURE_AI_ENDPOINT", "AZURE_AI_KEY", "AZURE_ONLY", "AZURE_AI_PREMIUM_DEPLOYMENT", "AZURE_AI_TRANSCRIBE_DEPLOYMENT"];

function azureOnly() {
  process.env.AZURE_AI_ENDPOINT = AZ;
  process.env.AZURE_AI_KEY = "z".repeat(84);
  process.env.AZURE_ONLY = "1";
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV) delete process.env[k];
});

describe("Azure premium writer", () => {
  it("uses the premium deployment for premium and long text, the usual one for short text and pictures", async () => {
    azureOnly();
    process.env.AZURE_AI_PREMIUM_DEPLOYMENT = "kimi-k3.1-pro";
    const models: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      expect(new URL(String(u)).host).toBe("gp-test.services.ai.azure.com");
      models.push((JSON.parse(String(init?.body)) as { model: string }).model);
      return Response.json({ choices: [{ message: { content: "Written." } }] });
    }));
    const { claude } = await import("@/lib/llm");
    await claude({ system: "s", user: "A caption", maxTokens: 400 });
    await claude({ system: "s", user: "A story", maxTokens: 3000, model: "premium" });
    await claude({ system: "s", user: "A full script", maxTokens: 9000 });
    await claude({ system: "s", user: "What's here?", maxTokens: 9000, model: "premium", images: [{ mediaType: "image/png", base64: "AAAA" }] });
    expect(models).toEqual(["gpt-5.4-mini", "kimi-k3.1-pro", "kimi-k3.1-pro", "gpt-5.4-mini"]);
  });

  it("gives thinking models room to think, so a long script never comes back empty", async () => {
    azureOnly();
    process.env.AZURE_AI_PREMIUM_DEPLOYMENT = "kimi-k3.1-pro";
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ choices: [{ message: { content: "INT. CLUB - NIGHT" } }] });
    }));
    const { claude } = await import("@/lib/llm");
    await claude({ system: "s", user: "Cold open", maxTokens: 2500, model: "premium" });
    await claude({ system: "s", user: "Pilot", maxTokens: 16000 });
    expect(bodies[0]).toMatchObject({ model: "kimi-k3.1-pro", max_completion_tokens: 12000 });
    expect(bodies[1]).toMatchObject({ model: "kimi-k3.1-pro", max_completion_tokens: 48000 });
    for (const b of bodies) {
      expect(b).not.toHaveProperty("max_tokens");
      expect(b).not.toHaveProperty("temperature");
      expect(b).not.toHaveProperty("reasoning_effort");
    }
    const { thinkingModel } = await import("@/lib/own-writer");
    expect(["kimi-k3.1-pro", "mai-thinking-1", "DeepSeek-V4-Pro", "grok-4-20-reasoning"].every(thinkingModel)).toBe(true);
    expect(["gpt-5.4-mini", "grok-4-20-non-reasoning", "qwen3:4b"].some(thinkingModel)).toBe(false);
  });

  it("writerModel: no premium deployment means the usual model for everything", async () => {
    const { writerModel } = await import("@/lib/own-writer");
    const w = { url: "u", key: "k", model: "gpt-5.4-mini", mode: "only" as const, only: true };
    expect(writerModel(w, { premium: true, maxTokens: 20000 })).toBe("gpt-5.4-mini");
    expect(writerModel({ ...w, premium: "kimi" }, { maxTokens: 5999 })).toBe("gpt-5.4-mini");
    expect(writerModel({ ...w, premium: "kimi" }, { maxTokens: 6000 })).toBe("kimi");
  });
});

describe("Azure transcription", () => {
  it("sends the audio to the Whisper deployment and returns its timed segments", async () => {
    azureOnly();
    const dir = mkdtempSync(path.join(tmpdir(), "asr-"));
    const wav = path.join(dir, "tone.wav");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", wav]);
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      calls.push(String(u));
      const form = init?.body as FormData;
      expect(form.get("response_format")).toBe("verbose_json");
      expect((form.get("file") as Blob).size).toBeGreaterThan(0);
      return Response.json({ text: "Round four.", segments: [{ start: 0, end: 1.2, text: " Round four." }] });
    }));
    const { transcribe } = await import("@/lib/transcribe");
    expect(await transcribe(wav)).toEqual([{ start: 0, end: 1.2, text: " Round four." }]);
    expect(calls).toEqual([`${AZ}/openai/deployments/whisper/audio/transcriptions?api-version=2024-06-01`]);
  });

  it("is not used outside Azure-only mode unless a deployment is set, and never when it's switched off", async () => {
    const { azureTranscriber } = await import("@/lib/transcribe");
    process.env.AZURE_AI_ENDPOINT = AZ;
    process.env.AZURE_AI_KEY = "z".repeat(84);
    expect(await azureTranscriber()).toBeNull();
    process.env.AZURE_AI_TRANSCRIBE_DEPLOYMENT = "whisper-large";
    expect((await azureTranscriber())?.url).toContain("/deployments/whisper-large/");
    process.env.AZURE_ONLY = "1";
    process.env.AZURE_AI_TRANSCRIBE_DEPLOYMENT = "off";
    expect(await azureTranscriber()).toBeNull();
  });
});
