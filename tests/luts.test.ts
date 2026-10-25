import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cubeFile, GRADES, gradePixel, type Grade } from "@/lib/luts";

describe("Ghost Post LUTs", () => {
  it("writes standard 33-point .cube files", () => {
    const text = cubeFile(GRADES[0]);
    const lines = text.trim().split("\n");
    expect(lines[0]).toBe('TITLE "Ghost Post - Teal & Orange"');
    expect(lines).toContain("LUT_3D_SIZE 33");
    const rows = lines.filter((l) => /^[\d.]+ [\d.]+ [\d.]+$/.test(l));
    expect(rows).toHaveLength(33 ** 3);
    expect(rows.every((r) => r.split(" ").every((v) => Number(v) >= 0 && Number(v) <= 1))).toBe(true);
    expect(new Set(GRADES.map((g) => g.id)).size).toBe(GRADES.length);
  });

  it("leaves colors alone with no settings, and does what each grade says", () => {
    const none: Grade = { id: "x", name: "x", blurb: "", group: "Mood" };
    for (const c of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.8]] as [number, number, number][]) gradePixel(none, c).forEach((v, i) => expect(v).toBeCloseTo(c[i], 6));
    const noir = GRADES.find((g) => g.id === "noir")!;
    const [r, g, b] = gradePixel(noir, [0.9, 0.3, 0.2]);
    expect(r).toBeCloseTo(g, 6);
    expect(g).toBeCloseTo(b, 6);
    const warm = gradePixel(GRADES.find((x) => x.id === "golden-hour")!, [0.5, 0.5, 0.5]);
    expect(warm[0]).toBeGreaterThan(warm[2]);
    const cool = gradePixel(GRADES.find((x) => x.id === "blockbuster-cool")!, [0.5, 0.5, 0.5]);
    expect(cool[2]).toBeGreaterThan(cool[0]);
    // Teal & orange: skin gets warmer, a blue sky gets more teal.
    const to = GRADES.find((x) => x.id === "teal-orange")!;
    const skin = gradePixel(to, [0.8, 0.55, 0.4]);
    expect(skin[0] - skin[2]).toBeGreaterThan(0.8 - 0.4);
    const sky = gradePixel(to, [0.3, 0.5, 0.8]);
    expect(sky[2] - sky[0]).toBeGreaterThan(0.8 - 0.3);
  });

  it("is read by ffmpeg as a real 3D LUT", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-lut-"));
    const lut = path.join(dir, "noir.cube");
    writeFileSync(lut, cubeFile(GRADES.find((g) => g.id === "noir")!));
    const out = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0xd04020:s=16x16", "-frames:v", "1", "-vf", `lut3d=file=${lut}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    const [r, g, b] = out.subarray(8 * 48 + 24, 8 * 48 + 27);
    expect(Math.abs(r - g)).toBeLessThanOrEqual(3); // black and white
    expect(Math.abs(g - b)).toBeLessThanOrEqual(3);
  });
});
