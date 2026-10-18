import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSurface } from "@/lib/platforms/placement";
import { ADAPTERS } from "@/lib/platforms/adapters";
import type { Credential, Post } from "@/lib/types";

vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));

describe("where a post goes (placement)", () => {
  it("Instagram: videos are Reels or Stories; pictures are posts, carousels or Stories", () => {
    expect(resolveSurface("instagram", "auto", { video: { durationSec: 186 }, images: 0 })).toBe("ig_reel");
    expect(resolveSurface("instagram", "feed", { video: { durationSec: 30 }, images: 0 })).toBe("ig_reel");
    expect(resolveSurface("instagram", "story", { video: { durationSec: 45 }, images: 0 })).toBe("ig_story_video");
    expect(resolveSurface("instagram", "story", { video: { durationSec: 186 }, images: 0 })).toMatchObject({ error: expect.stringMatching(/up to 60 seconds/) });
    expect(resolveSurface("instagram", "auto", { images: 1 })).toBe("ig_image");
    expect(resolveSurface("instagram", "auto", { images: 4 })).toBe("ig_carousel");
    expect(resolveSurface("instagram", "story", { images: 3 })).toBe("ig_story_image");
    expect(resolveSurface("instagram", "auto", { images: 0 })).toMatchObject({ error: expect.stringMatching(/needs a picture or a video/) });
  });

  it("Facebook: Reels only up to 90 s and vertical, otherwise feed video; pictures and text posts", () => {
    expect(resolveSurface("facebook", "auto", { video: { durationSec: 58, portrait: true }, images: 0 })).toBe("fb_reel");
    expect(resolveSurface("facebook", "auto", { video: { durationSec: 186, portrait: true }, images: 0 })).toBe("fb_video");
    expect(resolveSurface("facebook", "auto", { video: { durationSec: 58, portrait: false }, images: 0 })).toBe("fb_video");
    expect(resolveSurface("facebook", "auto", { video: {}, images: 0 })).toBe("fb_video"); // unknown length: never risk a rejected Reel
    expect(resolveSurface("facebook", "reel", { video: { durationSec: 186 }, images: 0 })).toBe("fb_video"); // too long for a Reel
    expect(resolveSurface("facebook", "feed", { video: { durationSec: 30, portrait: true }, images: 0 })).toBe("fb_video");
    expect(resolveSurface("facebook", "story", { video: { durationSec: 30 }, images: 0 })).toBe("fb_story_video");
    expect(resolveSurface("facebook", "auto", { images: 0 })).toBe("fb_text");
    expect(resolveSurface("facebook", "auto", { images: 1 })).toBe("fb_photo");
    expect(resolveSurface("facebook", "auto", { images: 3 })).toBe("fb_photos");
    expect(resolveSurface("facebook", "story", { images: 1 })).toBe("fb_story_photo");
  });
});

