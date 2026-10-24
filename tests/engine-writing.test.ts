import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-engine-writing-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) delete process.env[k];
vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));

/** The engine (writing on or off) and Claude, side by side; records who was asked. */
function services(engineWrites: boolean) {
  const hits: string[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://gpu.example/v1/chat")) {
      hits.push("engine");
      const body = JSON.parse(String(init?.body));
      return engineWrites ? Response.json({ text: `engine wrote: ${body.user}` }) : Response.json({ detail: "Writing is switched off on this engine (ENGINE_TEXT=off)." }, { status: 503 });
    }
    if (u.startsWith("https://api.anthropic.com/")) {
      hits.push("claude");
      return Response.json({ content: [{ type: "text", text: "claude wrote" }], stop_reason: "end_turn" });
    }
    return new Response("not found", { status: 404 });
  });
  return { hits, fetchFn };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const k of ["VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN", "ANTHROPIC_API_KEY"]) delete process.env[k];
  (await import("@/lib/own-video")).resetEngineWriting();
});

describe("writing on Ghost Post's own engine", () => {
  const connect = () => {
    process.env.VIDEO_ENGINE_URL = "https://gpu.example/";
    process.env.VIDEO_ENGINE_TOKEN = "engine-token";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  };

  it("writes with the engine first, so Claude isn't used", async () => {
    connect();
    const s = services(true);
    vi.stubGlobal("fetch", s.fetchFn);
    const { claude } = await import("@/lib/llm");
    expect(await claude({ system: "You write.", user: "a logline" })).toBe("engine wrote: a logline");
    expect(s.hits).toEqual(["engine"]);
  });

  it("falls back to Claude when the engine's writing is off, then stops asking the engine for a while", async () => {
    connect();
    const s = services(false);
    vi.stubGlobal("fetch", s.fetchFn);
    const { claude } = await import("@/lib/llm");
    expect(await claude({ system: "You write.", user: "one" })).toBe("claude wrote");
    expect(await claude({ system: "You write.", user: "two" })).toBe("claude wrote");
    expect(s.hits).toEqual(["engine", "claude", "claude"]);
  });

  it("sends requests with pictures to a model that can see them", async () => {
    connect();
    const s = services(true);
    vi.stubGlobal("fetch", s.fetchFn);
    const { claude } = await import("@/lib/llm");
    await claude({ system: "Describe.", user: "who is this?", images: [{ mediaType: "image/png", base64: "AAAA" }] });
    expect(s.hits).toEqual(["claude"]);
  });
});
