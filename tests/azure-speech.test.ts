import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "ghost-post-azure-speech-"));
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL"]) delete process.env[k];
vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));

const WAV = Buffer.from("RIFF0000WAVEfmt " + "x".repeat(40));
const MP4 = Buffer.from("00000020ftypisom" + "y".repeat(40));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const k of ["AZURE_AI_KEY", "AZURE_AI_REGION", "AZURE_AI_ENDPOINT"]) delete process.env[k];
});

describe("Azure AI Speech", () => {
  it("speaks with an Azure voice at the app's 48 kHz, escaping the script and setting the speed", async () => {
    process.env.AZURE_AI_KEY = "k".repeat(84);
    process.env.AZURE_AI_REGION = "eastus2";
    const seen: { url: string; headers: Headers; body: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      seen.push({ url: String(u), headers: new Headers(init?.headers), body: String(init?.body) });
      return new Response(new Uint8Array(WAV));
    }));
    const { voiceWav, checkVoice } = await import("@/lib/voice-lab");
    const choice = await checkVoice({ kind: "azure", name: "en-US-AndrewMultilingualNeural", speed: 1.2 });
    expect(choice).toEqual({ kind: "azure", name: "en-US-AndrewMultilingualNeural", speed: 1.2 });
    const out = await voiceWav("[excited] Tom & Jerry <live>", choice);
    expect(out.equals(WAV)).toBe(true);
    expect(seen[0].url).toBe("https://eastus2.tts.speech.microsoft.com/cognitiveservices/v1");
    expect(seen[0].headers.get("X-Microsoft-OutputFormat")).toBe("riff-48khz-16bit-mono-pcm");
    expect(seen[0].body).toContain('<voice name="en-US-AndrewMultilingualNeural"><prosody rate="20%">');
    expect(seen[0].body).toContain("Tom &amp; Jerry &lt;live&gt;");
    expect(seen[0].body).not.toContain("[excited]");
    await expect(checkVoice({ kind: "azure", name: "not-a-voice" })).rejects.toThrow(/Azure voices/);
  });

  it("films a talking presenter: starts the job, waits for it, downloads the video and cleans up", async () => {
    process.env.AZURE_AI_KEY = "k".repeat(84);
    vi.useFakeTimers();
    let polls = 0;
    const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      const url = String(u);
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      if (url.startsWith("https://files.example/")) return new Response(new Uint8Array(MP4));
      if (method === "PUT") return Response.json({ status: "NotStarted" }, { status: 201 });
      if (method === "DELETE") return new Response(null, { status: 204 });
      return Response.json(++polls < 2 ? { status: "Running" } : { status: "Succeeded", outputs: { result: "https://files.example/out.mp4" } });
    }));
    const { azurePresenter } = await import("@/lib/azure-speech");
    const p = azurePresenter({ script: "Welcome to the show.", voice: "en-US-AvaMultilingualNeural", avatar: "lisa", style: "casual-sitting", background: "green", captions: true });
    await vi.runAllTimersAsync();
    const mp4 = await p;
    expect(mp4.equals(MP4)).toBe(true);
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toMatch(/^https:\/\/eastus2\.api\.cognitive\.microsoft\.com\/avatar\/batchsyntheses\/gp-[a-z0-9-]+\?api-version=2024-08-01$/);
    expect(put.body).toMatchObject({ inputs: [{ content: "Welcome to the show." }], synthesisConfig: { voice: "en-US-AvaMultilingualNeural" }, avatarConfig: { talkingAvatarCharacter: "lisa", talkingAvatarStyle: "casual-sitting", backgroundColor: "#00FF00FF", subtitleType: "hard_embedded" } });
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    await expect(azurePresenter({ script: "hi", voice: "en-US-AvaMultilingualNeural", avatar: "lisa", style: "dancing", background: "white" })).rejects.toThrow(/presenter and pose/);
  });
});
