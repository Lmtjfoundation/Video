import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanProfileName, normalizePostLink, normalizeProfileUrl } from "@/lib/facebook-profile";
import type { Post } from "@/lib/types";

// Isolated file-backed database for this test.
const dir = mkdtempSync(path.join(tmpdir(), "nexus-fbprofile-"));
process.env.DATA_DIR = dir;
process.env.SETUP_CODE = "test-setup-code";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
delete process.env.SUPABASE_URL;
delete process.env.DATABASE_URL;

describe("profile links", () => {
  it.each([
    ["facebook.com/jane.doe.55", "https://www.facebook.com/jane.doe.55"],
    ["https://www.facebook.com/jane.doe.55/", "https://www.facebook.com/jane.doe.55"],
    ["https://m.facebook.com/jane.doe.55?mibextid=abc", "https://www.facebook.com/jane.doe.55"],
    ["http://web.facebook.com/profile.php?id=100012345678901&ref=x", "https://www.facebook.com/profile.php?id=100012345678901"],
    ["https://www.facebook.com/people/Jane-Doe/100012345678901/", "https://www.facebook.com/people/Jane-Doe/100012345678901"],
    ["fb.com/janedoe", "https://www.facebook.com/janedoe"],
  ])("accepts %s", (input, out) => expect(normalizeProfileUrl(input)).toBe(out));

  it.each([
    "", "https://evil.example.com/jane.doe", "https://facebook.com.evil.com/jane", "https://www.facebook.com/groups",
    "https://www.facebook.com/profile.php", "https://www.facebook.com/abc", "javascript:alert(1)", "https://www.facebook.com/watch",
  ])("rejects %s", (input) => expect(normalizeProfileUrl(input)).toBeNull());

  it("cleans the display name", () => {
    expect(cleanProfileName("  Jane   Doe ")).toBe("Jane Doe");
    expect(cleanProfileName("")).toBeNull();
    expect(cleanProfileName("x".repeat(81))).toBeNull();
    expect(cleanProfileName(42)).toBeNull();
  });

  it("accepts only Facebook post links", () => {
    expect(normalizePostLink("https://www.facebook.com/reel/123456789")).toBe("https://www.facebook.com/reel/123456789");
    expect(normalizePostLink("fb.watch/abcDEF/")).toBe("https://fb.watch/abcDEF/");
    expect(normalizePostLink("https://example.com/reel/1")).toBeNull();
    expect(normalizePostLink("https://www.facebook.com/")).toBeNull();
    expect(normalizePostLink("")).toBeNull();
  });
});

let owner: { id: string };

