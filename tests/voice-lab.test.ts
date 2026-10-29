import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-voice-lab-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN"]) delete process.env[k];
vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));

const ff = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
const probe = (f: string, what: string, extra: string[] = []) => execFileSync("ffprobe", ["-v", "error", ...extra, "-show_entries", what, "-of", "csv=p=0", f]).toString().trim();
const tone = (secs: number, freq = 400, sr = 24000) => {
  const f = path.join(dir, `tone-${secs}-${freq}.wav`);
  ff("-f", "lavfi", "-i", `sine=f=${freq}:d=${secs}`, "-ar", String(sr), f);
  return readFileSync(f);
};
const fileOf = (user: string, m: { storagePath: string }) => path.join(dir, "uploads", user, m.storagePath.split("/")[1]);

/** Stand-in engine for speech, isolation and voice design. Every speech request returns `line`. */
function fakeEngine(line: Buffer) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  let n = 0;
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const p = new URL(String(url)).pathname;
    const post = p.match(/^\/v1\/(speech|voice-design|lipsync)$/);
    if (post && init?.method === "POST") {
      calls.push({ path: p, body: JSON.parse(String(init.body)) });
      return Response.json({ id: `j${++n}`, status: "queued" });
    }
    const st = p.match(/^\/v1\/(speech|voice-design|lipsync)\/(j\d+)(\/file)?$/);
    if (st && !st[3]) return Response.json({ status: "succeeded", progress: 1 });
    if (st) {
      const req = calls[Number(st[2].slice(1)) - 1].body;
      // The isolator gives back the recording it was sent.
      return new Response(new Uint8Array(req.mode === "isolate" ? Buffer.from(String(req.source), "base64") : line));
    }
    return new Response("{}", { status: 404 });
  });
  return { calls, fetchFn };
}
function useEngine(line: Buffer) {
  const e = fakeEngine(line);
  vi.stubGlobal("fetch", e.fetchFn);
  process.env.VIDEO_ENGINE_URL = "https://gpu.example";
  process.env.VIDEO_ENGINE_TOKEN = "engine-token";
  return e;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.VIDEO_ENGINE_URL;
  delete process.env.VIDEO_ENGINE_TOKEN;
});

describe("speech text", () => {
  it("reads emotion tags and writes captions", async () => {
    const { parseScript, stripTags, toSrt, toVtt, toTxt, captionLines } = await import("@/lib/speech-text");
    const parts = parseScript("Hello. [whispers] Don't turn around. [pause] [EXCITED] It's here! [unknown tag] Run!");
    expect(parts.map((p) => p.text)).toEqual(["Hello.", "Don't turn around.", "It's here!", "Run!"]);
    expect(parts[1]).toMatchObject({ exaggeration: 0.3, gain: 0.5, pause: 0 });
    expect(parts[2]).toMatchObject({ exaggeration: 1, pause: 0.6 });
    expect(parts[3].exaggeration).toBe(1); // an unknown tag changes nothing and isn't read out
    expect(stripTags("[sad] Goodbye. [long pause] Forever.")).toBe("Goodbye. Forever.");

    const lines = [{ start: 0, end: 2.5, text: " Hello world. " }, { start: 3725.04, end: null, text: "Last line" }];
    expect(toSrt(lines)).toBe("1\n00:00:00,000 --> 00:00:02,500\nHello world.\n\n2\n01:02:05,040 --> 01:02:08,040\nLast line\n");
    expect(toVtt(lines).startsWith("WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHello world.")).toBe(true);
    expect(toTxt(lines, true)).toBe("[00:00:00] Hello world.\n[01:02:05] Last line");
    const caps = captionLines([{ start: 0, end: 4, text: "one two three four five six seven eight nine ten eleven twelve" }], 20);
    expect(caps.length).toBeGreaterThan(2);
    expect(caps.every((c) => c.text.length <= 20)).toBe(true);
    expect(caps.at(-1)!.end).toBeCloseTo(4, 5);
  });

  it("matches the Voice Library to the free voices", async () => {
    const { STOCK_VOICES, VOICE_USES, DESIGN_PRESETS } = await import("@/lib/voice-catalog");
    const { KOKORO_VOICES } = await import("@/lib/free-voice");
    expect(STOCK_VOICES.map((v) => v.id).sort()).toEqual(KOKORO_VOICES.map((v) => v.id).sort());
    for (const v of [...STOCK_VOICES, ...DESIGN_PRESETS]) expect(v.uses.every((u) => (VOICE_USES as readonly string[]).includes(u))).toBe(true);
  });
});

