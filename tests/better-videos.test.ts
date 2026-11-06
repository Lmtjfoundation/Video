import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assCaptions, estimateWordTimes, groupWords, subtitlesFilter } from "@/lib/captions-ass";
import { hookProblems } from "@/lib/hook-check";

describe("word-by-word captions", () => {
  const words = estimateWordTimes("Nineteen years. Same hallway, same mop. Never missed a shift.", 0.05, 4.2);
  it("times every word in order inside the spoken span", () => {
    expect(words).toHaveLength(10);
    expect(words[0].start).toBeCloseTo(0.05);
    for (let i = 1; i < words.length; i++) expect(words[i].start).toBeGreaterThan(words[i - 1].start);
    expect(words[words.length - 1].end).toBeLessThanOrEqual(4.2);
  });
  it("groups 2–4 words, breaking at sentence ends", () => {
    const g = groupWords(words).map((x) => x.map((w) => w.word).join(" "));
    expect(g[0]).toBe("Nineteen years.");
    expect(g.every((x) => x.split(" ").length <= 4)).toBe(true);
    expect(g.at(-1)).toMatch(/shift\.$/);
  });
  it("highlights the spoken word, upper-cased, and strips ASS commands from the script", () => {
    const ass = assCaptions(estimateWordTimes("Pay {\\b1}or burn.", 0, 1.5), { W: 1080, H: 1920 });
    expect(ass).toMatch(/PlayResX: 1080/);
    expect(ass).toMatch(/Style: Cap,Poppins,95,/);
    expect(ass).not.toMatch(/\\b1/);
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue"));
    expect(events.length).toBe(3); // one per word, each with that word highlighted
    expect(events[1]).toMatch(/\\fscx115.*OR/);
  });
  it("film captions are quiet: one line per group, no pop", () => {
    const ass = assCaptions(words, { W: 1920, H: 1080, film: true });
    expect(ass).not.toMatch(/fscx115/);
    expect(ass.split("\n").filter((l) => l.startsWith("Dialogue")).length).toBe(groupWords(words).length);
  });
  it("burns in with ffmpeg and the app's font", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gp-ass-"));
    const file = path.join(dir, "c.ass");
    writeFileSync(file, assCaptions(words, { W: 360, H: 640 }));
    const out = path.join(dir, "o.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x223344:s=360x640:d=4.3:r=10", "-vf", subtitlesFilter(file, path.resolve("assets/fonts")), out]);
    const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString();
    expect(Number(probe)).toBeGreaterThan(4);
  });
});

describe("hooks", () => {
  it("flags long, filler and begging openings; passes a sharp one", () => {
    expect(hookProblems("Hey guys, welcome back to the channel, today we're talking about the strangest heist ever")).toHaveLength(2);
    expect(hookProblems("Did you know the Dresden thieves cut the power first?")[0]).toMatch(/filler/);
    expect(hookProblems("Smash that subscribe button")).not.toHaveLength(0);
    expect(hookProblems("They stole 21 jewels in under seven minutes.")).toEqual([]);
  });
});
