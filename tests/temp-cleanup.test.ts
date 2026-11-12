import { mkdirSync, mkdtempSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sweepTemp } from "@/lib/temp-cleanup";

describe("Disk safety", () => {
  it("tests run inside one temp folder that is deleted afterwards", () => {
    expect(path.basename(tmpdir())).toMatch(/^ghost-post-tests-/);
  });

  it("removes only the app's own temp folders, and only old ones", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sweep-"));
    const old = Date.now() / 1000 - 3 * 24 * 3600;
    const mk = (n: string, aged: boolean) => { const p = path.join(dir, n); mkdirSync(p); if (aged) utimesSync(p, old, old); return p; };
    const stale = [mk("ghost-post-render-AbC123", true), mk("gp-movie-xYz789", true), mk("film-final-q1w2e3", true)];
    const running = mk("ghost-post-story-Zz9Zz9", false);
    const other = mk("someone-elses-abc123", true);
    expect(await sweepTemp(undefined, dir)).toBe(3);
    stale.forEach((p) => expect(existsSync(p)).toBe(false));
    expect(existsSync(running)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });
});
