import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { detectNetworks, localDateTime, metricoolBody, parseMetricoolIds } from "@/lib/metricool";
import type { Post } from "@/lib/types";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-metricool-"));
process.env.DATA_DIR = dir;
process.env.SETUP_CODE = "test-setup-code";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
process.env.APP_URL = "https://app.example.com";
delete process.env.SUPABASE_URL;
delete process.env.DATABASE_URL;

const now = () => new Date().toISOString();
const post = (id: string, platform: Post["platform"], extra: Partial<Post> = {}): Post => ({
  id,
  platform,
  pillar: "wealth_systems",
  format: "caption",
  hook: "The $9 charge you forgot about is costing you $108 a year.",
  body: "Open your bank app tonight and search for every subscription.",
  parts: [],
  hashtags: ["money"],
  status: "scheduled",
  scheduledAt: new Date(Date.now() - 60_000).toISOString(),
  moneyScore: 0,
  revenue: { low: 0, high: 0, basis: "" },
  scoreNotes: [],
  safetyFlags: [],
  attempts: 0,
  createdAt: now(),
  updatedAt: now(),
  ...extra,
});

describe("Metricool helpers", () => {
  it("finds the IDs in a pasted Metricool link", () => {
    expect(parseMetricoolIds("https://app.metricool.com/planner?blogId=7360508&userId=5713986")).toEqual({ userId: "5713986", blogId: "7360508" });
    expect(parseMetricoolIds("https://app.metricool.com/evolution/web?userId=11&blogId=22")).toEqual({ userId: undefined, blogId: undefined });
    expect(parseMetricoolIds("nothing here")).toEqual({ userId: undefined, blogId: undefined });
  });

  it("detects connected networks in both brand shapes Metricool returns", () => {
    expect(detectNetworks({ id: 7360508, networksData: { facebookData: "954032414468101", instagramData: "bino_da_producer" } })).toEqual(["facebook", "instagram"]);
    expect(detectNetworks({ id: 1, twitter: "handle", linkedinCompany: "urn:li:organization:1", youtube: null, tiktok: "", facebook: "null" })).toEqual(["x", "linkedin"]);
    expect(detectNetworks(null)).toEqual([]);
  });

  it("formats the publication time as local wall-clock time", () => {
    expect(localDateTime("America/Chicago", 2, new Date("2026-10-16T08:00:00Z"))).toBe("2026-10-16T03:02:00");
    expect(localDateTime("UTC", 0, new Date("2026-01-01T23:59:59Z"))).toBe("2026-01-01T23:59:59");
  });

  it("builds network-specific bodies", () => {
    const reel = metricoolBody("instagram", post("a", "instagram", { kind: "video" }), ["caption"], { url: "https://x/v.mp4", video: true }, "America/Chicago");
    expect(reel).toMatchObject({ text: "caption", providers: [{ network: "instagram" }], media: ["https://x/v.mp4"], saveExternalMediaFiles: true, autoPublish: true, draft: false, instagramData: { type: "REEL" } });
    const fb = metricoolBody("facebook", post("b", "facebook"), ["hello"], null, "America/Chicago");
    expect(fb).toMatchObject({ providers: [{ network: "facebook" }], media: [], saveExternalMediaFiles: false, facebookData: { type: "POST" } });
    const x = metricoolBody("x", post("c", "x"), ["one", "two"], null, "UTC");
    expect(x).toMatchObject({ text: "one", providers: [{ network: "twitter" }], descendants: [{ text: "two" }], twitterData: { tags: [] } });
    const yt = metricoolBody("youtube", post("d", "youtube", { kind: "video", video: { length: "long", titles: ["A long title"] } as Post["video"] }), ["desc"], { url: "https://x/v.mp4", video: true }, "UTC");
    expect(yt).toMatchObject({ youtubeData: { title: "A long title", type: "video", privacy: "public", madeForKids: false } });
  });
});

let owner: { id: string };
beforeAll(async () => {
  const { createUser } = await import("@/lib/auth");
  owner = await createUser({ email: "owner@example.com", password: "Correct-horse-battery-9", setupCode: "test-setup-code" });
});
afterEach(() => vi.unstubAllGlobals());

