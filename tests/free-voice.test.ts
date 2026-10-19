import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("free voice (Kokoro)", () => {
  it("picks a voice that fits the plan's voice note", async () => {
    const { kokoroVoice } = await import("@/lib/free-voice");
    expect(kokoroVoice("Warm female narrator")).toBe("af_heart");
    expect(kokoroVoice("young, upbeat woman")).toBe("af_bella");
    expect(kokoroVoice("Deep, gravelly male storyteller")).toBe("am_onyx");
    expect(kokoroVoice("British male documentary voice")).toBe("bm_george");
    expect(kokoroVoice("")).toBe("am_michael");
  });

  it.skipIf(!process.env.TEST_FREE_VOICE)("speaks a line into a WAV file (downloads the model; set TEST_FREE_VOICE=1)", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    process.env.DATA_DIR = fs.mkdtempSync(`${os.tmpdir()}/nexus-voice-`);
    const { freeVoice } = await import("@/lib/free-voice");
    const file = `${process.env.DATA_DIR}/line.wav`;
    await freeVoice("The porch light stays on.", file, "warm male narrator");
    expect(fs.statSync(file).size).toBeGreaterThan(20_000);
  }, 300_000);
});
