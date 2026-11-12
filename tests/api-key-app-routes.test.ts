import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "ghost-post-key-routes-"));
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
process.env.SETUP_CODE = "test-setup-code";
for (const k of ["SUPABASE_URL", "DATABASE_URL"]) delete process.env[k];

const ctx = () => ({ params: Promise.resolve({}) });
const get = (url: string, key?: string) => new Request(`http://app.test${url}`, { headers: key ? { Authorization: `Bearer ${key}` } : {} });

describe("API keys on the app's own tools (the command-line tool)", () => {
  it("signs in with a key on tool routes, but never on account, key or admin routes", async () => {
    const { createUser } = await import("@/lib/auth");
    const { asUser } = await import("@/lib/db");
    const { createKey } = await import("@/lib/api-keys");
    const owner = await createUser({ email: "cli@example.com", password: "Correct-horse-battery-9", setupCode: "test-setup-code" });
    const { key } = await asUser(owner.id, () => createKey(owner.id, "CLI"));

    const media = await import("@/app/api/media/route");
    expect((await media.GET(get("/api/media"), ctx())).status).toBe(401);
    expect((await media.GET(get("/api/media", "gp_live_" + "x".repeat(32)), ctx())).status).toBe(401);
    const ok = await media.GET(get("/api/media", key), ctx());
    expect(ok.status).toBe(200);

    // A leaked key can't mint more keys or reach the owner's admin pages.
    const dev = await import("@/app/api/developers/route");
    expect((await dev.GET(get("/api/developers", key), ctx())).status).toBe(403);
    const admin = await import("@/app/api/admin/integrations/route");
    expect((await admin.GET(get("/api/admin/integrations", key), ctx())).status).toBe(403);
  });
});
