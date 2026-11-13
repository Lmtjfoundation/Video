import { authed, body, fail, ok } from "@/lib/http-api";
import { db } from "@/lib/db";
import { readFile, storeOf } from "@/lib/media";
import { blobContainerName, blobReady, blobUpload } from "@/lib/azure-blob";
import { cosmosReady, motionPresets } from "@/lib/azure-cosmos";
import { enqueueRender, renderStatus } from "@/lib/render-queue";
import { spendCredits } from "@/lib/auth";
import { CREDIT_COST } from "@/lib/plans";
import type { MediaItem } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * AI motion on Azure: animate a picture into a short moving clip (people walk, talk, fight).
 * POST queues it and returns at once; GET ?id=…&projectId=… reads its status; GET alone lists the motion presets.
 */
export const GET = authed(async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!(await cosmosReady())) return fail("AI motion isn't set up on this server yet.", 503);
  if (!id) return ok({ presets: await motionPresets() });
  const r = await renderStatus(id, url.searchParams.get("projectId") || "none");
  return ok({ render: r ?? { id, status: "queued" } });
});

export const POST = authed(async (req, user) => {
  const b = await body<{ mediaId?: string; prompt?: string; presetId?: string; projectId?: string }>(req);
  if (!(await blobReady()) || !(await cosmosReady())) return fail("AI motion isn't set up on this server yet.", 503);
  const prompt = String(b.prompt ?? "").trim().slice(0, 1500);
  if (!b.mediaId) return fail("Pick a picture to animate.");
  if (!prompt) return fail("Describe how it should move.");
  const item = await db().get<MediaItem>("media", String(b.mediaId));
  if (!item || item.kind !== "image") return fail("That picture isn't in your library.");
  const presets = await motionPresets();
  const preset = presets.find((p) => p.id === b.presetId) ?? presets[0];
  // The workers read the still from Blob Storage: copy it there if it's kept elsewhere.
  if (storeOf(item) !== "azure") await blobUpload(item.storagePath, await readFile(item), item.type);
  await spendCredits(user.id, CREDIT_COST.renderMid);
  const job = await enqueueRender({
    kind: "ltx-image-to-video",
    ownerId: user.id,
    projectId: b.projectId ? String(b.projectId).slice(0, 80) : undefined,
    imageBlob: `${await blobContainerName()}/${item.storagePath}`,
    prompt: `${prompt} ${preset.motion}.`,
    presetId: preset.id,
    settings: { frames: preset.frames, steps: preset.steps },
  });
  return ok({ ...job, status: "queued", credits: CREDIT_COST.renderMid });
});
