import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-library-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN"]) delete process.env[k];
vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));

/** Two seconds of a 48 kHz stereo tone, as the engine's audio side returns. */
function wav(seconds = 2, freq = 440) {
  const n = 48000 * seconds;
  const b = Buffer.alloc(44 + n * 4);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n * 4, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(48000, 24);
  b.writeUInt32LE(48000 * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * freq * i) / 48000) * 12000 * Math.min(1, i / 48000)); // fades in over a second
    b.writeInt16LE(v, 44 + i * 4);
    b.writeInt16LE(v, 46 + i * 4);
  }
  return b;
}

/** A stand-in for the engine: music and sound effects come back as WAVs; writing isn't available. */
function fakeEngine() {
  const requests: Record<string, unknown>[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const p = new URL(String(url)).pathname;
    if (p === "/v1/audio" && init?.method === "POST") {
      requests.push(JSON.parse(String(init.body)));
      return Response.json({ id: `aud${requests.length}`, status: "queued" });
    }
    if (/^\/v1\/audio\/aud\d+$/.test(p)) {
      const r = requests[Number(p.slice(-1)) - 1];
      return Response.json({ status: "succeeded", progress: 1, bpm: r.kind === "music" ? (r.bpm ?? 128) : null, key: r.kind === "music" ? "A minor" : null });
    }
    if (/^\/v1\/audio\/aud\d+\/file$/.test(p)) return new Response(new Uint8Array(wav()), { headers: { "content-type": "audio/wav" } });
    return new Response(JSON.stringify({ detail: "not here" }), { status: 404 });
  });
  return { requests, fetchFn };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.VIDEO_ENGINE_URL;
  delete process.env.VIDEO_ENGINE_TOKEN;
});

