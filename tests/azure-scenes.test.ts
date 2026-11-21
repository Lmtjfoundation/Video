import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { VideoPlan, VideoScene } from "@/lib/types";

/**
 * The Azure scene renderer from the app's side: Blob Storage and the queue are simulated in memory, the "workers"
 * answer the way the real ones do (clips, then status.json and final.mp4), and nothing leaves the machine.
 */
const dir = mkdtempSync(path.join(tmpdir(), "ghost-post-azure-scenes-"));
process.env.DATA_DIR = dir;
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "AZURE_AI_KEYFRAME_DEPLOYMENT"]) delete process.env[k];

const store = new Map<string, Buffer>();
const sent: string[] = [];
let workers: "ok" | "idle" = "ok";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

vi.mock("@azure/storage-blob", () => {
  const blob = (name: string) => ({
    uploadData: async (b: Buffer) => void store.set(name, Buffer.from(b)),
    uploadFile: async (f: string) => void store.set(name, readFileSync(f)),
    downloadToBuffer: async () => store.get(name)!,
    downloadToFile: async (f: string) => writeFileSync(f, store.get(name)!),
  });
  return {
    BlobServiceClient: class {
      getContainerClient() {
        return {
          getBlockBlobClient: blob,
          async *listBlobsFlat({ prefix }: { prefix: string }) {
            for (const name of [...store.keys()].filter((n) => n.startsWith(prefix))) yield { name };
          },
        };
      }
    },
  };
});
vi.mock("@azure/storage-queue", () => ({
  QueueClient: class {
    async sendMessage(m: string) {
      sent.push(m);
      if (workers !== "ok") return;
      // The GPU worker and the stitcher, as they behave in Azure.
      const { id, scene } = JSON.parse(Buffer.from(m, "base64").toString());
      const plan = JSON.parse(store.get(`${id}/plan.json`)!.toString());
      store.set(`${id}/clips/${scene}.mp4`, Buffer.from("clip"));
      if (scene === plan.scenes.length - 1) {
        store.set(`${id}/final.mp4`, Buffer.from("FINAL-MP4"));
        store.set(`${id}/status.json`, Buffer.from(JSON.stringify({ state: "done" })));
      }
    }
    async getProperties() {
      return { approximateMessagesCount: workers === "idle" ? sent.length : 0 };
    }
  },
}));
vi.mock("@/lib/azure-identity", async (orig) => ({ ...(await orig<typeof import("@/lib/azure-identity")>()), azureCredential: async () => ({}) }));
vi.mock("@/lib/own-writer", () => ({
  ownWriter: async () => ({ url: "x", key: "", model: "gpt-5.4-mini", mode: "only", only: true }),
  writeWithOwnWriter: async () =>
    JSON.stringify({
      scenes: [
        { start: "a glowing coin", end: "a tower of coins", motion: "push in", overlays: [{ text: "MONEY GROWS", start: 0.2, end: 2, y: 0.1, size: 0.08, bar: true }, { text: "", start: 0, end: 1 }] },
        { start: "a chart", end: "the chart soaring", motion: "pan up", overlays: [{ text: "x".repeat(200), start: -5, end: 99, y: 5, size: 3 }] },
      ],
    }),
}));

const scene = (n: string): VideoScene => ({ time: "", narration: n, onScreen: n.toUpperCase(), visual: n, motion: "", sfx: "", cast: [] });
const plan = { niche: "Money", style: "explainer", scenes: [] } as unknown as VideoPlan;

describe("Azure scene rendering", () => {
  it("is off until a storage account is set", async () => {
    const { azureScenesReady } = await import("@/lib/azure-scenes");
    delete process.env.AZURE_SCENES_ACCOUNT;
    expect(await azureScenesReady()).toBe(false);
    process.env.AZURE_SCENES_ACCOUNT = "Not A Name!";
    expect(await azureScenesReady()).toBe(false);
    process.env.AZURE_SCENES_ACCOUNT = "vueioscabc123";
    expect(await azureScenesReady()).toBe(true);
  });

  it("keeps titles and sizes inside safe limits", async () => {
    const { cleanOverlay, genSize, sceneMessage } = await import("@/lib/azure-scenes");
    expect(cleanOverlay({ text: "  " }, 3)).toBeNull();
    expect(cleanOverlay({ text: "Hi", start: -2, end: 50, y: 9, size: 1, x: "nope" as never }, 3)).toEqual({ text: "Hi", start: 0, end: 3, y: 0.9, size: 0.14, font: "display", x: "center", bar: false });
    expect(genSize(2160, 3840)).toEqual({ width: 720, height: 1280 });
    expect(genSize(3840, 2160)).toEqual({ width: 1280, height: 720 });
    expect(JSON.parse(Buffer.from(sceneMessage("r1", 2), "base64").toString())).toEqual({ id: "r1", scene: 2 });
  });

  it("designs, paints, queues every scene at once and downloads the stitched video", async () => {
    process.env.AZURE_SCENES_ACCOUNT = "vueioscabc123";
    store.clear();
    sent.length = 0;
    workers = "ok";
    const { renderOnAzureScenes } = await import("@/lib/azure-scenes");
    const out = path.join(dir, "final.mp4");
    const says: string[] = [];
    await renderOnAzureScenes({
      id: "post_1", plan, W: 2160, H: 3840, dir, out,
      scenes: [{ scene: scene("coins"), dur: 2.4 }, { scene: scene("chart"), dur: 3.1 }],
      say: (_p, m) => void says.push(m),
      paint: async () => PNG,
    });
    expect(readFileSync(out, "utf8")).toBe("FINAL-MP4");
    expect(sent).toHaveLength(2); // both scenes queued, so two GPUs render them at the same time
    const rid = JSON.parse(Buffer.from(sent[0], "base64").toString()).id as string;
    const saved = JSON.parse(store.get(`${rid}/plan.json`)!.toString());
    expect(saved.size).toEqual({ width: 2160, height: 3840 });
    expect(saved.gen).toMatchObject({ width: 720, height: 1280 });
    expect(saved.scenes.map((s: { seconds: number }) => s.seconds)).toEqual([2.4, 3.1]);
    expect(saved.scenes[0]).toMatchObject({ start: `${rid}/keys/0-start.png`, end: `${rid}/keys/0-end.png` });
    expect(saved.overlays.map((o: { text: string; scene: number }) => [o.scene, o.text.length])).toEqual([[0, 11], [1, 60]]);
    expect(store.has(`${rid}/keys/1-end.png`)).toBe(true);
    expect(says.some((m) => /in parallel/.test(m))).toBe(true);
  });

  it("gives up quickly when no GPU picks the scenes up, so the render can fall back", async () => {
    store.clear();
    sent.length = 0;
    workers = "idle";
    vi.useFakeTimers({ toFake: ["Date", "setTimeout"] });
    try {
      const { renderOnAzureScenes } = await import("@/lib/azure-scenes");
      const run = renderOnAzureScenes({ id: "post_2", plan, W: 2160, H: 3840, dir, out: path.join(dir, "x.mp4"), scenes: [{ scene: scene("a"), dur: 2 }], say: () => {}, paint: async () => PNG });
      const failed = expect(run).rejects.toThrow(/didn't start/);
      let settled = false;
      run.catch(() => {}).finally(() => (settled = true));
      for (let i = 0; i < 40 && !settled; i++) await vi.advanceTimersByTimeAsync(15_000);
      await failed;
    } finally {
      vi.useRealTimers();
    }
  }, 30_000);
});
