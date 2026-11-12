import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-batch-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
process.env.AZURE_BATCH_POLL_MS = "1";
const BASE = "https://gp-test.services.ai.azure.com/openai/v1";

function stubBatch(answers: Record<string, unknown>, o: { fail?: boolean } = {}) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  let polls = 0;
  let uploaded = "";
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    const url = String(u);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body });
    if (url === `${BASE}/files` && method === "POST") {
      uploaded = await ((init!.body as FormData).get("file") as Blob).text();
      return Response.json({ id: "file-1" });
    }
    if (url === `${BASE}/batches` && method === "POST") return Response.json({ id: "batch-1", status: "validating" });
    if (url === `${BASE}/batches/batch-1`) return Response.json(++polls < 2 ? { status: "in_progress" } : o.fail ? { status: "failed" } : { status: "completed", output_file_id: "out-1" });
    if (url === `${BASE}/files/out-1/content`) {
      const lines = uploaded ? uploaded.split("\n").map((l) => JSON.parse(l) as { custom_id: string }) : [];
      return new Response(lines.map((l) => JSON.stringify({ custom_id: l.custom_id, response: { status_code: 200, body: { choices: [{ message: { content: JSON.stringify(answers[l.custom_id]) } }] } } })).join("\n"));
    }
    return new Response("?", { status: 500 });
  }));
  return { calls, uploaded: () => uploaded };
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["AZURE_AI_ENDPOINT", "AZURE_AI_KEY"]) delete process.env[k];
});

describe("Azure batch (full GPT-5.4 for long videos)", () => {
  it("sends every request in one batch with GPT-5 settings, waits, and returns each answer by id", async () => {
    process.env.AZURE_AI_ENDPOINT = "https://gp-test.services.ai.azure.com";
    process.env.AZURE_AI_KEY = "k".repeat(84);
    const s = stubBatch({ a: { x: 1 }, b: { x: 2 } });
    const { runBatch } = await import("@/lib/azure-batch");
    const state = path.join(dir, "t1.batch");
    const out = await runBatch([{ id: "a", system: "s", user: "u1", maxTokens: 500 }, { id: "b", system: "s", user: "u2", maxTokens: 500 }], { stateFile: state, pollMs: 1 });
    expect(JSON.parse(out.get("a")!)).toEqual({ x: 1 });
    expect(JSON.parse(out.get("b")!)).toEqual({ x: 2 });
    const first = JSON.parse(s.uploaded().split("\n")[0]);
    expect(first.body).toMatchObject({ model: "gpt-5.4-batch", max_completion_tokens: 4000, response_format: { type: "json_object" } });
    expect(existsSync(state)).toBe(false);
  });

  it("picks up the same batch after a restart instead of starting (and paying for) a new one", async () => {
    process.env.AZURE_AI_ENDPOINT = "https://gp-test.services.ai.azure.com";
    process.env.AZURE_AI_KEY = "k".repeat(84);
    const s = stubBatch({});
    const state = path.join(dir, "t2.batch");
    writeFileSync(state, "batch-1");
    const { runBatch } = await import("@/lib/azure-batch");
    await runBatch([{ id: "a", system: "s", user: "u", maxTokens: 100 }], { stateFile: state, pollMs: 1 });
    expect(s.calls.some((c) => c.url === `${BASE}/files` && c.method === "POST")).toBe(false);
  });

  it("long videos: plans go through the batch, and are written the usual way when the batch fails", async () => {
    process.env.AZURE_AI_ENDPOINT = "https://gp-test.services.ai.azure.com";
    process.env.AZURE_AI_KEY = "k".repeat(84);
    const { batched } = await import("@/lib/video-lab-long");
    const planner = (id: string) => async (w?: (o: { system: string; user: string; maxTokens?: number }) => Promise<{ v: string }>) => (w ? (await w({ system: "s", user: `plan ${id}`, maxTokens: 900 })).v : `usual ${id}`);
    stubBatch({ c1: { v: "batch c1" }, c2: { v: "batch c2" } });
    const got = await batched(dir, "t3", [{ id: "c1", plan: planner("c1") as never }, { id: "c2", plan: planner("c2") as never }], () => {});
    expect([...got.values()]).toEqual(["batch c1", "batch c2"]);
    stubBatch({}, { fail: true });
    const fallback = await batched(dir, "t4", [{ id: "c1", plan: planner("c1") as never }], () => {});
    expect(fallback.get("c1")).toBe("usual c1");
  });
});