describe("Library and AI Studio", () => {
  it("makes music and sound effects on the engine, files them, and finds them by tags, tempo and likeness", async () => {
    const engine = fakeEngine();
    vi.stubGlobal("fetch", engine.fetchFn);
    process.env.VIDEO_ENGINE_URL = "https://gpu.example";
    process.env.VIDEO_ENGINE_TOKEN = "engine-token";
    const { asUser, db } = await import("@/lib/db");
    const { makeMusic, makeSfx } = await import("@/lib/sound-studio");
    const { searchLibrary, myAssets } = await import("@/lib/library");
    const user = "usr_lib";

    await asUser(user, async () => {
      const track = await makeMusic(user, { prompt: "Dark cinematic piano with strings, tense crime drama", seconds: 60, bpm: 92, moods: ["Tense"] });
      expect(engine.requests[0]).toMatchObject({ kind: "music", seconds: 60, bpm: 92, instrumental: true, lyrics: "" });
      expect(String(engine.requests[0].prompt)).toContain("Tense");
      expect(track).toMatchObject({ kind: "music", bpm: 92, key: "A minor", vocals: false, moods: ["Tense"], model: "ACE-Step 1.5" });
      expect(track.genres).toContain("Cinematic"); // filed from the prompt when no writer answers
      expect(track.instruments).toEqual(expect.arrayContaining(["Piano", "Strings"]));
      expect(track.seconds).toBeCloseTo(2, 1);
      expect(track.peaks.length).toBeGreaterThan(100);
      expect(Math.max(...track.peaks)).toBe(1);
      expect(track.peaks[0]).toBeLessThan(track.peaks[track.peaks.length - 1]); // the tone fades in
      const files = await Promise.all([db().get<{ id: string; type: string }>("media", track.mediaId), db().get<{ id: string; type: string }>("media", track.previewId)]);
      expect(files.map((f) => f?.type)).toEqual(["audio/wav", "audio/mpeg"]);

      const song = await makeMusic(user, { prompt: "Upbeat pop with acoustic guitar", lyrics: "[Chorus]\nWe made it home", seconds: 30 });
      expect(engine.requests[1]).toMatchObject({ instrumental: false, lyrics: "[Chorus]\nWe made it home" });
      expect(song.vocals).toBe(true);

      const sound = await makeSfx(user, { prompt: "Heavy wooden door slamming shut", seconds: 2, category: "Doors" });
      expect(engine.requests[2]).toMatchObject({ kind: "sfx", seconds: 2 });
      expect(sound).toMatchObject({ kind: "sfx", category: "Doors", model: "MOSS-SoundEffect v2" });

      expect((await myAssets()).map((a) => a.id)).toEqual([sound.id, song.id, track.id]);
      expect((await searchLibrary({ kind: "music" })).total).toBe(2);
      expect((await searchLibrary({ kind: "music", vocals: "instrumental" })).items.map((a) => a.id)).toEqual([track.id]);
      expect((await searchLibrary({ kind: "music", tempo: "medium" })).items.map((a) => a.id)).toEqual([track.id]);
      expect((await searchLibrary({ kind: "music", moods: ["Tense"] })).items.map((a) => a.id)).toEqual([track.id]);
      expect((await searchLibrary({ kind: "music", q: "acoustic guitar" })).items.map((a) => a.id)).toEqual([song.id]);
      expect((await searchLibrary({ kind: "sfx", categories: ["Doors"] })).total).toBe(1);
      expect((await searchLibrary({ kind: "sfx", categories: ["Weather"] })).total).toBe(0);
      expect((await searchLibrary({ kind: "music", length: "long" })).total).toBe(0);
      expect((await searchLibrary({ kind: "music", similarTo: track.id })).items.map((a) => a.id)).toEqual([song.id]);
    });
  });

  it("keeps favorites and boards, shares published items with everyone, and licenses downloads on paid plans", async () => {
    const engine = fakeEngine();
    vi.stubGlobal("fetch", engine.fetchFn);
    process.env.VIDEO_ENGINE_URL = "https://gpu.example";
    process.env.VIDEO_ENGINE_TOKEN = "engine-token";
    const { asUser, db, GLOBAL } = await import("@/lib/db");
    const { makeSfx } = await import("@/lib/sound-studio");
    const lib = await import("@/lib/library");
    const admin = "usr_admin";
    const other = "usr_other";

    const rain = await asUser(admin, () => makeSfx(admin, { prompt: "Rain on a tin roof", seconds: 2, category: "Weather" }));
    const published = await asUser(admin, async () => {
      expect(await lib.toggleFavorite(rain.id)).toBe(true);
      expect((await lib.searchLibrary({ kind: "sfx", shelf: "favorites" })).items.map((a) => a.id)).toEqual([rain.id]);
      const board = await lib.createBoard("Episode 2");
      await lib.updateBoard(board.id, { add: rain.id });
      expect((await lib.searchLibrary({ kind: "sfx", shelf: "board", boardId: board.id })).total).toBe(1);
      await lib.updateBoard(board.id, { remove: rain.id });
      expect((await lib.searchLibrary({ kind: "sfx", shelf: "board", boardId: board.id })).total).toBe(0);
      await expect(lib.updateBoard(board.id, { add: "aud_missing" })).rejects.toThrow(/isn't in the Library/);
      return lib.publishToCatalog(rain.id);
    });
    expect(published.owner).toBe(GLOBAL);
    expect(published.id).not.toBe(rain.id);
    // The catalog copy has its own files, under the app-wide owner.
    expect(await asUser(GLOBAL, () => db().get<{ id: string; type: string }>("media", published.mediaId))).toMatchObject({ type: "audio/wav" });

    await asUser(other, async () => {
      const seen = await lib.searchLibrary({ kind: "sfx" });
      expect(seen.items.map((a) => a.id)).toEqual([published.id]); // the catalog, never the admin's own library
      expect(await lib.findAsset(rain.id)).toBeNull();
      await expect(lib.deleteAsset(published.id, false)).rejects.toThrow(/wasn't found/);
      const dl = await lib.downloadLink(published);
      expect(dl.url).toContain(`/api/media/file/${GLOBAL}/${published.mediaId}`);
      expect(dl.fileName).toMatch(/-ghostpost\.wav$/);
      expect((await lib.catalog())[0].downloads).toBe(1);
      const text = lib.licenseText(published, { name: "Monica", email: "m@example.com" });
      expect(text).toContain("Licensed to: Monica <m@example.com>");
      expect(text).toContain("commercial use");
      expect(text).toContain("Content ID");
    });
    expect(lib.canDownload("free")).toBe(false);
    expect(lib.canDownload("free", "admin")).toBe(true);
    expect(lib.canDownload("creator")).toBe(true);

    await asUser(admin, async () => {
      await lib.deleteAsset(published.id, true);
      expect(await lib.catalog()).toEqual([]);
      await lib.deleteAsset(rain.id, false);
      expect(await lib.myAssets()).toEqual([]);
      expect(await db().get("media", rain.mediaId)).toBeNull();
    });
  });

  it("fills the shared catalog from the recipe list without repeating recipes", async () => {
    const engine = fakeEngine();
    vi.stubGlobal("fetch", engine.fetchFn);
    process.env.VIDEO_ENGINE_URL = "https://gpu.example";
    process.env.VIDEO_ENGINE_TOKEN = "engine-token";
    const { GLOBAL } = await import("@/lib/db");
    const { fillCatalog, fillStatus, musicRecipes, sfxRecipes } = await import("@/lib/catalog-fill");
    const { catalog } = await import("@/lib/library");
    expect(new Set(musicRecipes().map((r) => r.id)).size).toBe(musicRecipes().length);
    expect(new Set(sfxRecipes().map((r) => r.id)).size).toBe(sfxRecipes().length);
    expect(musicRecipes().some((r) => r.genres[0] === "Children" && r.moods[0] === "Dark")).toBe(false);
    const before = await fillStatus();
    const progress: number[] = [];
    expect(await fillCatalog("sfx", 2, (made) => progress.push(made), false)).toEqual({ made: 2, failed: [] });
    expect(progress).toEqual([1, 2]);
    await fillCatalog("sfx", 1, undefined, false);
    const items = (await catalog()).filter((a) => a.kind === "sfx");
    expect(items).toHaveLength(3);
    expect(items.every((a) => a.owner === GLOBAL)).toBe(true);
    expect(new Set(engine.requests.map((r) => r.prompt)).size).toBe(3); // no recipe made twice
    expect((await fillStatus()).sfx).toEqual({ left: before.sfx.left - 3, inCatalog: 3 });
  });

  it("checks tags against the Library's lists", async () => {
    const { pickTags, tagsInText, GENRES, fmtDuration } = await import("@/lib/library-tags");
    expect(pickTags(GENRES, ["hip HOP", "Polka", "Trap", "Trap"])).toEqual(["Hip hop", "Trap"]);
    expect(pickTags(GENRES, "Trap")).toEqual([]);
    expect(tagsInText(GENRES, "A lo-fi beat with jazz chords")).toEqual(["Lo-fi", "Jazz"]);
    expect(fmtDuration(125.4)).toBe("2:05");
    const { titleFrom } = await import("@/lib/sound-studio");
    expect(titleFrom("Smooth slow R&B with silky electric piano")).toBe("Smooth Slow R&B");
    expect(titleFrom("rain on a tin roof")).toBe("Rain on a Tin");
    expect(titleFrom("!!!")).toBe("Untitled");
  });
});
