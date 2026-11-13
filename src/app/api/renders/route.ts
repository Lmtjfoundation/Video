import { authed, body, fail, ok } from "@/lib/http-api";
import { db } from "@/lib/db";
import { readFile, storeOf } from "@/lib/media";
import { blobReady, blobUpload, blobContainerName } from "@/lib/azure-blob";
import { cosmosReady, motionPresets } from "@/lib/azure-cosmos";
import { enqueueRender, renderStatus } from "@/lib/render-queue";
import { ensureTenant, roleOf } from "@/lib/tenancy";
import { spendCredits } from "@/lib/auth";
import { CREDIT_COST } from "@/lib/plans";
import type { MediaItem } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * AI motion on Azure: animate a picture into a moving shot (at least 3 seconds at 24 fps, quality-gated, graded).
 * POST queues it and returns at once; GET ?id=… reads its status (within your tenant only); GET alone lists presets.
 * Owners and editors can render; viewers can only read.
 */
export const GET = authed(async (req, user) => {
  if (!(await cosmosReady())) return fail("AI motion isn't set up on this server yet.", 503);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return ok({ presets: await motionPresets() });
  const t = await ensureTenant(user.id, user.plan);
  const r = await renderStatus(id, t.tenantId);
  return r ? ok({ render: r }) : ok({ render: { id, status: "queued" } });
});

export const POST = authed(async (req, user) => {
  const b = await body<{ mediaId?: string; prompt?: string; presetId?: string; projectId?: string; grade?: string; accent?: string; speed?: boolean; lowCost?: boolean }>(req);
  if (!(await blobReady()) || !(await cosmosReady())) return fail("AI motion isn't set up on this server yet.", 503);
  const t = await ensureTenant(user.id, user.plan);
  if (!["owner", "editor"].includes(await roleOf(user.id, user.plan))) return fail("Viewers can watch renders but not start them. Ask the owner for editor access.", 403);
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
  const grade = b.grade === "mono_accent" ? "mono_accent" : "teal_orange";
  const job = await enqueueRender({
    kind: "ltx-image-to-video",
    ownerId: user.id,
    tenantId: t.tenantId,
    plan: t.plan,
    projectId: b.projectId ? String(b.projectId).slice(0, 80) : undefined,
    imageBlob: `${await blobContainerName()}/${item.storagePath}`,
    prompt,
    presetId: preset.id,
    presetMotion: preset.motion,
    settings: { frames: Math.max(73, preset.frames), steps: preset.steps, grade, accent: String(b.accent || "orange").replace(/[^a-z]/gi, "").slice(0, 16) || "orange", speed: b.speed === true, lowCost: b.lowCost === true },
  });
  return ok({ ...job, status: "queued", credits: CREDIT_COST.renderMid });
});
