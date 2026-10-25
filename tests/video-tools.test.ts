import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-video-tools-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN"]) delete process.env[k];
vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));

const ff = (...a: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...a]);
const probe = (f: string, what: string, extra: string[] = []) => execFileSync("ffprobe", ["-v", "error", ...extra, "-show_entries", what, "-of", "csv=p=0", f]).toString().trim();
const fileOf = (user: string, m: { storagePath: string }) => path.join(dir, "uploads", user, m.storagePath.split("/")[1]);

/** A click on every beat at `bpm` (a short burst of noise), `secs` long, mono 48 kHz. */
function clickTrack(bpm: number, secs: number, offset = 0.1) {
  const sr = 48000;
  const x = new Float32Array(secs * sr);
  for (let t = offset; t < secs; t += 60 / bpm) {
    const at = Math.round(t * sr);
    for (let j = 0; j < 600 && at + j < x.length; j++) x[at + j] = (Math.random() * 2 - 1) * Math.exp(-j / 150);
  }
  return x;
}

function media() {
  const png = path.join(dir, "p.png");
  ff("-f", "lavfi", "-i", "color=c=0x884422:s=180x320", "-frames:v", "1", png);
  const mp4 = path.join(dir, "c.mp4");
  ff("-f", "lavfi", "-i", "testsrc=s=180x320:r=24:d=2", "-pix_fmt", "yuv420p", mp4);
  const talk = path.join(dir, "talk.mp4");
  ff("-f", "lavfi", "-i", "testsrc=s=320x180:r=24:d=3", "-f", "lavfi", "-i", "sine=f=300:d=3", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", talk);
  const song = path.join(dir, "song.wav");
  ff("-f", "lavfi", "-i", "aevalsrc='0.8*exp(-mod(t-0.1,0.5)*40)*sin(2*PI*60*t)':s=48000:d=12", "-ac", "2", song);
  return { png: readFileSync(png), mp4: readFileSync(mp4), talk: readFileSync(talk), song: readFileSync(song) };
}

function fakeEngine(m: ReturnType<typeof media>) {
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  const kinds = new Map<string, string>();
  let n = 0;
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const p = new URL(String(url)).pathname;
    if (p === "/v1/chat") return new Response(JSON.stringify({ detail: "writing is off" }), { status: 503 });
    const post = p.match(/^\/v1\/(images|videos|video-edits)$/);
    if (post && init?.method === "POST") {
      posts.push({ path: p, body: JSON.parse(String(init.body)) });
      const id = `j${++n}`;
      kinds.set(id, post[1]);
      return Response.json({ id, status: "queued" });
    }
    const st = p.match(/^\/v1\/(?:images|videos|video-edits)\/(j\d+)(\/file)?$/);
    if (st && !st[2]) return Response.json({ status: "succeeded", progress: 1 });
    if (st) return new Response(new Uint8Array(kinds.get(st[1]) === "images" ? m.png : m.mp4));
    return new Response("{}", { status: 404 });
  });
  return { posts, fetchFn };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.VIDEO_ENGINE_URL;
  delete process.env.VIDEO_ENGINE_TOKEN;
});

