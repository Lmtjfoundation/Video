import { authed, fail, ok } from "@/lib/http-api";
import { deleteFile, listMedia, signedUrl, storeFile, usedBytes } from "@/lib/media";
import { planById } from "@/lib/plans";
import { log } from "@/lib/repo";
import { db } from "@/lib/db";
import type { MediaItem } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** List uploads with short-lived preview links, plus storage usage. */
export const GET = authed(async (_req, user) => {
  const items = await listMedia();
  const used = items.reduce((s, m) => s + m.size, 0);
  return ok({
    items: items.map((m) => ({ ...m, url: signedUrl(user.id, m.id, 3600) })),
    usedBytes: used,
    limitBytes: planById(user.plan).storageMb * 1024 * 1024,
  });
});

/** Upload one or more files (multipart field "files"). */
export const POST = authed(async (req, user) => {
  const form = await req.formData().catch(() => null);
  if (!form) return fail("Send the files as multipart form data.");
  const files = form.getAll("files").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f);
  if (!files.length) return fail("Choose at least one file.");
  const limit = planById(user.plan).storageMb * 1024 * 1024;
  let used = await usedBytes();
  const saved: MediaItem[] = [];
  const errors: string[] = [];
  for (const f of files.slice(0, 20)) {
    if (used + f.size > limit) {
      errors.push(`${f.name}: storage full on your plan (${planById(user.plan).storageMb.toLocaleString()} MB).`);
      continue;
    }
    try {
      const item = await storeFile(user.id, { name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) });
      saved.push(item);
      used += item.size;
    } catch (e) {
      errors.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  if (saved.length) await log("info", "system", `Uploaded ${saved.length} file${saved.length > 1 ? "s" : ""}`);
  return ok({ saved: saved.map((m) => ({ ...m, url: signedUrl(user.id, m.id, 3600) })), errors });
});

export const DELETE = authed(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  const item = id ? await db().get<MediaItem>("media", id) : null;
  if (!item) return fail("File not found.", 404);
  await deleteFile(item);
  return ok({ ok: true });
});
