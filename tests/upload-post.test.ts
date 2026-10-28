import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "@/lib/types";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-up-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
process.env.SETUP_CODE = "test-setup-code";
process.env.APP_URL = "https://ghostpost.example";
for (const k of ["SUPABASE_URL", "DATABASE_URL"]) delete process.env[k];

const UP = "https://up.example";
type Call = { method: string; path: string; auth: string; body: unknown; form: Record<string, string[]>; headers: Record<string, string> };
let calls: Call[] = [];
let accounts: Record<string, unknown> = {};
let uploadReply: (path: string, form: Record<string, string[]>) => { status: number; body: unknown } = () => ({ status: 200, body: { success: true, request_id: "req-1" } });
let statusReply: { status: number; body: unknown } = { status: 200, body: { status: "completed", results: [{ platform: "instagram", success: true, url: "https://instagram.com/p/abc" }] } };

function stub() {
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    const url = new URL(String(u));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const form: Record<string, string[]> = {};
    if (init?.body instanceof FormData) for (const [k, v] of init.body.entries()) (form[k] ??= []).push(String(v));
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method: init?.method ?? "GET", path: url.pathname + url.search, auth: headers.Authorization, body, form, headers });
    expect(headers.Authorization).toBe("Apikey up-key-1234567890abcdef");
    const p = url.pathname;
    if (p === "/api/uploadposts/users" && init?.method === "POST") return Response.json({ success: true, profile: { username: body.username } }, { status: 201 });
    if (p.startsWith("/api/uploadposts/users/gp_")) return Response.json({ success: true, profile: { social_accounts: accounts } });
    if (p.startsWith("/api/uploadposts/oauth/")) return Response.json({ success: true, authorize_url: `https://www.instagram.com/oauth/authorize?state=s1`, state: "s1", expires_in: 900 });
    if (p === "/api/uploadposts/users/social") return Response.json({ success: true });
    if (p === "/api/uploadposts/status") return Response.json(statusReply.body, { status: statusReply.status });
    if (p === "/api/upload" || p === "/api/upload_photos" || p === "/api/upload_text") {
      const r = uploadReply(p, form);
      return Response.json(r.body, { status: r.status });
    }
    return new Response("{}", { status: 404 });
  }));
}

let userId = "";
const as = async <T,>(fn: () => Promise<T>) => (await import("@/lib/db")).asUser(userId, fn);
const post = (o: Partial<Post> = {}): Post =>
  ({ id: `pst_${Math.random().toString(36).slice(2, 8)}`, platform: "instagram", status: "scheduled", hook: "A hook", attempts: 0, mediaIds: [], ...o }) as Post;

beforeAll(async () => {
  const { createUser } = await import("@/lib/auth");
  userId = (await createUser({ email: "owner@example.com", password: "Correct-horse-battery-9", setupCode: "test-setup-code", name: "Bino" })).id;
});
beforeEach(() => {
  process.env.UPLOAD_POST_API_KEY = "up-key-1234567890abcdef";
  process.env.UPLOAD_POST_API_URL = UP;
  calls = [];
  accounts = {};
  stub();
});
afterEach(() => vi.unstubAllGlobals());

describe("one-tap connect through Upload-Post", () => {
  it("makes the user's profile once and starts the network's own sign-in with a return address", async () => {
    const up = await import("@/lib/upload-post");
    const url = await as(() => up.startConnect("instagram", "https://ghostpost.example/api/connect/instagram/callback?via=upload-post", "Bino"));
    expect(url).toMatch(/^https:\/\/www\.instagram\.com\/oauth\/authorize/);
    await as(() => up.startConnect("tiktok", "https://ghostpost.example/back"));
    const creates = calls.filter((c) => c.method === "POST" && c.path === "/api/uploadposts/users");
    expect(creates).toHaveLength(1);
    expect(creates[0].body).toEqual({ username: `gp_${userId.replace(/[^A-Za-z0-9_]/g, "_")}`, display_name: "Bino" });
    const start = calls.find((c) => c.path === "/api/uploadposts/oauth/instagram/start")!;
    expect(start.body).toEqual({ profile: creates[0].body && (creates[0].body as { username: string }).username, redirect_url: "https://ghostpost.example/api/connect/instagram/callback?via=upload-post" });
  });

  it("reads what came back in plain words", async () => {
    const { connectOutcome } = await import("@/lib/upload-post");
    expect(connectOutcome(new URLSearchParams("connect_status=success&platform=instagram"))).toEqual({ ok: true });
    expect(connectOutcome(new URLSearchParams("connect_status=cancelled&error_code=ACCESS_DENIED")).message).toMatch(/cancelled/);
    expect(connectOutcome(new URLSearchParams("connect_status=error&error_code=INVALID_STATE")).message).toMatch(/took too long/);
  });

  it("shows networks connected through the service as connected, and every network as one tap", async () => {
    accounts = { instagram: { username: "bino_da_producer", display_name: "Bino" }, tiktok: "" };
    const up = await import("@/lib/upload-post");
    up.forgetAccounts && (await as(async () => up.forgetAccounts()));
    const { credentialStatuses } = await import("@/lib/repo");
    const st = await as(() => credentialStatuses());
    const ig = st.find((s) => s.platform === "instagram")!;
    expect(ig).toMatchObject({ connected: true, via: "upload-post", handle: "@bino_da_producer", oauthReady: true });
    expect(st.find((s) => s.platform === "tiktok")).toMatchObject({ connected: false, oauthReady: true });
  });
});

