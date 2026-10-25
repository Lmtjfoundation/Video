import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-voice-studio-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN"]) delete process.env[k];
vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));

const ff = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
const probe = (f: string, what: string) => execFileSync("ffprobe", ["-v", "error", "-show_entries", what, "-of", "csv=p=0", f]).toString().trim();

/** A video with sound (4 s), a 25-second recording, and a 1.5-second "spoken line" WAV. */
function files() {
  const video = path.join(dir, "talk.mp4");
  ff("-f", "lavfi", "-i", "testsrc=s=160x284:r=24:d=4", "-f", "lavfi", "-i", "sine=f=300:d=4", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", video);
  const rec = path.join(dir, "rec.wav");
  ff("-f", "lavfi", "-i", "sine=f=220:d=25", "-ar", "24000", rec);
  const line = path.join(dir, "line.wav");
  ff("-f", "lavfi", "-i", "sine=f=500:d=1.5", "-ar", "24000", line);
  return { video: readFileSync(video), rec: readFileSync(rec), line: readFileSync(line) };
}

/** Stand-in engine: speech returns the 1.5 s line; clips and lip sync return the test video; writing translates. */
function fakeEngine(f: ReturnType<typeof files>) {
  const calls: { path: string; body?: Record<string, unknown> }[] = [];
  let n = 0;
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const p = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: p, body });
    if (p === "/v1/chat") {
      const lines = JSON.parse(String(body.user).split("\n\n")[1]) as string[];
      return Response.json({ text: JSON.stringify({ lines: lines.map((l) => `ES: ${l}`) }) });
    }
    const post = p.match(/^\/v1\/(speech|lipsync|videos)$/);
    if (post && init?.method === "POST") return Response.json({ id: `${post[1]}${++n}`, status: "queued" });
    const st = p.match(/^\/v1\/(speech|lipsync|videos)\/([a-z]+\d+)(\/file)?$/);
    if (st && !st[3]) return Response.json({ status: "succeeded", progress: 1 });
    if (st) return new Response(new Uint8Array(st[1] === "speech" ? f.line : f.video));
    return new Response(JSON.stringify({ detail: "not here" }), { status: 404 });
  });
  return { calls, fetchFn };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.VIDEO_ENGINE_URL;
  delete process.env.VIDEO_ENGINE_TOKEN;
});