describe("connecting Metricool", () => {
  it("explains the plan requirement when Metricool rejects the token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })));
    const { checkMetricool } = await import("@/lib/metricool");
    await expect(checkMetricool({ token: "bad", userId: "5713986", blogId: "7360508" })).rejects.toThrow(/Advanced and Custom/);
  });

  it("reads the brand's accounts and sends the token in X-Mc-Auth", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), headers: init?.headers as Record<string, string> });
        return new Response(JSON.stringify([{ id: 7360508, label: "My Brand", networksData: { facebookData: "954", instagramData: "bino_da_producer" } }]), { status: 200 });
      }),
    );
    const { checkMetricool } = await import("@/lib/metricool");
    const r = await checkMetricool({ token: "tok", userId: "5713986", blogId: "7360508" });
    expect(r).toEqual({ brand: "My Brand", found: ["facebook", "instagram"] });
    expect(calls[0].url).toBe("https://app.metricool.com/api/admin/simpleProfiles?userId=5713986&blogId=7360508");
    expect(calls[0].headers["X-Mc-Auth"]).toBe("tok");
  });
});

describe("publishing through Metricool", () => {
  it("sends Instagram posts to Metricool's scheduler and marks them published", async () => {
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
        return new Response(JSON.stringify({ data: { id: 991 } }), { status: 200 });
      }),
    );
    const { asUser } = await import("@/lib/db");
    const { saveMetricool } = await import("@/lib/metricool");
    const { credentialStatuses, getPost, savePost, saveSettings } = await import("@/lib/repo");
    const { publishOne } = await import("@/lib/publisher");
    await asUser(owner.id, async () => {
      const settings = await saveSettings({ quietHours: { enabled: false, start: "23:30", end: "06:30" } });
      await saveMetricool({ token: "tok", userId: "5713986", blogId: "7360508", brand: "My Brand", found: ["facebook", "instagram"], use: { instagram: true }, connectedAt: now(), checkedAt: now() });
      const ig = (await credentialStatuses()).find((c) => c.platform === "instagram")!;
      expect(ig).toMatchObject({ connected: true, direct: false, via: "metricool" });

      const p = post("ig_1", "instagram", { imageUrl: "https://cdn.example.com/photo.jpg" });
      await savePost(p);
      const r = await publishOne(p, settings, true);
      expect(r.outcome).toBe("published");
      expect(sent).toHaveLength(1);
      expect(sent[0].url).toBe("https://app.metricool.com/api/v2/scheduler/posts?userId=5713986&blogId=7360508");
      expect(sent[0].body).toMatchObject({ providers: [{ network: "instagram" }], media: ["https://cdn.example.com/photo.jpg"], instagramData: { type: "POST" }, publicationDate: { timezone: settings.timezone } });
      const saved = (await getPost("ig_1"))!;
      expect(saved.status).toBe("published");
      expect(saved.externalId).toBe("metricool:991");
    });
  });

  it("keeps a Facebook profile handoff unless Facebook is switched to Metricool", async () => {
    const sent: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        sent.push(String(url));
        return new Response(JSON.stringify({ data: { id: 5 } }), { status: 200 });
      }),
    );
    const { asUser } = await import("@/lib/db");
    const { getMetricool, saveMetricool } = await import("@/lib/metricool");
    const { getSettings, savePost, saveCredential } = await import("@/lib/repo");
    const { publishOne } = await import("@/lib/publisher");
    await asUser(owner.id, async () => {
      await saveCredential("facebook", { mode: "profile", method: "profile", profileName: "Test Creator", handle: "Test Creator" });
      const settings = await getSettings();
      const a = post("fb_1", "facebook", { format: "short" });
      await savePost(a);
      expect((await publishOne(a, settings, true)).handoff).toBe(true);
      expect(sent).toHaveLength(0);

      const conn = (await getMetricool())!;
      await saveMetricool({ ...conn, use: { ...conn.use, facebook: true } });
      const b = post("fb_2", "facebook", { format: "short", hook: "Three bills to check before the 1st of the month." });
      await savePost(b);
      const r = await publishOne(b, settings, true);
      expect(r.outcome).toBe("published");
      expect(sent).toEqual(["https://app.metricool.com/api/v2/scheduler/posts?userId=5713986&blogId=7360508"]);
    });
  });

  it("asks to reconnect Metricool when the token stops working", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    const { asUser } = await import("@/lib/db");
    const { getPost, getSettings, savePost, saveSettings } = await import("@/lib/repo");
    const { publishOne } = await import("@/lib/publisher");
    await asUser(owner.id, async () => {
      // The first test just posted to Instagram; allow back-to-back posts so the spacing rule doesn't hold this one.
      const s0 = await getSettings();
      await saveSettings({ limits: { ...s0.limits, instagram: { ...s0.limits.instagram, minGapSec: 0 } } });
      const p = post("ig_2", "instagram", { imageUrl: "https://cdn.example.com/2.jpg", hook: "Why your savings account is quietly losing money." });
      await savePost(p);
      const r = await publishOne(p, await getSettings(), true);
      expect(r.outcome).toBe("failed");
      expect((await getPost("ig_2"))?.error).toMatch(/reconnect Metricool/);
    });
  });
});
