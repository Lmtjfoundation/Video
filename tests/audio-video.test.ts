import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { audioCuts, lengthForSeconds, MAX_AUDIO_SECONDS } from "@/lib/audio-scenes";
import type { MediaItem, Post } from "@/lib/types";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-audio-video-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "ELEVENLABS_API_KEY", "PIXABAY_API_KEY", "PEXELS_API_KEY"]) delete process.env[k];
process.env.RENDER_PRESET = "ultrafast";
process.env.FREE_VOICE = "off";

// The transcriber downloads a 150 MB model and Claude is a paid API: both are simulated; everything else is real.
vi.mock("@/lib/transcribe", () => ({
  transcribe: async () => [
    { start: 0.4, end: 2.6, text: " Every marriage has a settlement." },
    { start: 2.6, end: 5.2, text: " Most people just never see the bill." },
  ],
}));
vi.mock("@/lib/llm", async (orig) => ({
  ...(await orig<typeof import("@/lib/llm")>()),
  claudeJson: async () => ({
    titles: ["The bill always comes"],
    caption: "Every marriage has a settlement.",
    hashtags: ["story"],
    cta: "Follow for part two",
    thumbnail: { text: "The bill" },
    scenes: [{ visual: "wedding rings on a table", onScreen: "12 years", motion: "slow push in" }, { visual: "unpaid bills at night", onScreen: "", motion: "quick cut" }],
  }),
}));

const covers = (cuts: { start: number; end: number }[], total: number) => {
  expect(cuts[0].start).toBe(0);
  expect(cuts[cuts.length - 1].end).toBeCloseTo(total, 3);
  for (let i = 1; i < cuts.length; i++) expect(cuts[i].start).toBe(cuts[i - 1].end);
  for (const c of cuts) expect(c.end - c.start).toBeGreaterThanOrEqual(0.5);
};

describe("audio cuts follow the recording", () => {
  it("covers the whole recording with no gaps, on video frames, and keeps every word in order", () => {
    const lines = [
      { start: 1.2, end: 2.0, text: " Houston." },
      { start: 2.0, end: 3.1, text: " Twelve years." },
      { start: 3.1, end: 16.9, text: " He fixed air conditioners in the Texas heat sixty hours a week so the house would always be cool when he came home" },
      { start: 17.4, end: null, text: " He came home tired." },
    ];
    const cuts = audioCuts(lines, 20);
    covers(cuts, 20);
    for (const c of cuts.slice(0, -1)) expect(Math.abs(c.end * 30 - Math.round(c.end * 30))).toBeLessThan(0.01);
    expect(cuts.map((c) => c.text).join(" ").split(/\s+/)).toEqual(lines.map((l) => l.text.trim()).join(" ").split(/\s+/));
    // The 13.8-second line is split; the two short opening lines share one scene.
    expect(cuts[0].text).toBe("Houston. Twelve years.");
    // No scene runs past 1.6× the target, plus at most a short pause it absorbed.
    expect(Math.max(...cuts.map((c) => c.end - c.start))).toBeLessThanOrEqual(4.5 * 1.6 + 1.5);
  });

  it("gives a long intro without words its own scenes and handles music with no words at all", () => {
    const cuts = audioCuts([{ start: 20, end: 24, text: "Finally the words." }], 30);
    covers(cuts, 30);
    expect(cuts.filter((c) => c.text === "").length).toBeGreaterThanOrEqual(3);
    expect(cuts.find((c) => c.text)!.start).toBe(20);

    const music = audioCuts([], 27);
    covers(music, 27);
    expect(music.every((c) => c.text === "")).toBe(true);
    expect(music).toHaveLength(6);
  });

  it("uses fewer, longer scenes for long recordings", () => {
    const lines = Array.from({ length: 300 }, (_, i) => ({ start: i * 2, end: i * 2 + 2, text: `line ${i}` }));
    const cuts = audioCuts(lines, 600);
    covers(cuts, 600);
    expect(cuts.length).toBeLessThanOrEqual(80);
  });

  it("picks the video length from the recording", () => {
    expect(lengthForSeconds(30, false)).toBe("s30");
    expect(lengthForSeconds(75, false)).toBe("s90");
    expect(lengthForSeconds(170, false)).toBe("m3");
    expect(lengthForSeconds(400, false)).toBe("m10");
    expect(lengthForSeconds(400, true)).toBe("long");
    expect(lengthForSeconds(MAX_AUDIO_SECONDS + 5, false)).toBeNull();
  });
});

