import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "ghost-post-film-import-"));
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
process.env.CRON_SECRET = "test-cron-secret";
for (const k of ["SUPABASE_URL", "DATABASE_URL"]) delete process.env[k];

const film = {
  title: "Same Numbers", format: "series", genre: "Crime", logline: "A janitor's numbers hit.",
  characters: [{ name: "Marcus Hale", role: "Janitor", look: "gray coveralls" }],
  scenes: [{ number: 1, heading: "EP1 · INT. SCHOOL - NIGHT", summary: "Marcus mops." }],
  episodes: ["Episode 1: Same Numbers."], episodePlans: ["1. [0:00–0:05] Line.\n   Visual: Hallway."], pages: { "1": "INT. SCHOOL - NIGHT\n\nMarcus mops." },
};

describe("import a finished series into someone's Writers' Room", () => {
  it("needs the server secret, saves for that account, and keeps the episode plans", async () => {
    const { createUser } = await import("@/lib/auth");
    const { asUser } = await import("@/lib/db");
    const { listFilms } = await import("@/lib/writers-room");
    const { POST } = await import("@/app/api/cron/import-film/route");
    const u = await createUser({ email: "writer@example.com", password: "Writer-pass-1234!", name: "Writer" });
    const call = (auth: string, b: unknown) => POST(new Request("http://x/api/cron/import-film", { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(b) }));
    expect((await call("Bearer nope", { email: "writer@example.com", film })).status).toBe(401);
    expect((await call("Bearer test-cron-secret", { email: "nobody@example.com", film })).status).toBe(404);
    expect((await call("Bearer test-cron-secret", { email: "writer@example.com", film: { title: "x" } })).status).toBe(400);
    const r = await call("Bearer test-cron-secret", { email: "writer@example.com", film });
    expect(r.status).toBe(200);
    const saved = (await asUser(u.id, listFilms))[0];
    expect(saved).toMatchObject({ title: "Same Numbers", format: "series", episodes: ["Episode 1: Same Numbers."] });
    expect(saved.episodePlans?.[0]).toMatch(/Visual: Hallway/);
    expect(saved.pages["1"]).toMatch(/Marcus mops/);
  });
});
