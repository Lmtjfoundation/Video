import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-story-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL"]) delete process.env[k];

// The writer is simulated: it records the brief and answers with a 3-scene storyboard.
const asked: { system: string; user: string }[] = [];
vi.mock("@/lib/llm", async (orig) => ({
  ...(await orig<typeof import("@/lib/llm")>()),
  claudeJson: async (o: { system: string; user: string }) => {
    asked.push(o);
    return {
      titles: ["El faro", "Otra"],
      hook: "Ella encontró una botella.",
      caption: "Una historia corta.",
      hashtags: ["historia", "#faro"],
      thumbnail: { text: "EL FARO", prompt: "a lighthouse at dusk" },
      scenes: [
        { time: "0:00–0:04", narration: "Había una vez un faro.", onScreen: "El faro", visual: "a lighthouse at dusk", cast: [] },
        { time: "0:04–0:09", narration: "Ella encontró una botella en la arena.", onScreen: "", visual: "a bottle in the sand", cast: [] },
        { time: "0:09–0:14", narration: "Y dentro, una carta suya.", onScreen: "Una carta", visual: "an old letter", cast: [] },
      ],
    };
  },
}));

afterEach(() => vi.unstubAllGlobals());

describe("Story to Video", () => {
  it("reads only public web pages, and turns HTML into the article's text", async () => {
    const { privateAddress, htmlToText, pageText } = await import("@/lib/story-video");
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.9", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) expect(privateAddress(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700::1111"]) expect(privateAddress(ip)).toBe(false);

    const page = htmlToText(`<html><head><title>Tom &amp; Jerry</title><style>p{}</style></head><body><nav>Home | About</nav><article><h1>The cat</h1><p>Tom chased Jerry around the kitchen &quot;all day&quot;.</p><script>alert(1)</script></article><footer>© 2026</footer></body></html>`);
    expect(page.title).toBe("Tom & Jerry");
    expect(page.text).toBe('The cat\nTom chased Jerry around the kitchen "all day".');

    const long = `<article>${"<p>Lighthouses guided ships along dangerous coasts for centuries.</p>".repeat(5)}</article>`;
    const fetches: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: URL) => {
      fetches.push(String(u));
      if (u.hostname === "redirect.example") return new Response(null, { status: 302, headers: { location: "http://inside.example/admin" } });
      return new Response(long, { headers: { "content-type": "text/html; charset=utf-8" } });
    }));
    const lookup = async (h: string) => (h === "inside.example" ? ["10.0.0.5"] : ["93.184.216.34"]);
    expect((await pageText("https://news.example/story", { lookup })).text).toContain("Lighthouses guided ships");
    await expect(pageText("http://127.0.0.1/", { lookup })).rejects.toThrow(/public website/);
    await expect(pageText("https://redirect.example/x", { lookup })).rejects.toThrow(/public website/); // checked again after the redirect
    await expect(pageText("file:///etc/passwd", { lookup })).rejects.toThrow(/http/);
    await expect(pageText("https://news.example:8443/", { lookup })).rejects.toThrow(/http/);
    expect(fetches).toEqual(["https://news.example/story", "https://redirect.example/x"]);
  });

  it("writes the brief in the chosen language and template, from a script or a recording", async () => {
    const { storyBrief, sourceText } = await import("@/lib/story-video");
    const b = storyBrief({ template: "bedtime", language: "es" }, { kind: "idea", text: "A shy lighthouse keeper", label: "idea" });
    expect(b).toContain("bedtime story");
    expect(b).toContain("children");
    expect(b).toContain("in Spanish");
    expect(b).toContain("A shy lighthouse keeper");
    const bi = storyBrief({ template: "bilingual-story", language: "en", secondLanguage: "fr" }, { kind: "script", text: "Hello.", label: "script" });
    expect(bi).toContain("in English, then the same words in French");
    expect(bi).toContain("word for word");
    await expect(sourceText({ kind: "idea", text: " " })).rejects.toThrow(/Describe/);
    await expect(sourceText({ kind: "script", text: "too short" })).rejects.toThrow(/Paste/);

    const { asUser } = await import("@/lib/db");
    const { storeFile } = await import("@/lib/media");
    const wav = path.join(dir, "talk.wav");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=300:d=2", wav]);
    await asUser("usr_story_src", async () => {
      const { readFileSync } = await import("node:fs");
      const rec = await storeFile("usr_story_src", { name: "podcast.wav", type: "audio/wav", bytes: readFileSync(wav) });
      const s = await sourceText({ kind: "media", mediaId: rec.id }, { hear: async () => [{ text: "Lighthouses once had keepers." }, { text: " They lived alone for months. " }] });
      expect(s.text).toBe("Lighthouses once had keepers. They lived alone for months.");
      expect(s.label).toBe("the recording “podcast.wav”");
    });
  });

  it("starts a storyboard with its narrator, prices the engine voice, and exports a valid story package", { timeout: 60_000 }, async () => {
    const { asUser } = await import("@/lib/db");
    const { getSettings, getPost } = await import("@/lib/repo");
    const { startStory, storyPackage, youtubeText, listStories } = await import("@/lib/story-video");
    const { renderCredits, videoCredits } = await import("@/lib/video-spec");
    const { CREDIT_COST } = await import("@/lib/plans");
    await asUser("usr_story", async () => {
      const input = { template: "general", source: { kind: "idea" as const, text: "A lighthouse keeper finds a letter" }, language: "es", narrator: { kind: "engine" as const, language: "es" }, characterIds: [], look: "Storybook watercolor illustration", platform: "youtube" as const, length: "s30" as const, instant: false };
      const { session, post } = await startStory(input, { kind: "idea", text: input.source.text, label: "idea" }, await getSettings());
      expect(asked.at(-1)!.user).toContain("in Spanish");
      const saved = (await getPost(post.id))!;
      expect(saved.video!.narrator).toEqual({ kind: "engine", language: "es" });
      expect((await listStories())[0]).toMatchObject({ id: session.id, postId: post.id, template: "general", language: "es" });
      // An engine narrator adds speech credits to the render (the free voice doesn't).
      const chars = saved.video!.scenes.reduce((n, s) => n + s.narration.length, 0);
      expect(renderCredits(saved.video!)).toBe(renderCredits({ ...saved.video!, narrator: undefined }) + CREDIT_COST.speech * Math.ceil(chars / 1000));
      expect(videoCredits("s30", "plan")).toBeGreaterThan(0);

      const yt = youtubeText(saved);
      expect(yt.startsWith("TITLE: El faro")).toBe(true);
      expect(yt).toContain("Chapters:\n0:00 El faro\n0:04 Ella encontró una botella en la arena\n0:09 Una carta");
      expect(yt).toContain("#historia #faro");

      const pkg = await storyPackage(session.id);
      expect(pkg.name).toBe("el-faro.zip");
      const f = path.join(dir, pkg.name);
      writeFileSync(f, pkg.bytes);
      expect(execFileSync("unzip", ["-t", f]).toString()).toContain("No errors detected");
      const list = execFileSync("unzip", ["-Z1", f]).toString().trim().split("\n").sort();
      expect(list).toEqual(["el-faro/README.txt", "el-faro/captions.srt", "el-faro/script.txt", "el-faro/storyboard.md", "el-faro/youtube-description.txt"]);
      const srt = execFileSync("unzip", ["-p", f, "el-faro/captions.srt"]).toString();
      expect(srt).toContain("00:00:04,000 --> 00:00:09,000\nElla encontró una botella en la arena.");
      await expect(storyPackage("nope")).rejects.toThrow(/wasn't found/);
    });
  });
});