describe("publishing to every surface", () => {
  afterEach(() => vi.unstubAllGlobals());
  const post = (o: Partial<Post> = {}): Post => ({
    id: "p1", platform: "instagram", pillar: "ai_leverage", format: "short", hook: "Hook", body: "Body", parts: [], hashtags: [],
    status: "draft", moneyScore: 0, revenue: { low: 0, high: 0, basis: "" }, scoreNotes: [], safetyFlags: [], attempts: 0, createdAt: "", updatedAt: "", ...o,
  });
  const video = { bytes: Buffer.alloc(1), url: "https://app.example/v.mp4", mime: "video/mp4", size: 1, durationSec: 58, portrait: true };
  /** Records every Graph API call and answers like Meta does. */
  const fakeMeta = () => {
    const calls: { url: string; method: string; body: string; headers: Record<string, string> }[] = [];
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? ""), headers: (init?.headers ?? {}) as Record<string, string> });
      const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
      if (url.includes("fields=status_code")) return json({ status_code: "FINISHED" });
      if (url.includes("fields=permalink")) return json({ permalink: "https://instagram.com/p/x" });
      if (url.includes("/video_reels") || url.includes("/video_stories")) return json(String(init?.body).includes("start") ? { video_id: "v9", upload_url: "https://rupload.facebook.com/video-upload/v25.0/v9" } : { success: true, post_id: "post9" });
      if (url.startsWith("https://rupload.facebook.com")) return json({ success: true });
      return json({ id: `id${++n}` });
    }));
    return calls;
  };
  const ig: Credential = { accessToken: "tok", accountId: "ig1" };
  const fb: Credential = { accessToken: "tok", accountId: "page1", mode: "page" };

  it("Instagram carousel: one container per picture, then a CAROUSEL container, then publish", async () => {
    const calls = fakeMeta();
    const imgs = ["https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg"];
    await ADAPTERS.instagram.publish(post(), ["Caption"], ig, undefined, { images: imgs, placement: "auto" });
    const creates = calls.filter((c) => c.method === "POST" && c.url.includes("/ig1/media?"));
    expect(creates).toHaveLength(4);
    expect(creates.slice(0, 3).every((c) => c.url.includes("is_carousel_item=true"))).toBe(true);
    expect(creates[3].url).toContain("media_type=CAROUSEL");
    expect(creates[3].url).toContain("children=id1%2Cid2%2Cid3");
    expect(calls.some((c) => c.url.includes("/ig1/media_publish?") && c.url.includes("creation_id=id4"))).toBe(true);
  });

  it("Instagram Story from a video, and a Reel shared to the feed", async () => {
    let calls = fakeMeta();
    await ADAPTERS.instagram.publish(post({ kind: "video" }), ["Caption"], ig, video, { images: [], placement: "story" });
    expect(calls.find((c) => c.url.includes("/ig1/media?"))!.url).toMatch(/media_type=STORIES.*video_url=/);
    calls = fakeMeta();
    await ADAPTERS.instagram.publish(post({ kind: "video" }), ["Caption"], ig, video, { images: [], placement: "auto" });
    expect(calls.find((c) => c.url.includes("/ig1/media?"))!.url).toMatch(/media_type=REELS.*share_to_feed=true/);
  });

  it("Facebook Reel: start, hosted-file upload, publish with the caption", async () => {
    const calls = fakeMeta();
    const r = await ADAPTERS.facebook.publish(post({ platform: "facebook", kind: "video" }), ["Caption"], fb, video, { images: [], placement: "auto" });
    expect(calls.map((c) => c.url.replace(/\?.*$/, ""))).toEqual([
      "https://graph.facebook.com/v25.0/page1/video_reels",
      "https://rupload.facebook.com/video-upload/v25.0/v9",
      "https://graph.facebook.com/v25.0/page1/video_reels",
    ]);
    expect(calls[1].headers).toMatchObject({ Authorization: "OAuth tok", file_url: video.url });
    expect(new URLSearchParams(calls[2].body).get("video_state")).toBe("PUBLISHED");
    expect(new URLSearchParams(calls[2].body).get("description")).toBe("Caption");
    expect(r.url).toBe("https://www.facebook.com/reel/v9");
  });

  it("Facebook multi-photo post attaches every uploaded picture", async () => {
    const calls = fakeMeta();
    await ADAPTERS.facebook.publish(post({ platform: "facebook" }), ["Caption"], fb, undefined, { images: ["https://a/1.jpg", "https://a/2.jpg"], placement: "auto" });
    const uploads = calls.filter((c) => c.url.endsWith("/page1/photos"));
    expect(uploads.map((c) => new URLSearchParams(c.body).get("published"))).toEqual(["false", "false"]);
    const feed = new URLSearchParams(calls.find((c) => c.url.endsWith("/page1/feed"))!.body);
    expect(feed.get("attached_media[0]")).toBe('{"media_fbid":"id1"}');
    expect(feed.get("attached_media[1]")).toBe('{"media_fbid":"id2"}');
  });

  it("Facebook photo Story: unpublished photo, then photo_stories", async () => {
    const calls = fakeMeta();
    await ADAPTERS.facebook.publish(post({ platform: "facebook" }), ["Caption"], fb, undefined, { images: ["https://a/1.jpg"], placement: "story" });
    expect(calls.map((c) => c.url.replace(/^.*page1\//, ""))).toEqual(["photos", "photo_stories"]);
    expect(new URLSearchParams(calls[1].body).get("photo_id")).toBe("id1");
  });

  it("a Story that's too long is handed back to post by hand instead of failing the account", async () => {
    fakeMeta();
    await expect(ADAPTERS.facebook.publish(post({ platform: "facebook", kind: "video" }), ["C"], fb, { ...video, durationSec: 186 }, { images: [], placement: "story" })).rejects.toThrow(/up to 60 seconds/);
  });
});

describe("posting automatically keeps the safety rules", () => {
  it("respects the kill switch, approval and mature posts, and posts copy-ready when nothing is connected", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    process.env.DATA_DIR = mkdtempSync(`${tmpdir()}/nexus-autopost-`);
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
    for (const k of ["SUPABASE_URL", "DATABASE_URL"]) delete process.env[k];
    process.env.SETUP_CODE = "test-setup-code";
    const { asUser, db } = await import("@/lib/db");
    const { createUser } = await import("@/lib/auth");
    const owner = await createUser({ email: "auto@example.com", password: "Correct-horse-battery-9", setupCode: "test-setup-code" });
    const { saveSettings, savePost } = await import("@/lib/repo");
    const { autoPublish } = await import("@/lib/publisher");
    const t = new Date().toISOString();
    const mk = (id: string, o: Partial<Post> = {}): Post => ({
      id, platform: "facebook", pillar: "ai_leverage", format: "short", hook: "A calm, useful post", body: "Plain words.", parts: [], hashtags: [],
      status: "draft", moneyScore: 0, revenue: { low: 0, high: 0, basis: "" }, scoreNotes: [], safetyFlags: [], attempts: 0, createdAt: t, updatedAt: t, ...o,
    });
    await asUser(owner.id, async () => {
      await saveSettings({ killSwitch: true });
      const a = mk("a");
      await savePost(a);
      expect((await autoPublish(a)).outcome).toBe("waiting");
      expect((await db().get<Post>("posts", "a"))?.status).toBe("draft");

      await saveSettings({ killSwitch: false });
      const b = mk("b");
      await savePost(b);
      await autoPublish(b, { requireApproval: true });
      expect((await db().get<Post>("posts", "b"))?.status).toBe("pending_review");

      const c = mk("c", { platform: "x", mature: true });
      await savePost(c);
      expect((await autoPublish(c)).outcome).toBe("waiting");

      const d = mk("d");
      await savePost(d);
      const r = await autoPublish(d);
      expect(r.outcome).toBe("copy_ready"); // no account connected: ready to copy, never silently lost
      expect((await db().get<Post>("posts", "d"))?.error).toMatch(/No account connected/);
    });
  });
});

