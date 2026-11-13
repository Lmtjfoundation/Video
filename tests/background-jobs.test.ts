import { mkdtempSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-bg-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"]) delete process.env[k];

const until = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 300; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out");
};

describe("background jobs survive restarts", () => {
  it("counts live work, leaves a shutdown-stopped resumable job running, and resumes it", async () => {
    const { asUser } = await import("@/lib/db");
    const { startJob, listJobs, liveJobCount, registerResumer, resumeInterrupted } = await import("@/lib/jobs");
    const user = "usr_bg";
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await asUser(user, () =>
      startJob(user, { kind: "movie", title: "Long movie", resume: { kind: "test-resume", input: { n: 1 } } }, async () => {
        await gate;
        throw new Error("ffmpeg failed (killed by SIGTERM): stopped");
      }),
    );
    await until(async () => liveJobCount() === 1);
    release();
    await until(async () => liveJobCount() === 0);
    const stopped = (await asUser(user, listJobs))[0];
    expect(stopped.status).toBe("running"); // not failed: it carries on after the restart
    expect(stopped.resume?.kind).toBe("test-resume");

    const seen: unknown[] = [];
    registerResumer("test-resume", (_u, input) => async (_say, ctx) => {
      seen.push({ input, resumed: ctx.resumed, id: ctx.jobId });
      return { message: "Finished after the restart" };
    });
    expect(await asUser(user, resumeInterrupted)).toBe(1);
    await until(async () => (await asUser(user, listJobs))[0].status === "done");
    const done = (await asUser(user, listJobs))[0];
    expect(done.message).toBe("Finished after the restart");
    expect(done.resume).toBeUndefined();
    expect(seen).toEqual([{ input: { n: 1 }, resumed: true, id: stopped.id }]);
  });

  it("fails a real error as before", async () => {
    const { asUser } = await import("@/lib/db");
    const { startJob, listJobs, wasInterrupted } = await import("@/lib/jobs");
    expect(wasInterrupted(new Error("ffmpeg failed (timed out): x"))).toBe(false);
    expect(wasInterrupted(new Error("python3 failed (killed by SIGTERM): x"))).toBe(true);
    const user = "usr_bg2";
    await asUser(user, () => startJob(user, { kind: "movie", title: "Broken", resume: { kind: "x", input: {} } }, async () => { throw new Error("No pictures"); }));
    await until(async () => (await asUser(user, listJobs))[0].status === "failed");
    expect((await asUser(user, listJobs))[0].message).toBe("No pictures");
  });
});

describe("movie work is reused after a restart", () => {
  it("doesn't make a picture that's already saved", async () => {
    vi.resetModules();
    const makeImage = vi.fn(async () => ({ bytes: Buffer.from("png"), mimeType: "image/png" }));
    vi.doMock("@/lib/pictures", () => ({ makeImage, picturesReady: async () => "own" }));
    vi.doMock("@/lib/render", () => ({
      runCmd: vi.fn(async () => {
        throw new Error("python failed (killed by SIGTERM): stop");
      }),
      narrate: vi.fn(),
      mediaDuration: vi.fn(),
    }));
    const { asUser } = await import("@/lib/db");
    const { renderMovie, movieWorkDir } = await import("@/lib/movie-maker-render");
    const { parsePlan } = await import("@/lib/movie-maker");
    const plan = parsePlan("A storm.\n\nThe keeper climbs.");
    const work = movieWorkDir("job_resume_test");
    const input = { plan, grade: "noir" as const, characterIds: [], voice: false, endCard: "", fiction: false };
    await expect(asUser("usr_mv", () => renderMovie("usr_mv", input, () => {}, work))).rejects.toThrow(/SIGTERM/);
    expect(makeImage).toHaveBeenCalledTimes(2);
    expect((await fs.readdir(work)).filter((f) => f.endsWith(".png")).sort()).toEqual(["s0.png", "s1.png"]); // kept for the resumed run
    await expect(asUser("usr_mv", () => renderMovie("usr_mv", input, () => {}, work))).rejects.toThrow(/SIGTERM/);
    expect(makeImage).toHaveBeenCalledTimes(2); // not made (or paid for) again
    vi.doUnmock("@/lib/pictures");
    vi.doUnmock("@/lib/render");
  });
});

