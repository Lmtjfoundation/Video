import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-templates-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL"]) delete process.env[k];
const probe = (f: string, what: string) => execFileSync("ffprobe", ["-v", "error", "-show_entries", what, "-of", "csv=p=0", f]).toString().trim();

describe("video templates", () => {
  it("renders every template, on a color, in each shape", { timeout: 180_000 }, async () => {
    const { asUser } = await import("@/lib/db");
    const { renderTemplate, TEMPLATE_DEFS, wrap } = await import("@/lib/video-templates");
    expect(wrap("one two three four five", 9)).toBe("one two\nthree\nfour five");
    const user = "usr_tpl";
    await asUser(user, async () => {
      for (const [i, d] of TEMPLATE_DEFS.entries()) {
        const aspect = ["9:16", "16:9", "1:1"][i % 3];
        const m = await renderTemplate(user, { template: d.id, values: { title: "It's 100% \"real\": 50/50, isn't it?" }, aspect, accent: "#ff3366", background: { type: "color", color: "#101828" } });
        const f = path.join(dir, "uploads", user, m.storagePath.split("/")[1]);
        expect(Number(probe(f, "format=duration"))).toBeCloseTo(d.seconds, 0);
        const [w, h] = probe(f, "stream=width,height").split(",").map(Number);
        expect(w / h).toBeCloseTo(aspect === "9:16" ? 9 / 16 : aspect === "16:9" ? 16 / 9 : 1, 2);
      }
    });
  });

  it("makes see-through overlays as ProRes 4444 with alpha", { timeout: 60_000 }, async () => {
    const { asUser } = await import("@/lib/db");
    const { renderTemplate } = await import("@/lib/video-templates");
    const user = "usr_tpl2";
    const m = await asUser(user, () => renderTemplate(user, { template: "lower-third", values: { name: "Tasha Grant", role: "Owner, Tasha's Boutique" }, aspect: "16:9", background: { type: "transparent" } }));
    expect(m.type).toBe("video/quicktime");
    expect(m.name).toBe("template-lower-third-16x9-overlay.mov");
    const f = path.join(dir, "uploads", user, m.storagePath.split("/")[1]);
    expect(probe(f, "stream=codec_name,pix_fmt")).toMatch(/^prores,yuva444p1[02]le$/); // 4:4:4 with alpha
  });

  it("refuses an unknown template", async () => {
    const { asUser } = await import("@/lib/db");
    const { renderTemplate } = await import("@/lib/video-templates");
    await expect(asUser("usr_tpl3", () => renderTemplate("usr_tpl3", { template: "nope", values: {}, aspect: "9:16" }))).rejects.toThrow(/Choose a template/);
  });
});