describe.skipIf(!hasFfmpeg)("making a video from a recording", () => {
  it("plans a scene per cut and renders an MP4 whose sound is the recording", async () => {
    const { asUser, db } = await import("@/lib/db");
    const { storeFile } = await import("@/lib/media");
    const { readAudio, planAudioVideo } = await import("@/lib/audio-video");
    const { renderVideoPost } = await import("@/lib/render");
    const { getSettings, savePost } = await import("@/lib/repo");
    const userId = "usr_audio_test";
    const wav = path.join(dir, "voice.wav");
    // 6 seconds: a 440 Hz tone, then 880 Hz from 3 s, so the soundtrack can be checked at both ends.
    execFileSync("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "sine=f=440:d=3", "-f", "lavfi", "-i", "sine=f=880:d=3", "-filter_complex", "[0][1]concat=n=2:v=0:a=1", "-ar", "44100", wav], { stdio: "ignore" });

    await asUser(userId, async () => {
      const item = await storeFile(userId, { name: "voice.wav", type: "audio/wav", bytes: readFileSync(wav) });
      const audio = await readAudio(item.id);
      expect(audio.total).toBeCloseTo(6, 1);
      const cuts = audioCuts(audio.lines, audio.total);
      const post = await planAudioVideo({ mediaId: item.id, platform: "tiktok", visuals: "motion" }, { ...audio, cuts }, await getSettings());
      expect(post.video?.length).toBe("s30");
      expect(post.video?.audio?.mediaId).toBe(item.id);
      expect(post.video?.scenes.map((s) => s.narration)).toEqual(cuts.map((c) => c.text));
      expect(post.video?.scenes[0].visual).toBe("wedding rings on a table");
      expect(post.hook).toBe("The bill always comes");
      expect(post.mediaIds ?? []).not.toContain(item.id); // the recording is the sound, never a picture

      await savePost(post);
      await renderVideoPost(userId, post.id, 0);
      const done = await db().get<Post>("posts", post.id);
      expect(done?.render?.status, done?.render?.message).toBe("done");
      expect(done?.render?.message).toContain("your recording");
      const mp4 = (await db().get<MediaItem>("media", done!.render!.mediaId!))!;
      const { readFile } = await import("@/lib/media");
      const out = path.join(dir, "out.mp4");
      writeFileSync(out, await readFile(mp4));
      const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", out]).toString();
      const info = JSON.parse(probe) as { format: { duration: string }; streams: { codec_type: string }[] };
      expect(Number(info.format.duration)).toBeCloseTo(6, 0);
      expect(info.streams.map((s) => s.codec_type).sort()).toEqual(["audio", "video"]);
      // The recording plays unchanged: the low tone in the first half, the high tone in the second.
      const pitch = (at: number) => {
        const pcm = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(at), "-i", out, "-t", "0.5", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"]);
        const s = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
        let crossings = 0;
        for (let i = 1; i < s.length; i++) if ((s[i - 1] < 0) !== (s[i] < 0)) crossings++;
        return crossings / 2 / 0.5;
      };
      expect(pitch(1)).toBeGreaterThan(400);
      expect(pitch(1)).toBeLessThan(480);
      expect(pitch(4.5)).toBeGreaterThan(840);
      expect(pitch(4.5)).toBeLessThan(920);
    });
  }, 180_000);

  it("still plans the video without Claude: each scene's own words pick its footage", async () => {
    const { asUser } = await import("@/lib/db");
    const { storeFile } = await import("@/lib/media");
    const { readAudio, planAudioVideo } = await import("@/lib/audio-video");
    const { getSettings } = await import("@/lib/repo");
    await asUser("usr_audio_test", async () => {
      const item = await storeFile("usr_audio_test", { name: "voice.wav", type: "audio/wav", bytes: readFileSync(path.join(dir, "voice.wav")) });
      const audio = await readAudio(item.id);
      const cuts = audioCuts(audio.lines, audio.total);
      const post = await planAudioVideo({ mediaId: item.id, platform: "tiktok", plain: true }, { ...audio, cuts }, await getSettings());
      expect(post.hook).toBe("Every marriage has a settlement.");
      expect(post.video?.scenes.map((s) => s.visual)).toEqual(cuts.map((c) => c.text));
      expect(post.video?.audio?.cuts).toHaveLength(cuts.length);
    });
  });
});