describe("video tools", () => {
  it("finds the tempo and cuts on the beat", async () => {
    const { beatCuts } = await import("@/lib/video-tools");
    for (const bpm of [96, 120, 140]) {
      const { cuts, bpm: found } = beatCuts(clickTrack(bpm, 30), 48000);
      expect(Math.abs(found - bpm)).toBeLessThanOrEqual(2);
      const beat = 60 / bpm;
      // Every inner cut is on a click (within 25 ms), every shot is a whole number of beats, and shots last 1–5 s.
      for (const c of cuts.slice(1, -1)) expect(Math.abs(((c - 0.1) / beat) - Math.round((c - 0.1) / beat)) * beat).toBeLessThan(0.025);
      for (let i = 1; i < cuts.length; i++) expect(cuts[i] - cuts[i - 1]).toBeGreaterThan(1);
      expect(cuts[0]).toBe(0);
      expect(cuts.at(-1)).toBeCloseTo(30, 1);
    }
  });

  it("films a Smart Shot as cuts of one scene, keeping the master picture in every keyframe", { timeout: 120_000 }, async () => {
    const m = media();
    const engine = fakeEngine(m);
    vi.stubGlobal("fetch", engine.fetchFn);
    process.env.VIDEO_ENGINE_URL = "https://gpu.example";
    process.env.VIDEO_ENGINE_TOKEN = "t";
    const { asUser } = await import("@/lib/db");
    const { smartShot, smartShotCredits, SHOT_PLAN } = await import("@/lib/video-tools");
    const { CREDIT_COST } = await import("@/lib/plans");
    const user = "usr_vt1";
    await asUser(user, async () => {
      const steps: string[] = [];
      const out = await smartShot(user, { prompt: "A nurse walks out at dawn and smiles", shots: 3, secondsPerShot: 2, aspect: "9:16" }, (s) => steps.push(s));
      // The writer is off, so the standard coverage is used: master picture, then 2 edited keyframes, and 3 clips.
      expect(engine.posts.map((p) => p.path)).toEqual(["/v1/images", "/v1/videos", "/v1/images", "/v1/videos", "/v1/images", "/v1/videos"]);
      expect(String(engine.posts[0].body.prompt)).toContain(SHOT_PLAN[0].camera);
      expect((engine.posts[2].body.images as string[]).length).toBe(1); // the master picture
      expect(String(engine.posts[2].body.prompt)).toContain(SHOT_PLAN[1].camera);
      expect(engine.posts[1].body).toMatchObject({ aspect: "9:16", seconds: 2 });
      expect(steps[0]).toBe("Making the master shot…");
      const f = fileOf(user, out);
      expect(Number(probe(f, "format=duration"))).toBeCloseTo(6, 0);
      expect(probe(f, "stream=width,height", ["-select_streams", "v:0"])).toBe("1080,1920");
      expect(smartShotCredits({ shots: 3, secondsPerShot: 2 })).toBe(3 * CREDIT_COST.aiImage + 6 * CREDIT_COST.ownSecond);
      expect(smartShotCredits({ shots: 3, secondsPerShot: 2, imageId: "x" })).toBe(2 * CREDIT_COST.aiImage + 6 * CREDIT_COST.ownSecond);
    });
  });

  it("makes a beat-cut music video over the song, and edits a clip keeping its sound", { timeout: 180_000 }, async () => {
    const m = media();
    const engine = fakeEngine(m);
    vi.stubGlobal("fetch", engine.fetchFn);
    process.env.VIDEO_ENGINE_URL = "https://gpu.example";
    process.env.VIDEO_ENGINE_TOKEN = "t";
    const { asUser } = await import("@/lib/db");
    const { storeFile } = await import("@/lib/media");
    const { musicVideo, songCuts, musicVideoCredits, editVideo, videoEditCredits } = await import("@/lib/video-tools");
    const { CREDIT_COST } = await import("@/lib/plans");
    const user = "usr_vt2";
    await asUser(user, async () => {
      const song = await storeFile(user, { name: "night drive.wav", type: "audio/wav", bytes: m.song });
      const q = await songCuts(song.id);
      expect(q.bpm).toBe(120);
      expect(q.cuts[0]).toBe(0);
      expect(q.cuts.at(-1)).toBeCloseTo(12, 1);
      const shots = q.cuts.length - 1;
      expect(musicVideoCredits({ motion: "pictures" }, q.cuts)).toBe(shots * CREDIT_COST.aiImage);
      expect(musicVideoCredits({ motion: "clips" }, q.cuts)).toBeGreaterThan(shots * CREDIT_COST.aiImage);

      const out = await musicVideo(user, { audioId: song.id, idea: "Neon city at night", aspect: "16:9", motion: "pictures" }, { hear: async () => [] });
      expect(engine.posts.filter((p) => p.path === "/v1/images")).toHaveLength(shots);
      const f = fileOf(user, out);
      expect(out.name).toBe("music-video-night-drive.mp4");
      expect(Number(probe(f, "format=duration"))).toBeCloseTo(12, 0);
      expect(probe(f, "stream=codec_type").split("\n")).toEqual(["video", "audio"]);
      expect(probe(f, "stream=width,height", ["-select_streams", "v:0"])).toBe("1920,1080");

      const talk = await storeFile(user, { name: "talk.mp4", type: "video/mp4", bytes: m.talk });
      await expect(editVideo(user, { task: "motion", videoId: talk.id, prompt: "dance" })).rejects.toThrow(/picture/);
      const edited = await editVideo(user, { task: "inpaint", videoId: talk.id, prompt: "an empty street", box: [0.1, 0.1, 0.3, 0.3] });
      expect(engine.posts.at(-1)).toMatchObject({ path: "/v1/video-edits", body: { task: "inpaint", aspect: "16:9", box: [0.1, 0.1, 0.3, 0.3] } });
      const e = fileOf(user, edited);
      expect(probe(e, "stream=codec_type").split("\n")).toEqual(["video", "audio"]); // the clip's own sound is kept
      expect(probe(e, "stream=width,height", ["-select_streams", "v:0"])).toBe("1920,1080");
      expect(videoEditCredits(3.2)).toBe(4 * CREDIT_COST.editSecond);
    });
  });
});
