import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FilmCut, FilmRef } from "@/lib/film-engine";

const dir = mkdtempSync(path.join(tmpdir(), "nexus-film-engine-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "ELEVENLABS_API_KEY"]) delete process.env[k];
process.env.RENDER_PRESET = "ultrafast";
process.env.FREE_VOICE = "off"; // the free voice downloads a 90 MB model; tested on its own

vi.mock("server-only", () => ({}));
vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));
vi.mock("@/lib/integrations", async (orig) => ({ ...(await orig<typeof import("@/lib/integrations")>()), replicateKey: async () => process.env.REPLICATE_API_TOKEN ?? "" }));

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const ref = (id: string, kind: FilmRef["kind"], label: string): FilmRef => ({ id, kind, mediaId: `m_${id}`, label });
const cast = [ref("r1", "image", "Marcus"), ref("r2", "image", "Tasha"), ref("r3", "image", "Kitchen"), ref("r4", "video", "Rain plate"), ref("r5", "audio", "Tasha line")];

describe("Film Engine shot lists and Seedance briefs", () => {
  it("reads timestamped shots, keeps them in the beat, and finds the dialogue", async () => {
    const { parseShots, dialogueOf } = await import("@/lib/film-engine");
    const shots = parseShots("0–8s: wide shot of @Kitchen, slow push-in.\nRain on the window.\n8-18s: Tasha says \"Where were you?\"\n18–40s: close-up, cut to black.", 30);
    expect(shots).toEqual([
      { start: 0, end: 8, text: "wide shot of @Kitchen, slow push-in. Rain on the window." },
      { start: 8, end: 18, text: 'Tasha says "Where were you?"' },
      { start: 18, end: 30, text: "close-up, cut to black." },
    ]);
    expect(parseShots("Just one long take", 12)).toEqual([{ start: 0, end: 12, text: "Just one long take" }]);
    expect(dialogueOf('Marcus: "I gave you every key." Tasha: “Then why lock me out?”')).toEqual(["I gave you every key.", "Then why lock me out?"]);
  });

  it("turns @names into Seedance's numbered references, in the order the beat uses them", async () => {
    const { resolveRefs } = await import("@/lib/film-engine");
    const r = resolveRefs(cast, "0–5s: @Tasha at the sink in @Kitchen. @Marcus enters, lit like @Image2 again. @Rain plate motion. Lip-sync to @Tasha line.");
    expect(r.images.map((x) => x.label)).toEqual(["Tasha", "Kitchen", "Marcus"]);
    expect(r.prompt).toContain("[Image1] (Tasha) at the sink in [Image2] (Kitchen). [Image3] (Marcus) enters, lit like [Image1] (Tasha) again.");
    expect(r.videos.map((x) => x.label)).toEqual(["Rain plate"]);
    expect(r.audios.map((x) => x.label)).toEqual(["Tasha line"]);
    // A beat that names nobody still gets the cast as identity references.
    expect(resolveRefs(cast, "Wide shot of the city at night.").images).toHaveLength(3);
  });

  it("writes an extension brief that continues the previous clip, and an edit brief for a fix", async () => {
    const { seedanceBrief } = await import("@/lib/film-engine");
    const cut = { refs: cast, style: "Photorealistic, anamorphic, teal and amber.", aspect: "9:16" as const, nativeAudio: true };
    const seg = { title: "The call", seconds: 25, shots: "0–10s: @Marcus answers. Uses @Rain plate.\n10–25s: \"Who is this?\"" };
    const fresh = seedanceBrief(cut, seg);
    expect(fresh).toMatchObject({ seconds: 25, aspect: "9:16" });
    expect(fresh.prompt).toContain("[Image1] (Marcus) answers. Uses [Video1] (Rain plate).");
    expect(fresh.prompt).toMatch(/lip-sync/);
    const next = seedanceBrief(cut, seg, { continuing: true });
    expect(next.aspect).toBe("adaptive");
    expect(next.prompt).toMatch(/^Production brief/);
    expect(next.prompt).toContain("Extend [Video1]");
    expect(next.prompt).toContain("Uses [Video2] (Rain plate)"); // the previous beat takes [Video1]
    const fix = seedanceBrief(cut, seg, { fix: "At 12s, make the phone screen glow blue." });
    expect(fix).toMatchObject({ seconds: -1, aspect: "adaptive" });
    expect(fix.prompt.startsWith("Edit [Video1]: At 12s, make the phone screen glow blue.")).toBe(true);
  });

  it("prices beats by engine", async () => {
    const { segmentCredits } = await import("@/lib/film-engine");
    expect(segmentCredits("seedance", 25)).toBe(25 * 16);
    expect(segmentCredits("wan", 12)).toBe(15 * 2); // three 5-second clips
    expect(segmentCredits("free", 30)).toBe(0);
    expect(segmentCredits("own", 12)).toBe(15); // three 5-second clips at 1 credit a second
  });
});