describe("ready notifications", () => {
  it("words done and failed jobs, and only opens app paths", async () => {
    const { jobMessage } = await import("@/lib/push");
    expect(jobMessage({ title: "Glass Tongue", status: "done", message: "Movie ready: Glass Tongue (3:02)", href: "/movie-maker" })).toEqual({ title: "Ready in Curbflix", body: "Movie ready: Glass Tongue (3:02)", url: "/movie-maker" });
    expect(jobMessage({ title: "Ep 2", status: "failed", message: "No pictures (credits refunded)", href: "https://evil.example" })).toEqual({ title: "Didn't finish", body: "Ep 2: No pictures (credits refunded)", url: "/" });
  });

  it("saves device subscriptions per person and makes VAPID keys once", async () => {
    const { asUser } = await import("@/lib/db");
    const { addSub, listSubs, removeSub, validSub, vapidKeys } = await import("@/lib/push");
    const sub = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } };
    expect(validSub(sub)).toBe(true);
    expect(validSub({ endpoint: "http://x", keys: {} })).toBe(false);
    await asUser("usr_push", () => addSub(sub));
    await asUser("usr_push", () => addSub(sub));
    expect(await asUser("usr_push", listSubs)).toHaveLength(1);
    expect(await asUser("usr_other", listSubs)).toHaveLength(0);
    await asUser("usr_push", () => removeSub(sub.endpoint));
    expect(await asUser("usr_push", listSubs)).toHaveLength(0);
    const a = await vapidKeys();
    expect((await vapidKeys()).publicKey).toBe(a.publicKey);
  });

  it("emails only long jobs, only when the person wants it and email is set up", async () => {
    vi.resetModules();
    const sendEmail = vi.fn(async () => ({ id: "1" }));
    vi.doMock("@/lib/email", () => ({ emailReady: async () => true, sendEmail }));
    vi.doMock("@/lib/auth", () => ({ getUser: async () => ({ email: "maker@example.com" }) }));
    const { asUser } = await import("@/lib/db");
    const { saveSettings } = await import("@/lib/repo");
    const { notifyFinished } = await import("@/lib/push");
    const job = { title: "Glass Tongue", status: "done" as const, message: "Movie ready", href: "/movie-maker" };
    await asUser("usr_mail", () => notifyFinished("usr_mail", { ...job, kind: "music" }));
    expect(sendEmail).not.toHaveBeenCalled();
    await asUser("usr_mail", () => notifyFinished("usr_mail", { ...job, kind: "movie" }));
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((sendEmail.mock.calls[0] as unknown as [{ to: string; text: string }])[0]).toMatchObject({ to: "maker@example.com" });
    await asUser("usr_mail", () => saveSettings({ notifyEmail: false }));
    await asUser("usr_mail", () => notifyFinished("usr_mail", { ...job, kind: "movie" }));
    expect(sendEmail).toHaveBeenCalledTimes(1);
    vi.doUnmock("@/lib/email");
    vi.doUnmock("@/lib/auth");
  });
});

describe("service worker notifications", () => {
  it("shows a pushed message and opens its page when tapped", async () => {
    const { readFileSync } = await import("node:fs");
    const vm = await import("node:vm");
    const listeners: Record<string, (e: unknown) => void> = {};
    const shown: unknown[] = [];
    const opened: string[] = [];
    const self = {
      location: { origin: "https://ghostpost.example" },
      addEventListener: (t: string, fn: (e: unknown) => void) => (listeners[t] = fn),
      registration: { showNotification: async (title: string, opts: unknown) => shown.push([title, opts]) },
      clients: { matchAll: async () => [], openWindow: async (u: string) => opened.push(u), claim: async () => {} },
      skipWaiting: () => {},
    };
    vm.runInNewContext(readFileSync("public/sw.js", "utf8"), { self, caches: {}, fetch: () => {}, URL });
    let wait: Promise<unknown> = Promise.resolve();
    listeners.push({ data: { json: () => ({ title: "Ready in Curbflix", body: "Movie ready: Glass Tongue (3:02)", url: "/movie-maker" }) }, waitUntil: (p: Promise<unknown>) => (wait = p) });
    await wait;
    expect(shown).toEqual([["Ready in Curbflix", expect.objectContaining({ body: "Movie ready: Glass Tongue (3:02)", data: { url: "/movie-maker" } })]]);
    listeners.notificationclick({ notification: { close: () => {}, data: { url: "/movie-maker" } }, waitUntil: (p: Promise<unknown>) => (wait = p) });
    await wait;
    expect(opened).toEqual(["https://ghostpost.example/movie-maker"]);
  });
});
