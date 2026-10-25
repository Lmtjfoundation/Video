import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-flows-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN"]) delete process.env[k];
vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));

const ff = (...a: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...a]);
const probe = (f: string, what: string) => execFileSync("ffprobe", ["-v", "error", "-show_entries", what, "-of", "csv=p=0", f]).toString().trim();

function media() {
  const png = path.join(dir, "p.png");
  ff("-f", "lavfi", "-i", "color=c=0x334488:s=180x320", "-frames:v", "1", png);
  const mp4 = path.join(dir, "c.mp4");
  ff("-f", "lavfi", "-i", "testsrc=s=180x320:r=24:d=2", "-pix_fmt", "yuv420p", mp4);
  const music = path.join(dir, "m.wav");
  ff("-f", "lavfi", "-i", "sine=f=220:d=12", "-ar", "48000", "-ac", "2", music);
  const sfx = path.join(dir, "s.wav");
  ff("-f", "lavfi", "-i", "sine=f=900:d=1", "-ar", "48000", "-ac", "2", sfx);
  const speech = path.join(dir, "v.wav");
  ff("-f", "lavfi", "-i", "sine=f=400:d=3", "-ar", "24000", speech);
  return { png: readFileSync(png), mp4: readFileSync(mp4), music: readFileSync(music), sfx: readFileSync(sfx), speech: readFileSync(speech) };
}

function fakeEngine(m: ReturnType<typeof media>) {
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  const kinds = new Map<string, string>();
  let n = 0;
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const p = new URL(String(url)).pathname;
    if (p === "/v1/chat") return new Response(JSON.stringify({ detail: "writing is off" }), { status: 503 });
    const post = p.match(/^\/v1\/(images|videos|audio|speech)$/);
    if (post && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      posts.push({ path: p, body });
      const id = `j${++n}`;
      kinds.set(id, post[1] === "audio" ? String(body.kind) : post[1]);
      return Response.json({ id, status: "queued" });
    }
    const st = p.match(/^\/v1\/(?:images|videos|audio|speech)\/(j\d+)(\/file)?$/);
    if (st && !st[2]) return Response.json({ status: "succeeded", progress: 1 });
    if (st) {
      const k = kinds.get(st[1]);
      return new Response(new Uint8Array(k === "images" ? m.png : k === "videos" ? m.mp4 : k === "music" ? m.music : k === "sfx" ? m.sfx : m.speech));
    }
    return new Response("{}", { status: 404 });
  });
  return { posts, fetchFn };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.VIDEO_ENGINE_URL;
  delete process.env.VIDEO_ENGINE_TOKEN;
});

describe("Flows", () => {
  it("checks a flow and prices it step by step", async () => {
    const { cleanFlow, flowCredits } = await import("@/lib/flows");
    const { CREDIT_COST } = await import("@/lib/plans");
    const { FLOW_TEMPLATES } = await import("@/lib/flow-types");
    expect(() => cleanFlow({ name: "x", steps: [] })).toThrow(/at least one step/);
    expect(() => cleanFlow({ name: "", steps: [{ type: "music" }] })).toThrow(/Name/);
    expect(() => cleanFlow({ name: "x", steps: [{ type: "hack" as never }] })).toThrow(/Unknown step/);
    const f = cleanFlow({ name: "Ad", steps: [{ type: "image" }, { type: "footage", seconds: 3 }, { type: "music" }, { type: "finish" }] });
    expect(flowCredits(f)).toBe(CREDIT_COST.aiImage + 3 * CREDIT_COST.ownSecond + CREDIT_COST.aiMusic);
    for (const t of FLOW_TEMPLATES) expect(() => cleanFlow({ ...t })).not.toThrow();
  });

  it("runs every step from one idea and finishes one mixed video", { timeout: 120_000 }, async () => {
    const m = media();
    const engine = fakeEngine(m);
    vi.stubGlobal("fetch", engine.fetchFn);
    process.env.VIDEO_ENGINE_URL = "https://gpu.example";
    process.env.VIDEO_ENGINE_TOKEN = "engine-token";
    const { asUser } = await import("@/lib/db");
    const { runFlow, cleanFlow } = await import("@/lib/flows");
    const user = "usr_flow";
    const flow = cleanFlow({
      name: "Midnight ad",
      steps: [
        { type: "image", prompt: "A cold brew can on a night desk: {idea}", aspect: "9:16" },
        { type: "footage", seconds: 2 },
        { type: "music", prompt: "Late-night lo-fi for {idea}", seconds: 30 },
        { type: "sfx", prompt: "Can opening with a fizz", seconds: 1 },
        { type: "voiceover", prompt: "Midnight. Cold brew for people who work while the city sleeps.", language: "en" },
        { type: "finish" },
      ],
    });
    const steps: number[] = [];
    const r = await asUser(user, () => runFlow(user, flow, "Midnight cold brew", (i) => steps.push(i)));
    expect(steps).toEqual([0, 1, 2, 3, 4, 5]);
    expect(engine.posts.map((p) => p.path)).toEqual(["/v1/images", "/v1/videos", "/v1/audio", "/v1/audio", "/v1/speech"]);
    expect(String(engine.posts[0].body.prompt)).toContain("A cold brew can on a night desk: Midnight cold brew");
    expect(engine.posts[1].body).toMatchObject({ aspect: "9:16", seconds: 2 });
    expect(typeof engine.posts[1].body.image).toBe("string"); // the footage starts from the picture
    expect(String(engine.posts[2].body.prompt)).toContain("Late-night lo-fi for Midnight cold brew");
    expect(r.outputs.map((o) => o.type)).toEqual(["image", "footage", "music", "sfx", "voiceover", "finish"]);
    const file = path.join(dir, "uploads", user, r.final!.storagePath.split("/")[1]);
    expect(r.final!.name).toBe("flow-midnight-ad.mp4");
    expect(Number(probe(file, "format=duration"))).toBeCloseTo(8, 0); // at least 8 s (the voice is 3 s)
    expect(probe(file, "stream=codec_type").split("\n")).toEqual(["video", "audio"]);
    expect(probe(file, "stream=width,height").split("\n")[0]).toBe("1080,1920");
  });
});
