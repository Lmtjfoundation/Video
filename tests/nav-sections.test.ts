import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { SECTIONS, activeTool, grouped, sectionFor } from "@/lib/nav";

// Every page that used to be its own sidebar tab is still reachable: from a section's hub page and from the
// sidebar inside that section. Fewer tabs, same functions.
const FORMER_TABS = ["/", "/trends", "/platforms", "/niche", "/stories", "/studio", "/writers", "/movies", "/film-engine", "/movie-maker",
  "/director", "/series", "/images", "/create", "/story-video", "/voice-lab", "/voice-lab?tab=record", "/video-tools", "/library", "/flows",
  "/explain", "/video-lab", "/video-tools?tab=music", "/voice-lab?tab=v2v", "/calendar", "/media", "/engage", "/logs", "/plans", "/settings", "/developers", "/admin"];

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
  it("opens with the most-used jobs, then the rest by goal", () => {
    const make = SECTIONS.find((s) => s.key === "make")!;
    const groups = grouped(make.tools);
    expect(groups.map((g) => g.group)).toEqual(["Start here", "Movies & series", "Sound & video tools"]);
    expect(groups[0].tools.map((t) => t.label)).toEqual(["Video Lab", "Pitch to Movie", "Music Video", "Voice & Lip Sync", "Talking Presenter", "Pictures", "Posts & Captions"]);
    expect(new Set(make.tools.map((t) => t.href)).size).toBe(make.tools.length); // no tool listed twice
  });
  it("highlights the exact tool, not both the shortcut and its page", () => {
    const make = SECTIONS.find((s) => s.key === "make")!.tools;
    expect(activeTool(make, "/voice-lab", "/voice-lab?tab=v2v")?.label).toBe("Voice & Lip Sync");
    expect(activeTool(make, "/voice-lab", "/voice-lab?tab=tts")?.label).toBe("Voice Lab");
    expect(activeTool(make, "/video-tools", "/video-tools?tab=music")?.label).toBe("Music Video");
    expect(activeTool(make, "/story-video")?.label).toBe("Pitch to Movie");
  });
});
