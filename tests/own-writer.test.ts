import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-writer-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "GEMINI_API_KEY", "VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN", "OWN_WRITER_ONLY"]) delete process.env[k];
vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));

const WRITER = "https://writer.example/v1";
type Seen = { url: string; body: Record<string, unknown> };

/** Stubs the network: the writer answers `writer` (or fails), Claude answers "from claude". */
function stubNet(writer: string | Error | number, seen: Seen[]) {
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    const url = String(u);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    seen.push({ url, body });
    if (url.startsWith(WRITER)) {
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer writer-key-12345");
      if (writer instanceof Error) throw writer;
      if (typeof writer === "number") return new Response("nope", { status: writer });
      return Response.json({ choices: [{ message: { content: writer } }] });
    }
    if (url.startsWith("https://api.anthropic.com/")) return Response.json({ content: [{ type: "text", text: "from claude" }], stop_reason: "end_turn" });
    return new Response("{}", { status: 404 });
  }));
}

beforeEach(async () => {
  process.env.OWN_WRITER_URL = WRITER;
  process.env.OWN_WRITER_KEY = "writer-key-12345";
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-1234567890abcdef";
  (await import("@/lib/llm")).resetClaudeDown();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["OWN_WRITER_URL", "OWN_WRITER_KEY", "OWN_WRITER_ONLY", "ANTHROPIC_API_KEY"]) delete process.env[k];
});

describe("Ghost Post's own writer", () => {
  it("writes first, so Claude isn't used (and isn't paid)", async () => {
    const seen: Seen[] = [];
    stubNet("<think>hmm</think>A post from the own writer.", seen);
    const { claude } = await import("@/lib/llm");
    expect(await claude({ system: "s", user: "write a post" })).toBe("A post from the own writer.");
    expect(seen.map((s) => s.url)).toEqual([`${WRITER}/chat/completions`]);
    expect(seen[0].body.model).toBe("qwen3:4b-instruct-2507-q4_K_M");
  });

  it("asks it for a JSON object when the app needs JSON", async () => {
    const seen: Seen[] = [];
    stubNet('{"scenes":[{"title":"a"}]}', seen);
    const { claudeJson } = await import("@/lib/llm");
    expect(await claudeJson<{ scenes: { title: string }[] }>({ system: "s", user: "plan" })).toEqual({ scenes: [{ title: "a" }] });
    expect(seen[0].body.response_format).toEqual({ type: "json_object" });
  });

  it("hands over to Claude when the writer can't answer, unless only the own writer is allowed", async () => {
    let seen: Seen[] = [];
    stubNet(new TypeError("fetch failed"), seen);
    const { claude } = await import("@/lib/llm");
    expect(await claude({ system: "s", user: "x" })).toBe("from claude");
    process.env.OWN_WRITER_ONLY = "1";
    seen = [];
    stubNet(503, seen);
    await expect(claude({ system: "s", user: "x" })).rejects.toThrow(/try again/);
    expect(seen.some((s) => s.url.includes("anthropic"))).toBe(false);
  });

  it("leaves pictures to an AI that can see them, and says so plainly when only the own writer is allowed", async () => {
    const seen: Seen[] = [];
    stubNet("should not be used", seen);
    const { claude } = await import("@/lib/llm");
    const images = [{ mediaType: "image/png" as const, base64: "iVBORw0KGgo=" }];
    expect(await claude({ system: "s", user: "describe", images })).toBe("from claude");
    expect(seen.some((s) => s.url.startsWith(WRITER))).toBe(false);
    process.env.OWN_WRITER_ONLY = "1";
    await expect(claude({ system: "s", user: "describe", images })).rejects.toThrow(/read pictures/);
  });

  it("counts as connected AI for the app's status", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { llmConfigured } = await import("@/lib/llm");
    expect(await llmConfigured()).toBe(true);
  });
});
