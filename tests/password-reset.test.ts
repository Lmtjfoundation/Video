import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "ghost-post-reset-"));
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "RESEND_API_KEY", "EMAIL_FROM", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_PORT"]) delete process.env[k];

const sent: Record<string, unknown>[] = [];
const transports: Record<string, unknown>[] = [];
vi.mock("nodemailer", () => ({
  default: {
    createTransport: (o: Record<string, unknown>) => {
      transports.push(o);
      return { sendMail: async (m: Record<string, unknown>) => (sent.push(m), { messageId: "<m1>" }) };
    },
  },
}));

describe("forgot password", () => {
  it("is off until a mail account is added, then sends through it", async () => {
    const { emailReady } = await import("@/lib/email");
    expect(await emailReady()).toBe(false);
    const { saveIntegrations } = await import("@/lib/integrations");
    await saveIntegrations({ smtpHost: "smtp.gmail.com", smtpPort: "587", smtpUser: "owner@gmail.com", smtpPass: "abcdefghijklmnop" });
    vi.resetModules(); // the integrations cache lasts 15 s; a fresh module reads the saved account
    const fresh = await import("@/lib/email");
    expect(await fresh.emailReady()).toBe(true);
    await fresh.sendEmail({ to: "maker@example.com", subject: "Reset your Vueio password", text: "link", html: "<p>link</p>" });
    expect(transports.at(-1)).toMatchObject({ host: "smtp.gmail.com", port: 587, secure: false, auth: { user: "owner@gmail.com", pass: "abcdefghijklmnop" } });
    expect(sent.at(-1)).toMatchObject({ from: "owner@gmail.com", to: "maker@example.com", subject: "Reset your Vueio password" });
  });

  it("an admin reset link sets a new password, once", async () => {
    const { createUser, issueResetToken, resetPassword, login } = await import("@/lib/auth");
    const u = await createUser({ email: "owner@example.com", password: "Owner-pass-1234!", name: "Owner" });
    const token = await issueResetToken(u.id);
    await resetPassword(token, "Brand-new-pass-987!");
    await expect(login("owner@example.com", "Brand-new-pass-987!")).resolves.toBeTruthy();
    await expect(resetPassword(token, "Another-pass-555!")).rejects.toThrow(/expired or was already used/);
  });
});

describe("owner recovery", () => {
  it("clears the sign-in lock and gives a working reset link", async () => {
    const { createUser, login, recoverAccount, resetPassword } = await import("@/lib/auth");
    await createUser({ email: "locked@example.com", password: "Right-pass-1234!", name: "Locked" }).catch(() => null);
    for (let i = 0; i < 5; i++) await login("locked@example.com", "wrong-pass-0000").catch(() => {});
    await expect(login("locked@example.com", "Right-pass-1234!")).rejects.toThrow(/Too many attempts/);
    const r = await recoverAccount("Locked@Example.com");
    expect(r?.user.email).toBe("locked@example.com");
    await resetPassword(r!.token, "Fresh-pass-2468!");
    await expect(login("locked@example.com", "Fresh-pass-2468!")).resolves.toBeTruthy();
    expect(await recoverAccount("nobody@example.com")).toBeNull();
  });
});
