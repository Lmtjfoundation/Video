import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : []; });

describe("accessibility guards", () => {
  it("no text fainter than white at 50% (below 4.5:1 on the app's dark backgrounds)", () => {
    // Decorative icons (aria-hidden) are exempt: WCAG's text contrast rule is for text.
    const bad = files("src").flatMap((f) => readFileSync(f, "utf8").split("\n").filter((l) => /\btext-white\/(5|10|15|20|25|30|35|40|45)\b/.test(l) && !/aria-hidden/.test(l)).map((l) => `${f}: ${l.trim().slice(0, 120)}`));
    expect(bad).toEqual([]);
  });
  it("every page has a main landmark and signed-in pages a skip link", () => {
    const shell = readFileSync("src/components/shell.tsx", "utf8");
    expect(shell).toMatch(/<main id="main"/);
    expect(shell.match(/<main id="main"/g)?.length).toBe(2);
    expect(shell).toMatch(/Skip to content/);
  });
});
