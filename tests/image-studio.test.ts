import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-image-studio-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "GEMINI_API_KEY", "VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN"]) delete process.env[k];
vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

/** A tiny stand-in for Ghost Post's engine: records each picture request and answers with a 1×1 PNG. */
function fakeEngine() {
  const requests: { prompt: string; images: string[]; aspect: string }[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const p = new URL(String(url)).pathname;
    if (p === "/v1/images" && init?.method === "POST") {
      requests.push(JSON.parse(String(init.body)));
      return Response.json({ id: `img${requests.length}`, status: "queued" });
    }
    if (/^\/v1\/images\/img\d+$/.test(p)) return Response.json({ id: p.split("/").pop(), status: "succeeded", progress: 1 });
    if (/^\/v1\/images\/img\d+\/file$/.test(p)) return new Response(PNG, { headers: { "content-type": "image/png" } });
    return new Response("not found", { status: 404 });
  });
  return { requests, fetchFn };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.VIDEO_ENGINE_URL;
  delete process.env.VIDEO_ENGINE_TOKEN;
});

describe("Image Studio on Ghost Post's own engine", () => {
  it("makes, edits and stages pictures on the engine (never Gemini) and saves them to the Media Library", async () => {
    const engine = fakeEngine();
    vi.stubGlobal("fetch", engine.fetchFn);
    process.env.VIDEO_ENGINE_URL = "https://gpu.example/";
    process.env.VIDEO_ENGINE_TOKEN = "engine-token";
    const { asUser, db } = await import("@/lib/db");
    const { storeFile } = await import("@/lib/media");
    const { makeStudioImage } = await import("@/lib/image-studio");
    const { picturesReady } = await import("@/lib/pictures");
    const { kvSet } = await import("@/lib/repo");
    const userId = "usr_images";

    await asUser(userId, async () => {
      expect(await picturesReady()).toBe("own");
      const made = await makeStudioImage(userId, { mode: "create", prompt: "A Houston corner at night", look: "Photorealistic film still, true-to-life human faces", aspect: "9:16" });
      expect(made.name.startsWith("studio-create-")).toBe(true);
      expect((await db().get<{ id: string }>("media", made.id))?.id).toBe(made.id);
      expect(engine.requests[0].images).toEqual([]);
      expect(engine.requests[0].prompt).toContain("A Houston corner at night");
      expect(engine.requests[0].prompt).toContain("Photorealistic real people"); // realistic looks get the realism direction

      // Edit: the chosen picture goes with the instruction.
      await makeStudioImage(userId, { mode: "edit", prompt: "make it rain", mediaId: made.id, aspect: "9:16" });
      expect(engine.requests[1].images).toHaveLength(1);
      expect(engine.requests[1].prompt).toMatch(/^Edit picture 1: make it rain/);

      // Scene: each character's portrait, named by its picture number, then the setting.
      const face = await storeFile(userId, { name: "marcus.png", type: "image/png", bytes: PNG });
      await kvSet("characters", [{ id: "chr_m", name: "Marcus", description: "Tall, short beard", look: "Photorealistic", imageMediaId: face.id, createdAt: new Date().toISOString() }]);
      await makeStudioImage(userId, { mode: "scene", prompt: "at the kitchen table", characterIds: ["chr_m"], mediaId: made.id, aspect: "16:9" });
      const scene = engine.requests[2];
      expect(scene.images).toHaveLength(2);
      expect(scene.aspect).toBe("16:9");
      expect(scene.prompt).toContain("Marcus is the person in picture 1");
      expect(scene.prompt).toContain("the setting is the place in picture 2");
    });
    expect(engine.fetchFn.mock.calls.every(([u]) => String(u).startsWith("https://gpu.example/"))).toBe(true);
  });

  it("says what's missing instead of making a picture", async () => {
    const { asUser } = await import("@/lib/db");
    const { studioRequest } = await import("@/lib/image-studio");
    await asUser("usr_images_2", async () => {
      await expect(studioRequest({ mode: "create", prompt: "  ", aspect: "1:1" })).rejects.toThrow("Describe the picture.");
      await expect(studioRequest({ mode: "edit", prompt: "brighter", aspect: "1:1" })).rejects.toThrow("Choose the picture to change.");
      await expect(studioRequest({ mode: "scene", prompt: "a park", characterIds: [], aspect: "1:1" })).rejects.toThrow("Choose at least one character");
    });
  });
});
