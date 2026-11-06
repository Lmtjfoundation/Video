import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("motion shots", () => {
  it("cuts a scene into 2–3 shots that add up, with an entry transition after the first scene", async () => {
    const { sceneShots, motionFilm, gradeFor } = await import("@/lib/motion-scenes");
    const scene = { narration: "The power went out across the whole city.", visual: "dark street, fog, flickering streetlight", motion: "", sfx: "" };
    const a = sceneShots(scene, "/a.png", 7, 0);
    expect(a.map((s) => s.move)).toEqual(["push_in", "punch", "dolly"]);
    expect(a.reduce((n, s) => n + s.dur, 0)).toBeCloseTo(7, 2);
    expect(a[0].effects).toEqual(expect.arrayContaining(["fog", "flicker"]));
    expect(a[1].effects).toContain("cut");
    const b = sceneShots(scene, "/b.png", 2.5, 1);
    expect(b).toHaveLength(1);
    expect(b[0].effects).toContain("flash_in");
    const film = motionFilm([...a, ...b], 1080, 1920, gradeFor("fiction"));
    expect(film).toMatchObject({ split: true, grade: "teal_orange", w: 1080, h: 1920 });
    expect(film.scenes.map((s) => s.group)).toEqual([0, 0, 0, 1]);
  });
});

describe("soundtrack mix", () => {
  it("maps music notes to moods", async () => {
    const { moodFor } = await import("@/lib/mix");
    expect(moodFor("dark tense drone")).toBe("tense");
    expect(moodFor("", "fiction")).toBe("tense");
    expect(moodFor("documentary underscore")).toBe("mystery");
    expect(moodFor("")).toBe("upbeat");
  });
  it("the graph runs in ffmpeg: voice over ducked music with whooshes at the cuts", async () => {
    const { soundtrackGraph, MASTER_CHAIN } = await import("@/lib/mix");
    expect(MASTER_CHAIN).toMatch(/alimiter/);
    const dir = mkdtempSync(path.join(tmpdir(), "gp-mix-"));
    const out = path.join(dir, "m.wav");
    const g = soundtrackGraph({ total: 6, cuts: [0, 2, 4], music: true, whoosh: true });
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=300:d=6", "-f", "lavfi", "-i", "sine=f=80:d=10", "-f", "lavfi", "-i", "anoisesrc=d=0.7", "-filter_complex", g, "-map", "[mix]", "-t", "6", out]);
    const d = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString());
    expect(d).toBeGreaterThan(5.9);
    expect(soundtrackGraph({ total: 6, cuts: [0], music: false, whoosh: false })).toMatch(/\[voice\]amix=inputs=1/);
  });
});
