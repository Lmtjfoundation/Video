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
  /** Tenant isolation: every job, record and file is keyed by tenant + user. */
  tenantId: string;
  plan: string;
  /** The motion preset's own wording, added by the Function's prompt enrichment. */
  presetMotion?: string;
  projectId?: string;
  /** The still to animate: "container/path.jpg" in the storage account. */
  imageBlob: string;
  prompt: string;
  presetId?: string;
  settings?: { frames?: number; steps?: number; seed?: number; grade?: "teal_orange" | "mono_accent"; accent?: string; speed?: boolean; lowCost?: boolean };
}

export async function enqueueRender(r: RenderRequest) {
  const account = await blobAccountName();
  if (!account) throw new Error("The render queue isn't connected: add the storage account name in Admin → Integrations.");
  const { QueueClient } = await import("@azure/storage-queue");
  const q = new QueueClient(`https://${account}.queue.core.windows.net/render-jobs`, (await azureCredential()) as never);
  const job = { id: randomUUID(), projectId: r.projectId || "default", userId: r.ownerId, ...r };
  await q.sendMessage(Buffer.from(JSON.stringify(job)).toString("base64"));
  void trackEvent("RenderQueued", { renderId: job.id, tenantId: r.tenantId, userId: r.ownerId, plan: r.plan, projectId: job.projectId, kind: r.kind, prompt: r.prompt, presetId: r.presetId ?? "", settings: r.settings ?? {} });
  return { id: job.id, projectId: job.projectId, tenantId: r.tenantId };
}

export interface RenderRecord {
  id: string;
  tenantId: string;
  userId: string;
  projectId: string;
  status: "queued" | "waiting" | "dispatched" | "running" | "done" | "failed" | "rejected";
  enrichedPrompt?: string;
  model?: string | null;
  seconds?: number | null;
  costUsd?: number | null;
  motionScore?: number | null;
  hls?: string | null;
  prompt: string;
  settings: Record<string, unknown>;
  blob?: string | null;
  url?: string | null;
  error?: string | null;
}

/** A render's record within the caller's tenant (another tenant's id finds nothing), or null while it's still queued. */
export async function renderStatus(id: string, tenantId: string): Promise<RenderRecord | null> {
  const { resource } = await (await cosmos("jobs")).item(id, tenantId).read<RenderRecord>();
  return resource ?? null;
}