describe.skipIf(!hasFfmpeg)("Film Engine making footage", () => {
  const realFetch = globalThis.fetch;
  let clip: Buffer;
  let red = "";
  let blue = "";
  beforeAll(() => {
    const f = (name: string, src: string, extra: string[] = []) => {
      const out = path.join(dir, name);
      execFileSync("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", src, ...extra, out], { stdio: "ignore" });
      return out;
    };
    red = f("red.png", "color=c=red:s=480x480", ["-frames:v", "1"]);
    blue = f("blue.png", "color=c=blue:s=480x480", ["-frames:v", "1"]);
    clip = readFileSync(f("clip.mp4", "testsrc2=s=720x1280:r=24:d=3", ["-f", "lavfi", "-i", "sine=f=440:d=3", "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac"]));
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.REPLICATE_API_TOKEN;
  });

  async function setup(engine: FilmCut["engine"]) {
    const { asUser } = await import("@/lib/db");
    const { storeFile } = await import("@/lib/media");
    const { saveCut, newSegment } = await import("@/lib/film-engine");
    return asUser("usr_film", async () => {
      const a = await storeFile("usr_film", { name: "marcus.png", type: "image/png", bytes: readFileSync(red) });
      const b = await storeFile("usr_film", { name: "tasha.png", type: "image/png", bytes: readFileSync(blue) });
      const t = new Date().toISOString();
      const cut: FilmCut = {
        id: `cut_${engine}`, title: "The Settlement", logline: "", style: "Rain-soaked noir.", aspect: "9:16", engine, nativeAudio: true, score: true,
        refs: [{ id: "ref_a", kind: "image", mediaId: a.id, label: "Marcus" }, { id: "ref_b", kind: "image", mediaId: b.id, label: "Tasha" }],
        segments: [
          newSegment({ title: "Keys", seconds: 4, shots: "0–2s: @Marcus holds out the keys.\n2–4s: @Tasha takes them. \"Thank you.\"", continueFrom: false }),
          newSegment({ title: "Night", seconds: 3, shots: "0–3s: @Tasha alone at the window.", continueFrom: true }),
        ],
        createdAt: t, updatedAt: t,
      };
      return saveCut(cut);
    });
  }

  it("films beats with the free engine (camera moves on the reference pictures) and cuts the film together", async () => {
    const cut = await setup("free");
    const { asUser, db } = await import("@/lib/db");
    const { getCut, queueSegment, queueAssembly } = await import("@/lib/film-engine");
    await asUser("usr_film", async () => {
      await queueSegment("usr_film", cut.id, cut.segments[0].id, 0);
      await queueSegment("usr_film", cut.id, cut.segments[1].id, 0);
      const filmed = (await getCut(cut.id))!;
      expect(filmed.segments.map((s) => [s.status, s.message])).toEqual([["done", "Filmed with the free engine."], ["done", "Filmed with the free engine."]]);
      await queueAssembly("usr_film", cut.id);
      const done = (await getCut(cut.id))!;
      expect(done.final?.status, done.final?.message).toBe("done");
      const item = await db().get<import("@/lib/types").MediaItem>("media", done.final!.mediaId!);
      expect(item?.durationSec).toBeGreaterThanOrEqual(6);
    });
  }, 180_000);

  it("films with Seedance 2.5: cast as reference pictures, the next beat extends the previous clip, and a fix edits one beat", async () => {
    process.env.REPLICATE_API_TOKEN = "r8_test";
    const inputs: Record<string, unknown>[] = [];
    let uploads = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
      if (url.endsWith("/v1/files")) return json({ urls: { get: `https://api.replicate.com/v1/files/f${++uploads}` } });
      if (url.endsWith("/models/bytedance/seedance-2.5/predictions")) {
        inputs.push(JSON.parse(String(init?.body)).input);
        return json({ id: `p${inputs.length}`, status: "succeeded", output: "https://replicate.delivery/clip.mp4" });
      }
      if (url === "https://replicate.delivery/clip.mp4") return new Response(new Uint8Array(clip));
      return new Response("not mocked", { status: 500 });
    }) as typeof fetch;
    const cut = await setup("seedance");
    const { asUser } = await import("@/lib/db");
    const { getCut, queueSegment, queueAssembly } = await import("@/lib/film-engine");
    await asUser("usr_film", async () => {
      await queueSegment("usr_film", cut.id, cut.segments[0].id, 0);
      await queueSegment("usr_film", cut.id, cut.segments[1].id, 0);
      let c = (await getCut(cut.id))!;
      expect(c.segments.map((s) => s.status)).toEqual(["done", "done"]);
      expect(inputs[0]).toMatchObject({ duration: 4, aspect_ratio: "9:16", generate_audio: true, resolution: "720p", reference_videos: [] });
      expect((inputs[0].reference_images as string[]).length).toBe(2);
      expect(String(inputs[0].prompt)).toContain("[Image1] (Marcus) holds out the keys.");
      expect(inputs[1]).toMatchObject({ duration: 3, aspect_ratio: "adaptive" });
      expect((inputs[1].reference_videos as string[]).length).toBe(1); // the end of beat one
      expect(String(inputs[1].prompt)).toContain("Extend [Video1]");

      const firstTake = c.segments[0].clipMediaId;
      await queueSegment("usr_film", cut.id, cut.segments[0].id, 0, "Make the keys gold.");
      c = (await getCut(cut.id))!;
      expect(inputs[2]).toMatchObject({ duration: -1, aspect_ratio: "adaptive" });
      expect(String(inputs[2].prompt)).toMatch(/^Edit \[Video1\]: Make the keys gold\./);
      expect(c.segments[0].history).toEqual([firstTake]);

      await queueAssembly("usr_film", cut.id);
      expect((await getCut(cut.id))!.final?.status).toBe("done");
    });
  }, 180_000);

  it("films with Ghost Post's own engine: clips chained from each last frame, a cut to a shot's own picture", async () => {
    process.env.VIDEO_ENGINE_URL = "https://gpu.example/";
    process.env.VIDEO_ENGINE_TOKEN = "engine-token-123";
    const posts: { body: Record<string, unknown>; auth: string }[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "");
      const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
      if (url === "https://gpu.example/v1/videos" && init?.method === "POST") {
        posts.push({ body: JSON.parse(String(init.body)), auth });
        return json({ id: `j${posts.length}`, status: "queued" });
      }
      if (/^https:\/\/gpu\.example\/v1\/videos\/j\d+$/.test(url)) return json({ status: "succeeded", progress: 1 });
      if (/\/v1\/videos\/j\d+\/file$/.test(url)) return new Response(new Uint8Array(clip));
      return new Response("not mocked", { status: 500 });
    }) as typeof fetch;
    const cut = await setup("own");
    const { asUser } = await import("@/lib/db");
    const { getCut, queueSegment, saveCut } = await import("@/lib/film-engine");
    await asUser("usr_film", async () => {
      // Beat one: 0–2s Marcus, 2–4s cuts to Tasha; seven seconds so it takes two clips.
      const c0 = (await getCut(cut.id))!;
      c0.segments[0].seconds = 7;
      c0.segments[0].shots = "0–5s: @Marcus holds out the keys.\n5–7s: @Tasha takes them.";
      await saveCut(c0);
      await queueSegment("usr_film", cut.id, cut.segments[0].id, 0);
      await queueSegment("usr_film", cut.id, cut.segments[1].id, 0);
      const done = (await getCut(cut.id))!;
      expect(done.segments.map((s) => [s.status, s.message])).toEqual([["done", "Filmed with Ghost Post's video engine."], ["done", "Filmed with Ghost Post's video engine."]]);
    });
    expect(posts.every((p) => p.auth === "Bearer engine-token-123")).toBe(true);
    expect(posts.map((p) => [p.body.aspect, p.body.seconds])).toEqual([["9:16", 5], ["9:16", 2], ["9:16", 3]]);
    const frame = (i: number) => String(posts[i].body.image);
    expect(frame(0)).toMatch(/^data:image\/png;base64,/); // Marcus's portrait
    expect(frame(1)).toMatch(/^data:image\/png;base64,/); // the cut to Tasha's portrait…
    expect(frame(1)).not.toBe(frame(0));
    expect(String(posts[1].body.prompt)).toContain("(Tasha) takes them");
    expect(frame(2)).toMatch(/^data:image\/png;base64,/); // beat two continues from beat one's last frame
    expect(frame(2)).not.toBe(frame(1));
    delete process.env.VIDEO_ENGINE_URL;
    delete process.env.VIDEO_ENGINE_TOKEN;
  }, 180_000);

  it("gives the credits back when filming fails", async () => {
    process.env.REPLICATE_API_TOKEN = "r8_test";
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/v1/files")) return new Response(JSON.stringify({ urls: { get: "https://api.replicate.com/v1/files/x" } }));
      return new Response(JSON.stringify({ id: "p", status: "failed", error: "flagged as sensitive" }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const cut = await setup("seedance");
    const { asUser } = await import("@/lib/db");
    const { getCut, queueSegment } = await import("@/lib/film-engine");
    await asUser("usr_film", async () => {
      await queueSegment("usr_film", cut.id, cut.segments[0].id, 0);
      const seg = (await getCut(cut.id))!.segments[0];
      expect(seg.status).toBe("failed");
      expect(seg.message).toMatch(/safety filter/);
    });
  }, 60_000);
});