describe("voice tools", () => {
  it("only makes a voice when the consent sentence is heard", async () => {
    const f = files();
    const { asUser, db } = await import("@/lib/db");
    const { storeFile } = await import("@/lib/media");
    const { CONSENT_SENTENCE, consentScore, createVoice, listVoices, deleteVoice } = await import("@/lib/voices");
    expect(consentScore(` ${CONSENT_SENTENCE} Hi, I'm Monica and this is how I sound.`)).toBe(1);
    expect(consentScore("I agree to Ghost Post making an AI voice from my recording")).toBe(1);
    expect(consentScore("Welcome back to the channel, today we're talking money")).toBeLessThan(0.3);
    const user = "usr_voice";
    await asUser(user, async () => {
      const rec = await storeFile(user, { name: "me.wav", type: "audio/wav", bytes: f.rec });
      await expect(createVoice(user, { name: "Me", mediaId: rec.id, consentBy: "Monica H", agreed: false }, async () => CONSENT_SENTENCE)).rejects.toThrow(/Confirm/);
      await expect(createVoice(user, { name: "Me", mediaId: rec.id, consentBy: "Monica H", agreed: true }, async () => "just some speech from a podcast")).rejects.toThrow(/consent sentence wasn't heard/);
      const v = await createVoice(user, { name: "Me", mediaId: rec.id, consentBy: "Monica H", agreed: true }, async () => `${CONSENT_SENTENCE} And now my normal voice.`);
      expect(v.consent.by).toBe("Monica H");
      const sample = await db().get<{ id: string; storagePath: string }>("media", v.sampleId);
      const p = path.join(dir, "uploads", user, sample!.storagePath.split("/")[1]);
      expect(Number(probe(p, "format=duration"))).toBeCloseTo(20, 0); // 20 s reference, skipping the sentence
      expect(probe(p, "stream=sample_rate,channels")).toBe("24000,1");
      expect((await listVoices()).map((x) => x.name)).toEqual(["Me"]);
      await deleteVoice(v.id);
      expect(await listVoices()).toEqual([]);
    });
  });

  it("speeds a dubbed line up to fit before the next one, never past 1.35×", async () => {
    const { placeLines, SR, chunks } = await import("@/lib/voice-studio");
    const sec = (s: number) => new Float32Array(Math.round(s * SR)).fill(0.5);
    const { track, speeds } = placeLines([{ start: 0, samples: sec(2) }, { start: 1.6, samples: sec(1) }, { start: 3, samples: sec(4) }], 5);
    expect(speeds).toEqual([1.25, 1, 1.35]);
    expect(track.length).toBe(5 * SR);
    expect(track[Math.round(1.5 * SR)]).toBeGreaterThan(0); // the first line, sped up, ends just before 1.6 s
    expect(track[Math.round(1.62 * SR)]).toBeGreaterThan(0);
    expect(chunks("One. Two! Three?", 8)).toEqual(["One.", "Two!", "Three?"]);
    expect(chunks("a ".repeat(400), 100).every((c) => c.length <= 100)).toBe(true);
  });

  it("dubs a video: hears the lines, translates them, speaks them in the speaker's voice at the same moments", async () => {
    const f = files();
    const engine = fakeEngine(f);
    vi.stubGlobal("fetch", engine.fetchFn);
    process.env.VIDEO_ENGINE_URL = "https://gpu.example";
    process.env.VIDEO_ENGINE_TOKEN = "engine-token";
    const { asUser } = await import("@/lib/db");
    const { storeFile } = await import("@/lib/media");
    const { dub, makeAvatar } = await import("@/lib/voice-studio");
    const user = "usr_dub";
    await asUser(user, async () => {
      const v = await storeFile(user, { name: "episode.mp4", type: "video/mp4", bytes: f.video });
      const hear = async () => [{ start: 0.2, end: 1.5, text: "Where were you last night?" }, { start: 2.2, end: 3.6, text: "Out." }];
      await expect(dub(user, { mediaId: v.id, language: "es", voice: "original", keepBackground: true, lipsync: false }, { hear })).rejects.toThrow(/written permission/);
      const out = await dub(user, { mediaId: v.id, language: "es", voice: "original", rightsConfirmed: true, keepBackground: true, lipsync: false }, { hear });
      expect(out.name).toBe("dub-es-episode-mp4.mp4");
      const speech = engine.calls.filter((c) => c.path === "/v1/speech" && c.body);
      expect(speech.map((c) => [c.body!.text, c.body!.language])).toEqual([["ES: Where were you last night?", "es"], ["ES: Out.", "es"]]);
      expect(typeof speech[0].body!.voice).toBe("string"); // the speaker's own voice, cut from the video
      const p = path.join(dir, "uploads", user, out.storagePath.split("/")[1]);
      expect(Number(probe(p, "format=duration"))).toBeCloseTo(4, 0);
      expect(probe(p, "stream=codec_type").split("\n")).toEqual(["video", "audio"]);

      const lipsynced = await dub(user, { mediaId: v.id, language: "fr", voice: "original", rightsConfirmed: true, keepBackground: false, lipsync: true }, { hear });
      expect(lipsynced.kind).toBe("video");
      expect(engine.calls.some((c) => c.path === "/v1/lipsync" && c.body)).toBe(true);

      // Avatar: the picture is filmed talking, then lip-synced to the words.
      const pic = await storeFile(user, { name: "tasha.png", type: "image/png", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64") });
      const before = engine.calls.length;
      const av = await makeAvatar(user, { pictureId: pic.id, aspect: "9:16", audio: { text: "Baby, I handle the money.", language: "en" } });
      expect(av.name).toBe("avatar-tasha-png.mp4");
      const used = engine.calls.slice(before).filter((c) => c.body).map((c) => c.path);
      expect(used).toEqual(["/v1/speech", "/v1/videos", "/v1/lipsync"]);
      expect(String(engine.calls.find((c) => c.path === "/v1/videos" && c.body)!.body!.prompt)).toContain("talks naturally");
    });
  });
});
