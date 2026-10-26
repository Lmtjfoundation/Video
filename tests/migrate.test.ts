import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-migrate-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "MOVED_TO"]) delete process.env[k];

describe("moving to a new server", () => {
  it("gives the settings and files once per code, never files outside the data folder, and then sends visitors on", async () => {
    mkdirSync(path.join(dir, "uploads", "usr_1"), { recursive: true });
    writeFileSync(path.join(dir, "uploads", "usr_1", "a.png"), "png");
    mkdirSync(path.join(dir, "models"), { recursive: true });
    writeFileSync(path.join(dir, "models", "big.onnx"), "cache");
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_123";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.PATH_LIKE_THING = "not carried";
    const m = await import("@/lib/migrate");
    await expect(m.exportManifest("not-the-code-not-the-code")).rejects.toThrow(/isn't valid/);
    const { code } = await m.createMigrateCode();
    await expect(m.exportFile(code, "uploads/usr_1/a.png")).rejects.toThrow(/expired/); // not claimed yet
    const man = await m.exportManifest(code);
    expect(man.storage).toBe("local");
    expect(man.env).toMatchObject({ ANTHROPIC_API_KEY: "sk-ant-test", STRIPE_PRICE_PRO_MONTHLY: "price_123", ENCRYPTION_KEY: process.env.ENCRYPTION_KEY });
    expect(man.env.PATH_LIKE_THING).toBeUndefined();
    expect(man.env.DATA_DIR).toBeUndefined();
    const paths = man.files.map((f) => f.path);
    expect(paths).toContain("uploads/usr_1/a.png");
    expect(paths).toContain("db.json");
    expect(paths.some((p) => p.startsWith("models/"))).toBe(false); // caches download again by themselves
    await expect(m.exportManifest(code)).rejects.toThrow(/already used/);
    const f = await m.exportFile(code, "uploads/usr_1/a.png");
    expect(f.size).toBe(3);
    await expect(m.exportFile(code, "../../etc/passwd")).rejects.toThrow(/Not a file/);
    await expect(m.markMoved(code, "http://example.com")).rejects.toThrow(/https/);
    expect(await m.movedTo()).toBeNull();
    await m.markMoved(code, "https://ghostpost.20-83-160-3.sslip.io/anything");
    expect(await m.movedTo()).toBe("https://ghostpost.20-83-160-3.sslip.io");
  });

  it("writes settings the service manager reads back exactly", async () => {
    const { envLine } = await import("@/lib/migrate");
    expect(envLine("A", 'x"y\\z\nw')).toBe('A="x\\"y\\\\z\\nw"');
  });
});
