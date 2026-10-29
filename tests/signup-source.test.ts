import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "ghost-post-signup-src-"));
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
process.env.SETUP_CODE = "test-setup-code";
for (const k of ["SUPABASE_URL", "DATABASE_URL", "ADMIN_EMAILS", "PORT"]) delete process.env[k];

describe("sign-up source", () => {
  it("remembers the ad link a visitor came from and saves it on their new account", async () => {
    // The showcase page sets the cookie from ?src=, cleaned up.
    const { middleware } = await import("@/middleware");
    const page = await middleware(new NextRequest("https://ghostpost.example/welcome?src=TikTok!<x>"));
    expect(page.cookies.get("gp_src")?.value).toBe("tiktokx");
    // Signed-out visitors to the home page land on the showcase.
    const home = await middleware(new NextRequest("https://ghostpost.example/"));
    expect(home.headers.get("location")).toBe("https://ghostpost.example/welcome");

    const { createUser, getUser } = await import("@/lib/auth");
    await createUser({ email: "owner@example.com", password: "Correct-horse-battery-9", setupCode: "test-setup-code" });
    const { POST } = await import("@/app/api/auth/signup/route");
    const res = await POST(new Request("https://ghostpost.example/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: "theme=dark; gp_src=tiktok" },
      body: JSON.stringify({ email: "viewer@example.com", password: "Correct-horse-battery-9" }),
    }));
    expect(res.status).toBe(200);
    const { user } = (await res.json()) as { user: { id: string; signupSource?: string } };
    expect(user.signupSource).toBe("tiktok");
    expect((await getUser(user.id))!.signupSource).toBe("tiktok");

    // No link, no source.
    const plain = await createUser({ email: "plain@example.com", password: "Correct-horse-battery-9" });
    expect(plain.signupSource).toBeUndefined();
  });
});
