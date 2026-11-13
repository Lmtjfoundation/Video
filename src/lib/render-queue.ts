import "server-only";
import { randomUUID } from "crypto";
import { azureCredential } from "./azure-identity";
import { blobAccountName } from "./azure-blob";
import { cosmos } from "./azure-cosmos";
import { trackEvent } from "./telemetry";

/**
 * Renders on Azure without blocking the app: a request goes onto the "render-jobs" queue (Azure Queue Storage) and
 * the call returns at once. An Azure Function picks it up, records it in Cosmos DB, starts a render VM if none is on,
 * and a worker on that VM renders it, stores it in Blob Storage and reports back. The app reads the status from Cosmos.
 */
export interface RenderRequest {
  kind: "ltx-image-to-video";
  ownerId: string;
  projectId?: string;
  /** The still to animate: "container/path.jpg" in the storage account. */
  imageBlob: string;
  prompt: string;
  presetId?: string;
  settings?: { frames?: number; steps?: number; seed?: number };
}

export async function enqueueRender(r: RenderRequest) {
  const account = await blobAccountName();
  if (!account) throw new Error("The render queue isn't connected: add the storage account name in Admin → Integrations.");
  const { QueueClient } = await import("@azure/storage-queue");
  const q = new QueueClient(`https://${account}.queue.core.windows.net/render-jobs`, (await azureCredential()) as never);
  const job = { id: randomUUID(), projectId: r.projectId || `owner-${r.ownerId}`, ...r };
  await q.sendMessage(Buffer.from(JSON.stringify(job)).toString("base64"));
  void trackEvent("RenderQueued", { renderId: job.id, ownerId: r.ownerId, projectId: job.projectId, kind: r.kind, prompt: r.prompt, presetId: r.presetId ?? "", settings: r.settings ?? {} });
  return { id: job.id, projectId: job.projectId };
}

export interface RenderRecord {
  id: string;
  projectId: string;
  ownerId: string;
  status: "queued" | "running" | "done" | "failed";
  prompt: string;
  settings: Record<string, unknown>;
  blob?: string | null;
  url?: string | null;
  error?: string | null;
}

/** A render's record, or null while the Function hasn't written it yet (it's still on the queue). */
export async function renderStatus(id: string, projectId: string): Promise<RenderRecord | null> {
  const { resource } = await (await cosmos("renders")).item(id, projectId).read<RenderRecord>();
  return resource ?? null;
}