describe("Voice Lab", () => {
  it("acts emotion tags on the engine, designs a voice, and isolates a voice", { timeout: 60_000 }, async () => {
    const { asUser, db } = await import("@/lib/db");
    const { storeFile } = await import("@/lib/media");
    const { labSpeech, designVoice, isolateVoice, voiceCredits } = await import("@/lib/voice-lab");
    const { addDesignedVoice, listVoices } = await import("@/lib/voices");
    const { CREDIT_COST } = await import("@/lib/plans");
    const user = "usr_lab1";
    const e = useEngine(tone(1.2));
    await asUser(user, async () => {
      const m = await labSpeech(user, { text: "Hi. [whispers] A secret. [pause] [angry] Now!", voice: { kind: "engine", language: "en" } });
      const speech = e.calls.filter((c) => c.path === "/v1/speech");
      expect(speech.map((c) => c.body.text)).toEqual(["Hi.", "A secret.", "Now!"]);
      expect(speech.map((c) => c.body.exaggeration)).toEqual([0.5, 0.3, 1.2]);
      expect(speech[2].body.cfg).toBe(0.3);
      // Three 1.2 s lines, short gaps and a 0.6 s pause.
      expect(Number(probe(fileOf(user, m), "format=duration"))).toBeGreaterThan(4);
      expect(voiceCredits(1500, { kind: "engine", language: "en" })).toBe(2 * CREDIT_COST.speech);
      expect(voiceCredits(10, { kind: "free", id: "af_heart" })).toBe(CREDIT_COST.voiceover);

      await expect(designVoice(user, { description: "deep" })).rejects.toThrow(/Describe the voice/);
      const sample = await designVoice(user, { description: "A warm older man with a slight Southern drawl." });
      expect(e.calls.at(-1)).toMatchObject({ path: "/v1/voice-design", body: { description: "A warm older man with a slight Southern drawl." } });
      expect(probe(fileOf(user, sample), "stream=sample_rate,channels")).toBe("24000,1");
      const v = await addDesignedVoice({ name: "Uncle Ray", mediaId: sample.id, description: "A warm older man with a slight Southern drawl." });
      expect((await listVoices())[0]).toMatchObject({ id: v.id, designed: expect.stringContaining("Southern") });
      expect((await listVoices())[0].consent).toBeUndefined();

      const vid = path.join(dir, "clip.mp4");
      ff("-f", "lavfi", "-i", "testsrc=s=160x284:r=24:d=3", "-f", "lavfi", "-i", "sine=f=300:d=3", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", vid);
      const clip = await storeFile(user, { name: "clip.mp4", type: "video/mp4", bytes: readFileSync(vid) });
      const iso = await isolateVoice(user, { mediaId: clip.id, stem: "vocals" });
      expect(iso.name).toBe("voice-only-clip-mp4.mp4");
      expect(probe(fileOf(user, iso), "stream=codec_type").split("\n")).toEqual(["video", "audio"]);
      expect(e.calls.at(-1)!.body).toMatchObject({ mode: "isolate", stem: "vocals" });
      // A WAV upload too (its working copy mustn't share the converted file's name).
      const wavRec = await storeFile(user, { name: "take.wav", type: "audio/wav", bytes: tone(2) });
      expect((await isolateVoice(user, { mediaId: wavRec.id, stem: "background" })).name).toBe("no-voice-take-wav.mp3");
      const { changeVoice } = await import("@/lib/voice-studio");
      expect((await changeVoice(user, { mediaId: wavRec.id, voiceId: v.id })).name).toBe("voice-changed-take-wav.mp3");
      expect(await db().get("media", iso.id)).toBeTruthy();
    });
  });

  it("transcribes with timings and keeps the transcript", async () => {
    const { asUser } = await import("@/lib/db");
    const { storeFile } = await import("@/lib/media");
    const { transcribeMedia, listTranscripts, deleteTranscript } = await import("@/lib/voice-lab");
    const user = "usr_lab2";
    await asUser(user, async () => {
      const rec = await storeFile(user, { name: "talk.wav", type: "audio/wav", bytes: tone(3) });
      const hear = async () => [{ start: 0.2, end: 1.4, text: " Hello there. " }, { start: 1.6, end: null, text: "  " }, { start: 1.8, end: 2.9, text: "Bye." }];
      const t = await transcribeMedia({ mediaId: rec.id }, { hear });
      expect(t.lines.map((l) => l.text)).toEqual(["Hello there.", "Bye."]);
      expect(t.seconds).toBeCloseTo(3, 0);
      expect((await listTranscripts())[0].id).toBe(t.id);
      await expect(transcribeMedia({ mediaId: rec.id }, { hear: async () => [] })).rejects.toThrow(/No speech/);
      await deleteTranscript(t.id);
      expect(await listTranscripts()).toEqual([]);
    });
  });

  it("renders an Audio Studio project to one MP3 with chapter markers", { timeout: 60_000 }, async () => {
    const { asUser } = await import("@/lib/db");
    const { saveAudioProject, renderAudioProject, audioProjectCredits, listAudioProjects } = await import("@/lib/voice-lab");
    const { CREDIT_COST } = await import("@/lib/plans");
    const user = "usr_lab3";
    await asUser(user, async () => {
      await expect(saveAudioProject({ title: "", chapters: [] })).rejects.toThrow(/Name the project/);
      await expect(saveAudioProject({ title: "X", chapters: [{ id: "", title: "", blocks: [{ id: "", text: "Hi", voice: { kind: "free", id: "nope" } }] }] })).rejects.toThrow(/Voice Library/);
      const free = { kind: "free" as const, id: "bm_fable" };
      const p = await saveAudioProject({
        title: "The Long Summer",
        chapters: [
          { id: "", title: "Arrival", blocks: [{ id: "", text: "It was hot.", voice: free }, { id: "", text: "   ", voice: free }, { id: "", text: "Very hot.", voice: free }] },
          { id: "", title: "", blocks: [{ id: "", text: "Then it rained.", voice: { kind: "engine", language: "es" } }] },
        ],
      });
      expect(p.chapters.map((c) => [c.title, c.blocks.length])).toEqual([["Arrival", 2], ["Chapter 2", 1]]);
      expect(audioProjectCredits(p)).toBe(2 * CREDIT_COST.voiceover + CREDIT_COST.speech);
      const said: string[] = [];
      const voice = async (text: string) => {
        said.push(text);
        return tone(2, 300, 48000);
      };
      const out = await renderAudioProject(user, p.id, { voice });
      expect(said).toEqual(["It was hot.", "Very hot.", "Then it rained."]);
      const f = fileOf(user, out);
      const chapters = probe(f, "chapter=start_time,end_time:chapter_tags=title", ["-show_chapters"]).split("\n");
      expect(chapters).toHaveLength(2);
      expect(chapters[0]).toBe("0.000000,6.500000,Arrival"); // two 2 s lines, their gaps, and the pause before the next chapter
      expect(chapters[1]).toMatch(/,Chapter 2$/);
      expect(Number(probe(f, "format=duration"))).toBeGreaterThan(8);
      expect((await listAudioProjects())[0].renderId).toBe(out.id);
    });
  });

  it("puts a voice on a video: ducked, captioned, and looped to the end of the voice", { timeout: 120_000 }, async () => {
    const { asUser } = await import("@/lib/db");
    const { storeFile } = await import("@/lib/media");
    const { voiceToVideo, voiceToVideoCredits } = await import("@/lib/voice-lab");
    const { CREDIT_COST } = await import("@/lib/plans");
    const user = "usr_lab4";
    await asUser(user, async () => {
      const vid = path.join(dir, "short.mp4");
      ff("-f", "lavfi", "-i", "testsrc=s=360x640:r=30:d=2", "-f", "lavfi", "-i", "sine=f=200:d=2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", vid);
      const video = await storeFile(user, { name: "short.mp4", type: "video/mp4", bytes: readFileSync(vid) });
      const o = { videoId: video.id, voice: { text: "[excited] This is it!", choice: { kind: "free" as const, id: "af_bella" } }, mix: "duck" as const, captions: true, lipsync: false };
      const heard: string[] = [];
      const out = await voiceToVideo(user, o, {
        speak: async () => tone(4, 500, 48000),
        hear: async (f) => {
          heard.push(f);
          return [{ start: 0.1, end: 3.8, text: "This is it, the moment everybody has been waiting for." }];
        },
      });
      const f = fileOf(user, out);
      expect(heard).toHaveLength(1);
      expect(probe(f, "stream=codec_type").split("\n")).toEqual(["video", "audio"]);
      expect(probe(f, "stream=width,height", ["-select_streams", "v:0"])).toBe("360,640");
      // The 2 s picture loops to the end of the 4 s voice.
      expect(Number(probe(f, "format=duration"))).toBeGreaterThan(4.2);
      // A caption is burned in: the bottom of a frame differs from the source's.
      const frame = (src: string) => execFileSync("ffmpeg", ["-v", "error", "-ss", "1", "-i", src, "-vf", "crop=360:120:0:500,scale=36:12", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
      const a = frame(vid);
      const b = frame(f);
      expect(a.reduce((n, x, i) => n + Math.abs(x - b[i]), 0) / a.length).toBeGreaterThan(4);
      expect(voiceToVideoCredits(o, 4)).toBe(CREDIT_COST.voiceover);
      expect(voiceToVideoCredits({ ...o, lipsync: true }, 4)).toBe(CREDIT_COST.voiceover + 4 * CREDIT_COST.lipsyncSecond);

      // A recording on a silent video, replacing the sound.
      const silent = path.join(dir, "silent.mp4");
      ff("-f", "lavfi", "-i", "testsrc=s=320x180:r=24:d=3", "-pix_fmt", "yuv420p", silent);
      const sv = await storeFile(user, { name: "silent.mp4", type: "video/mp4", bytes: readFileSync(silent) });
      writeFileSync(path.join(dir, "rec.wav"), tone(1.5));
      const rec = await storeFile(user, { name: "rec.wav", type: "audio/wav", bytes: tone(1.5) });
      const out2 = await voiceToVideo(user, { videoId: sv.id, voice: { mediaId: rec.id }, mix: "duck", captions: false, lipsync: false });
      expect(Number(probe(fileOf(user, out2), "format=duration"))).toBeCloseTo(3, 0);
      expect(probe(fileOf(user, out2), "stream=codec_type").split("\n")).toEqual(["video", "audio"]);
    });
  });

  it("places a voice recorded over the video where it was spoken, cleaned up, with captions at the same moment", { timeout: 120_000 }, async () => {
    const { asUser } = await import("@/lib/db");
    const { storeFile } = await import("@/lib/media");
    const { voiceToVideo } = await import("@/lib/voice-lab");
    const user = "usr_lab5";
    await asUser(user, async () => {
      const vid = path.join(dir, "four.mp4");
      ff("-f", "lavfi", "-i", "testsrc=s=320x568:r=30:d=4", "-f", "lavfi", "-i", "sine=f=200:d=4", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", vid);
      const video = await storeFile(user, { name: "four.mp4", type: "video/mp4", bytes: readFileSync(vid) });
      const take = await storeFile(user, { name: "take.wav", type: "audio/wav", bytes: tone(2, 600, 48000) });
      const heardAt: number[] = [];
      const out = await voiceToVideo(user, { videoId: video.id, voice: { mediaId: take.id }, mix: "replace", captions: true, lipsync: false, offset: 1.5, cleanup: true }, {
        hear: async (f) => {
          // The track handed to captions already starts with the 1.5 s of silence.
          heardAt.push(Number(probe(f, "format=duration")));
          return [{ start: 1.5, end: 3.4, text: "Right here, right now." }];
        },
      });
      expect(heardAt[0]).toBeCloseTo(3.5, 1);
      const f = fileOf(user, out);
      expect(Number(probe(f, "format=duration"))).toBeCloseTo(4, 0);
      const mean = (from: number, len: number) => {
        let txt = "";
        try {
          txt = execFileSync("sh", ["-c", `ffmpeg -hide_banner -ss ${from} -t ${len} -i '${f}' -vn -af volumedetect -f null - 2>&1`]).toString();
        } catch (e) {
          txt = String((e as { stdout?: Buffer }).stdout ?? "");
        }
        return Number(txt.match(/mean_volume: (-?[\d.]+) dB/)?.[1] ?? -99);
      };
      // Silence before the offset, the voice after it.
      expect(mean(1.6, 1.6) - mean(0.1, 1.1)).toBeGreaterThan(30);
      // However loud the take, the finished video never reaches 0 dBFS.
      const peak = Number(execFileSync("sh", ["-c", `ffmpeg -hide_banner -i '${f}' -vn -af volumedetect -f null - 2>&1 || true`]).toString().match(/max_volume: (-?[\d.]+) dB/)?.[1] ?? 0);
      expect(peak).toBeLessThan(-0.5);
      // A caption at 2.5 s, none at 0.5 s (the bottom of the frame changes only once the voice starts).
      const strip = (t: number) => execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", f, "-vf", "crop=320:110:0:440,scale=32:11", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
      const src = (t: number) => execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", vid, "-vf", "crop=320:110:0:440,scale=32:11", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
      const diff = (a: Buffer, b: Buffer) => a.reduce((n, x, i) => n + Math.abs(x - b[i]), 0) / a.length;
      const before = diff(strip(0.5), src(0.5));
      const during = diff(strip(2.5), src(2.5));
      expect(during).toBeGreaterThan(before * 3 + 1);
    });
  });
  it("swaps the video's AI voice for a recording and keeps the music under it", { timeout: 120_000 }, async () => {
    const { asUser } = await import("@/lib/db");
    const { storeFile } = await import("@/lib/media");
    const { voiceToVideo, voiceToVideoCredits } = await import("@/lib/voice-lab");
    const { CREDIT_COST } = await import("@/lib/plans");
    const user = "usr_lab_swap";
    await asUser(user, async () => {
      // The video's sound: a 200 Hz "AI voice". Its background (what the isolator returns): a 1,000 Hz "music" bed.
      const vid = path.join(dir, "voiced.mp4");
      ff("-f", "lavfi", "-i", "testsrc=s=320x568:r=30:d=4", "-f", "lavfi", "-i", "sine=f=200:d=4", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", vid);
      const video = await storeFile(user, { name: "voiced.mp4", type: "video/mp4", bytes: readFileSync(vid) });
      const take = await storeFile(user, { name: "take.wav", type: "audio/wav", bytes: tone(3, 600, 48000) });
      const asked: string[] = [];
      const o = { videoId: video.id, voice: { mediaId: take.id }, mix: "swap" as const, captions: false, lipsync: false, offset: 0.5 };
      const out = await voiceToVideo(user, o, {
        isolate: async (r) => {
          asked.push(r.stem);
          return tone(4, 1000, 44100);
        },
      });
      expect(asked).toEqual(["background"]);
      const f = fileOf(user, out);
      expect(Number(probe(f, "format=duration"))).toBeCloseTo(4, 0);
      const band = (hz: number) => {
        let txt = "";
        try {
          txt = execFileSync("sh", ["-c", `ffmpeg -hide_banner -ss 1 -t 2 -i '${f}' -vn -af bandpass=f=${hz}:width_type=q:w=8,volumedetect -f null - 2>&1`]).toString();
        } catch (e) {
          txt = String((e as { stdout?: Buffer }).stdout ?? "");
        }
        return Number(txt.match(/mean_volume: (-?[\d.]+) dB/)?.[1] ?? -99);
      };
      // The new voice and the music are there; the old voice is gone.
      expect(band(600)).toBeGreaterThan(-40);
      expect(band(1000)).toBeGreaterThan(-40);
      expect(band(600) - band(200)).toBeGreaterThan(20);

      // Separation is charged like the voice isolator: per started minute of video.
      expect(voiceToVideoCredits(o, 3, 4)).toBe(CREDIT_COST.isolateMinute);
      expect(voiceToVideoCredits(o, 3, 125)).toBe(3 * CREDIT_COST.isolateMinute);
      expect(voiceToVideoCredits({ ...o, mix: "replace" }, 3, 125)).toBe(0);

      // A silent video has no old voice to take out: the isolator isn't asked.
      const silent = path.join(dir, "silent-swap.mp4");
      ff("-f", "lavfi", "-i", "testsrc=s=320x180:r=24:d=2", "-pix_fmt", "yuv420p", silent);
      const sv = await storeFile(user, { name: "silent-swap.mp4", type: "video/mp4", bytes: readFileSync(silent) });
      await voiceToVideo(user, { ...o, videoId: sv.id }, { isolate: async () => { throw new Error("not expected"); } });

      // When separation fails, the job says so plainly instead of leaving two voices.
      await expect(voiceToVideo(user, o, { isolate: async () => { throw new Error("engine asleep"); } })).rejects.toThrow(/Couldn't take the old voice out right now/);
    });
  });
});
