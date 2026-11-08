import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { SECTIONS, sectionFor } from "@/lib/nav";

// Every page that used to be its own sidebar tab is still reachable: from a section's hub page and from the
// sidebar inside that section. Fewer tabs, same functions.
const FORMER_TABS = ["/", "/trends", "/platforms", "/niche", "/stories", "/studio", "/writers", "/movies", "/film-engine", "/movie-maker",
  "/director", "/series", "/images", "/create", "/story-video", "/voice-lab", "/voice-lab?tab=record", "/video-tools", "/library", "/flows",
  "/explain", "/calendar", "/media", "/engage", "/logs", "/plans", "/settings", "/developers", "/admin"];

describe("navigation sections", () => {
  const all = SECTIONS.flatMap((s) => [s.href, ...s.tools.map((t) => t.href)]);
  it("keeps the sidebar to a handful of sections", () => {
    expect(SECTIONS.filter((s) => !s.admin).length).toBeLessThanOrEqual(5);
  });
  it("still reaches every former tab", () => {
    for (const href of FORMER_TABS) expect(all, href).toContain(href);
  });
  it("has a page for every section hub", () => {
    for (const s of SECTIONS) {
      const dir = s.href === "/" ? "src/app" : `src/app${s.href}`;
      expect(existsSync(`${dir}/page.tsx`), s.href).toBe(true);
    }
  });
  it("puts each tool page in its section", () => {
    expect(sectionFor("/movie-maker").key).toBe("make");
    expect(sectionFor("/voice-lab", "?tab=record").key).toBe("make");
    expect(sectionFor("/calendar").key).toBe("grow");
    expect(sectionFor("/media").key).toBe("files");
    expect(sectionFor("/settings").key).toBe("account");
    expect(sectionFor("/admin").key).toBe("admin");
    expect(sectionFor("/").key).toBe("home");
  });
});
