import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-co-owner-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
process.env.SETUP_CODE = "test-setup-code";
for (const k of ["SUPABASE_URL", "DATABASE_URL", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "VIDEO_ENGINE_URL", "VIDEO_ENGINE_TOKEN", "ADMIN_EMAILS"]) delete process.env[k];

describe("co-owner access", () => {
  it("gives admin access and unlimited use in one step, and the owner can't be removed", async () => {
    const { createUser, getUser, spendCredits } = await import("@/lib/auth");
    const { adminUpdateUser, adminUsers } = await import("@/lib/admin");
    const owner = await createUser({ email: "owner@example.com", password: "Correct-horse-battery-9", setupCode: "test-setup-code" });
    await new Promise((r) => setTimeout(r, 5));
    const friend = await createUser({ email: "friend@example.com", password: "Correct-horse-battery-9" });
    expect(owner.role).toBe("admin");
    expect(friend.role).toBe("user");

    await adminUpdateUser((await getUser(owner.id))!, { id: friend.id, makeCoOwner: true });
    const f = (await getUser(friend.id))!;
    expect(f.role).toBe("admin");
    expect(f.plan).toBe("unlimited");
    // Admins never spend credits.
    await expect(spendCredits(f.id, 100_000)).resolves.toBeTypeOf("number");

    const rows = await adminUsers();
    expect(rows.find((r) => r.id === owner.id)).toMatchObject({ isOwner: true, isCoOwner: false });
    expect(rows.find((r) => r.id === friend.id)).toMatchObject({ isOwner: false, isCoOwner: true });

    // A co-owner can't take the owner's access away.
    await expect(adminUpdateUser(f, { id: owner.id, role: "user" })).rejects.toThrow(/owner/);
    await expect(adminUpdateUser(f, { id: owner.id, status: "suspended" })).rejects.toThrow(/owner/);
    // The owner can still take co-owner access back.
    await adminUpdateUser((await getUser(owner.id))!, { id: friend.id, role: "user" });
    expect((await getUser(friend.id))!.role).toBe("user");
  });

  it("answers 503 with Retry-After (not 502) when an AI service is down", async () => {
    const { handle } = await import("@/lib/http-api");
    const { LLMError } = await import("@/lib/llm");
    const res = await handle(async () => {
      throw new LLMError("AI writing is temporarily unavailable.", "Claude: no credits", "config");
    })();
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("600");
    expect(((await res.json()) as { error: string }).error).toContain("temporarily unavailable");
  });
});