describe("Facebook profile on autopilot through Instagram", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("posts pictures/videos to Instagram (which shares to the profile) and hands text-only posts over", async () => {
    process.env.SETUP_CODE = "test-setup-code";
    const { asUser } = await import("@/lib/db");
    const { createUser } = await import("@/lib/auth");
    const owner = await createUser({ email: "profile-auto@example.com", password: "Correct-horse-battery-9", setupCode: "test-setup-code" });
    const { saveCredential, savePost, credentialStatuses } = await import("@/lib/repo");
    const { autoPublish } = await import("@/lib/publisher");
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
      if (url.includes("fields=status_code")) return json({ status_code: "FINISHED" });
      if (url.includes("fields=permalink")) return json({ permalink: "https://instagram.com/p/abc" });
      return json({ id: "c1" });
    }));
    const t = new Date().toISOString();
    const mk = (id: string, o: Partial<Post> = {}): Post => ({
      id, platform: "facebook", pillar: "ai_leverage", format: "short", hook: "How we met", body: "Chapter 2.", parts: [], hashtags: [],
      status: "draft", moneyScore: 0, revenue: { low: 0, high: 0, basis: "" }, scoreNotes: [], safetyFlags: [], attempts: 0, createdAt: t, updatedAt: t, ...o,
    });
    await asUser(owner.id, async () => {
      await saveCredential("instagram", { accessToken: "tok", accountId: "ig1", method: "oauth" });
      await saveCredential("facebook", { mode: "profile", method: "profile", profileName: "Arthur Hamilton", viaInstagram: "1" });
      expect((await credentialStatuses()).find((s) => s.platform === "facebook")?.viaInstagram).toBe(true);

      const pic = mk("pic", { imageUrl: "https://cdn.example/cover.jpg" });
      await savePost(pic);
      const r = await autoPublish(pic);
      expect(r.outcome).toBe("published");
      expect(calls.some((u) => u.includes("/ig1/media?") && u.includes("image_url="))).toBe(true);
      expect(pic.externalUrl).toBe("https://instagram.com/p/abc");

      const text = mk("text", { hook: "Who is ready for chapter three tonight?", body: "Tell me below." });
      await savePost(text);
      expect((await autoPublish(text)).outcome).toBe("copy_ready");
      expect(text.handoff?.to).toBe("facebook_profile");
    });
  });
});