describe("posting through Upload-Post", () => {
  it("sends a video with the caption, Reels placement and a retry-safe key", async () => {
    const up = await import("@/lib/upload-post");
    const p = post({ placement: "auto" });
    const r = await as(() => up.publishViaUploadPost("instagram", p, ["Line one", "#tag"], { video: { url: "https://ghostpost.example/v.mp4" } }));
    const c = calls.find((x) => x.path === "/api/upload")!;
    expect(c.form["platform[]"]).toEqual(["instagram"]);
    expect(c.form.video).toEqual(["https://ghostpost.example/v.mp4"]);
    expect(c.form.title).toEqual(["Line one\n\n#tag"]);
    expect(c.form.media_type).toEqual(["REELS"]);
    expect(c.headers["Idempotency-Key"]).toBe(`${p.id}-0`);
    expect(r.externalId).toBe("upload-post:req-1");
  });

  it("uses the photo and text endpoints, and says when a network needs a picture", async () => {
    const up = await import("@/lib/upload-post");
    await as(() => up.publishViaUploadPost("linkedin", post({ platform: "linkedin" }), ["Just text"], {}));
    expect(calls.at(-1)!.path).toBe("/api/upload_text");
    await as(() => up.publishViaUploadPost("instagram", post(), ["Pic"], { images: ["https://ghostpost.example/a.png", "https://ghostpost.example/b.png"] }));
    expect(calls.at(-1)!.path).toBe("/api/upload_photos");
    expect(calls.at(-1)!.form["photos[]"]).toHaveLength(2);
    await expect(as(() => up.publishViaUploadPost("instagram", post(), ["No media"], {}))).rejects.toThrow(/needs a picture or video/);
  });

  it("picks the first Facebook Page when several are connected, and remembers it", async () => {
    let n = 0;
    uploadReply = (_p, form) => (n++ === 0 && !form.facebook_page_id ? { status: 400, body: { success: false, available_pages: [{ id: "page-9" }, { id: "page-10" }] } } : { status: 200, body: { success: true, request_id: "req-fb" } });
    const up = await import("@/lib/upload-post");
    const r = await as(() => up.publishViaUploadPost("facebook", post({ platform: "facebook" }), ["Hi"], {}));
    expect(r.externalId).toBe("upload-post:req-fb");
    expect(calls.filter((c) => c.path === "/api/upload_text").at(-1)!.form.facebook_page_id).toEqual(["page-9"]);
    uploadReply = () => ({ status: 200, body: { success: true, request_id: "req-1" } });
  });

  it("turns a disconnected account into a plain 'reconnect' message", async () => {
    uploadReply = () => ({ status: 400, body: { success: false, message: "Instagram account not connected for this profile" } });
    const up = await import("@/lib/upload-post");
    await expect(as(() => up.publishViaUploadPost("instagram", post(), ["x"], { images: ["https://ghostpost.example/a.png"] }))).rejects.toThrow(/Reconnect it on the Platforms tab/);
    uploadReply = () => ({ status: 200, body: { success: true, request_id: "req-1" } });
  });

  it("fills in the post's link later, or marks it failed with the network's reason", async () => {
    const { savePost, listPosts } = await import("@/lib/repo");
    const { settleServiceSends } = await import("@/lib/publisher");
    const done = post({ status: "published", externalId: "upload-post:req-1", publishedAt: new Date().toISOString() });
    await as(() => savePost(done));
    await as(() => settleServiceSends());
    let saved = (await as(() => listPosts())).find((p) => p.id === done.id)!;
    expect(saved).toMatchObject({ externalUrl: "https://instagram.com/p/abc", remoteSettled: true, status: "published" });
    statusReply = { status: 200, body: { status: "failed", results: [{ platform: "instagram", success: false, error: "Video too short" }] } };
    const bad = post({ status: "published", externalId: "upload-post:req-2", publishedAt: new Date().toISOString() });
    await as(() => savePost(bad));
    await as(() => settleServiceSends());
    saved = (await as(() => listPosts())).find((p) => p.id === bad.id)!;
    expect(saved.status).toBe("failed");
    expect(saved.error).toMatch(/Video too short/);
  });

  it("disconnects the network in the service too", async () => {
    const up = await import("@/lib/upload-post");
    await as(() => up.disconnect("instagram"));
    const c = calls.find((x) => x.path === "/api/uploadposts/users/social")!;
    expect(c.method).toBe("DELETE");
    expect(c.body).toMatchObject({ social_platform: "instagram" });
  });
});
