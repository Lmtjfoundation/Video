import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-dev-api-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
process.env.SETUP_CODE = "test-setup-code";
for (const k of ["SUPABASE_URL", "DATABASE_URL", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN"]) delete process.env[k];

const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
const req = (url: string, key?: string, body?: unknown) =>
  new Request(`http://app.test${url}`, { method: body ? "POST" : "GET", headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.VIDEO_ENGINE_URL;
  delete process.env.VIDEO_ENGINE_TOKEN;
});

describe("developer API", () => {
  it("accepts only live keys, scopes everything to the key's owner, and limits the rate", async () => {
    const { createUser } = await import("@/lib/auth");
    const { asUser } = await import("@/lib/db");
    const { createKey, listKeys, revokeKey, overLimit } = await import("@/lib/api-keys");
    const { addAsset } = await import("@/lib/library");
    const library = await import("@/app/api/v1/library/route");
    const owner = await createUser({ email: "dev@example.com", password: "Correct-horse-battery-9", setupCode: "test-setup-code" });
    const other = await createUser({ email: "other@example.com", password: "Correct-horse-battery-9" });

    const { key, record } = await asUser(owner.id, () => createKey(owner.id, "Website"));
    expect(key).toMatch(/^gp_live_[A-Za-z0-9_-]{32}$/);
    expect(record.prefix).toBe(key.slice(0, 12));
    expect(JSON.stringify(await asUser(owner.id, () => listKeys()))).not.toContain(key); // only the hash is kept

    const t = new Date().toISOString();
    const track = { id: "aud_1", kind: "music" as const, title: "Night Drive", description: "synthwave", owner: owner.id, mediaId: "m1", previewId: "m1", seconds: 90, bpm: 110, genres: ["Synthwave"], moods: ["Dreamy"], themes: [], instruments: [], peaks: [0.5], model: "ACE-Step 1.5", downloads: 0, createdAt: t };
    await asUser(owner.id, () => addAsset(track));
    await asUser(other.id, () => addAsset({ ...track, id: "aud_2", owner: other.id, title: "Not yours" }));

    expect((await library.GET(req("/api/v1/library?kind=music"), ctx())).status).toBe(401);
    expect((await library.GET(req("/api/v1/library?kind=music", "gp_live_" + "x".repeat(32)), ctx())).status).toBe(401);
    const res = await library.GET(req("/api/v1/library?kind=music&moods=Dreamy", key), ctx());
    expect(res.status).toBe(200);
    const j = (await res.json()) as { total: number; items: { id: string; title: string; preview_url: string; bpm: number }[] };
    expect(j.items.map((i) => i.title)).toEqual(["Night Drive"]);
    expect(j.items[0].preview_url).toContain("/api/media/file/");

    expect(overLimit("key_test", 3, 0)).toBe(false);
    overLimit("key_test", 3, 1);
    overLimit("key_test", 3, 2);
    expect(overLimit("key_test", 3, 3)).toBe(true);
    expect(overLimit("key_test", 3, 61_000)).toBe(false); // a minute later

    await asUser(owner.id, () => revokeKey(record.id));
    expect((await library.GET(req("/api/v1/library", key), ctx())).status).toBe(401);
  });

  it("starts a generation as a job, charges the owner, and reports it", async () => {
    const { createUser, getUser, rollVault } = await import("@/lib/auth");
    const balance = async (id: string) => ((await rollVault((await getUser(id))!)).vault?.lots ?? []).reduce((n, l) => n + l.credits, 0);
    const { asUser } = await import("@/lib/db");
    const { createKey } = await import("@/lib/api-keys");
    const gen = await import("@/app/api/v1/generate/route");
    const jobs = await import("@/app/api/v1/jobs/[id]/route");
    const u = await createUser({ email: "maker@example.com", password: "Correct-horse-battery-9" });
    const { key } = await asUser(u.id, () => createKey(u.id, "Bot"));

    // No engine: a clear 503, and nothing charged.
    const before = await balance(u.id);
    expect(before).toBeGreaterThan(0);
    const r0 = await gen.POST(req("/api/v1/generate", key, { kind: "music", prompt: "lo-fi", seconds: 30 }), ctx());
    expect(r0.status).toBe(503);
    expect(await balance(u.id)).toBe(before);

    // An engine that fails the track: the job fails and the credits come back.
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const p = new URL(String(url)).pathname;
      if (p === "/v1/audio" && init?.method === "POST") return Response.json({ id: "a1", status: "queued" });
      if (p === "/v1/audio/a1") return Response.json({ status: "failed", error: "CUDA out of memory" });
      return new Response("{}", { status: 404 });
    }));
    process.env.VIDEO_ENGINE_URL = "https://gpu.example";
    process.env.VIDEO_ENGINE_TOKEN = "t";
    expect((await gen.POST(req("/api/v1/generate", key, { kind: "music", prompt: "lo-fi", seconds: 5 }), ctx())).status).toBe(400);
    const r = await gen.POST(req("/api/v1/generate", key, { kind: "music", prompt: "Warm lo-fi", seconds: 30 }), ctx());
    expect(r.status).toBe(202);
    const { job, credits } = (await r.json()) as { job: { id: string }; credits: number };
    expect(credits).toBeGreaterThan(0);
    let s: { status: string; message: string } = { status: "queued", message: "" };
    for (let i = 0; i < 200 && s.status !== "failed"; i++) {
      await new Promise((res) => setTimeout(res, 10));
      s = (await (await jobs.GET(req(`/api/v1/jobs/${job.id}`, key), ctx({ id: job.id }))).json()) as typeof s;
    }
    expect(s.status).toBe("failed");
    expect(s.message).toContain("CUDA out of memory");
    expect(await balance(u.id)).toBe(before); // refunded
  });
});