beforeAll(async () => {
  const { createUser } = await import("@/lib/auth");
  owner = await createUser({ email: "creator@example.com", password: "Correct-horse-battery-9", setupCode: "test-setup-code" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const now = () => new Date().toISOString();
const post = (id: string, hook: string): Post => ({
  id,
  platform: "facebook",
  pillar: "wealth_systems",
  format: "short",
  hook,
  body: `${hook} Here is the plain version: list every subscription, cancel the ones you forgot, and move that money on payday.`,
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
});

describe("monetized Facebook profiles", () => {
  it("connect without a token and count as connected", async () => {
    const { asUser } = await import("@/lib/db");
    const { saveCredential, credentialStatuses } = await import("@/lib/repo");
    const { freshCredential } = await import("@/lib/platforms/auth");
    await asUser(owner.id, async () => {
      await saveCredential("facebook", { mode: "profile", method: "profile", profileName: "Test Creator", handle: "Test Creator" });
      const fb = (await credentialStatuses()).find((s) => s.platform === "facebook")!;
      expect(fb.connected).toBe(true);
      expect(fb.mode).toBe("profile");
      expect(fb.profileName).toBe("Test Creator");
      expect(fb.fields).not.toContain("accessToken");
      expect((await freshCredential("facebook"))?.mode).toBe("profile");
    });
  });

  it("hands due posts to the person at their time, without calling Facebook, and counts them once", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("No network call expected for a profile post");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { asUser } = await import("@/lib/db");
    const { getUser } = await import("@/lib/auth");
    const { getPost, savePost, saveSettings } = await import("@/lib/repo");
    const { runPublish } = await import("@/lib/publisher");
    await asUser(owner.id, async () => {
      const settings = await saveSettings({
        autopilot: true,
        quietHours: { enabled: false, start: "23:30", end: "06:30" },
        platforms: { x: false, facebook: true, linkedin: false, instagram: false, youtube: false, tiktok: false, webhook: false },
      });
      expect(settings.handoffEmail).toBe(true);
      await savePost(post("fb_profile_1", "The $9 charge you forgot about is costing you $108 a year."));
      const before = (await getUser(owner.id))!.usage.posts;
      const user = (await getUser(owner.id))!;
      const res = await runPublish(user);
      expect(res.results).toEqual({ fb_profile_1: "copy_ready" });
      const p = (await getPost("fb_profile_1"))!;
      expect(p.status).toBe("copy_ready");
      expect(p.handoff?.to).toBe("facebook_profile");
      expect(p.handoff?.readyAt).toBeTruthy();
      expect(p.error).toBeUndefined();
      expect((await getUser(owner.id))!.usage.posts).toBe(before + 1);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it("waits for quiet hours to end before handing a post over (Post now still works)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network"); }));
    const { asUser } = await import("@/lib/db");
    const { getPost, savePost, saveSettings } = await import("@/lib/repo");
    const { publishOne } = await import("@/lib/publisher");
    await asUser(owner.id, async () => {
      // Quiet all day (except 23:59), so the check is deterministic whenever the test runs.
      const settings = await saveSettings({ quietHours: { enabled: true, start: "00:00", end: "23:59" } });
      const p = post("fb_profile_quiet", "Your bank's overdraft fee has a loophole most people never ask about.");
      await savePost(p);
      const r = await publishOne(p, settings);
      if (new Date().toLocaleTimeString("en-GB", { timeZone: settings.timezone, hour: "2-digit", minute: "2-digit" }) !== "23:59") {
        expect(r.outcome).toBe("waiting");
        expect((await getPost(p.id))?.status).toBe("scheduled");
      }
      const manual = await publishOne((await getPost(p.id))!, settings, true);
      expect(manual.handoff).toBe(true);
      expect((await getPost(p.id))?.handoff?.notifiedAt).toBeTruthy(); // in the app already: no email
      await saveSettings({ quietHours: { enabled: false, start: "23:30", end: "06:30" } });
    });
  });

  it("emails once per run with a link to the posting screen, then never again for the same posts", async () => {
    const sent: { url: string; body: { to: string[]; subject: string; html: string; text: string } }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ id: "email_1" }), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Nexus Pulse <hello@example.com>";
    process.env.APP_URL = "https://app.example.com";
    const { asUser } = await import("@/lib/db");
    const { getUser } = await import("@/lib/auth");
    const { getPost, savePost } = await import("@/lib/repo");
    const { runPublish } = await import("@/lib/publisher");
    try {
      await asUser(owner.id, async () => {
        await savePost(post("fb_profile_mail_1", "Why your savings account is quietly losing money."));
        await savePost(post("fb_profile_mail_2", "The one question to ask before any big purchase."));
        await runPublish((await getUser(owner.id))!);
        expect(sent).toHaveLength(1);
        expect(sent[0].url).toBe("https://api.resend.com/emails");
        expect(sent[0].body.to).toEqual(["creator@example.com"]);
        expect(sent[0].body.subject).toBe("2 posts are ready for your Facebook profile");
        expect(sent[0].body.html).toMatch(/https:\/\/app\.example\.com\/post\/fb_profile_mail_[12]/);
        expect((await getPost("fb_profile_mail_1"))?.handoff?.notifiedAt).toBeTruthy();
        await runPublish((await getUser(owner.id))!);
        expect(sent).toHaveLength(1);
      });
    } finally {
      delete process.env.RESEND_API_KEY;
      delete process.env.EMAIL_FROM;
      delete process.env.APP_URL;
    }
  });

  it("never reads or replies to profile comments through the API", async () => {
    const { ADAPTERS } = await import("@/lib/platforms/adapters");
    const { CopyReadyError } = await import("@/lib/platforms/http");
    const cred = { mode: "profile", profileName: "Test Creator" };
    await expect(ADAPTERS.facebook.fetchComments(cred, ["1"])).rejects.toBeInstanceOf(CopyReadyError);
    await expect(ADAPTERS.facebook.reply(cred, { commentExternalId: "1", postExternalId: "1" }, "hi")).rejects.toBeInstanceOf(CopyReadyError);
    await expect(ADAPTERS.facebook.publish(post("x", "x"), ["x"], cred)).rejects.toBeInstanceOf(CopyReadyError);
  });

  it("a Page connection still posts automatically", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ id: "111_222" }), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    const { asUser } = await import("@/lib/db");
    const { getPost, savePost, saveCredential, getSettings } = await import("@/lib/repo");
    const { publishOne } = await import("@/lib/publisher");
    await asUser(owner.id, async () => {
      await saveCredential("facebook", { mode: "page", method: "oauth", accessToken: "page-token", accountId: "111", handle: "Test Page", profileName: "Test Creator" });
      const p = post("fb_page_1", "Three bills to check before the 1st of the month.");
      await savePost(p);
      const r = await publishOne(p, await getSettings(), true);
      expect(r.outcome).toBe("published");
      expect(r.handoff).toBeUndefined();
      expect(calls.some((u) => u.includes("/111/feed"))).toBe(true);
      expect((await getPost("fb_page_1"))?.externalUrl).toBe("https://www.facebook.com/111_222");
    });
  });
});
