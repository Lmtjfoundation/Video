import "server-only";
import { BlobSASPermissions, BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import { pick } from "./integrations";

/**
 * Azure Blob Storage buckets for Ghost Post's media: every new upload and every video Ghost Post makes is kept here
 * when the owner connects a storage account (Admin → Integrations → Azure storage, or AZURE_STORAGE_CONNECTION_STRING).
 * Files are private; people get them through short-lived signed links straight from Azure, which stream and seek
 * without the app holding a multi-gigabyte movie in memory.
 */
export const blobConnection = () => pick("azureStorageConnection", "AZURE_STORAGE_CONNECTION_STRING");
export const blobContainerName = async () => (await pick("azureStorageContainer", "AZURE_STORAGE_CONTAINER")) || "media";

let cached: { conn: string; name: string; client: ContainerClient } | null = null;

export async function blobContainer(): Promise<ContainerClient | null> {
  const [conn, name] = [await blobConnection(), await blobContainerName()];
  if (!conn) return null;
  if (cached?.conn === conn && cached.name === name) return cached.client;
  const client = BlobServiceClient.fromConnectionString(conn).getContainerClient(name);
  cached = { conn, name, client };
  return client;
}

export const blobReady = async () => !!(await blobConnection());

export async function blobUpload(storagePath: string, bytes: Buffer, contentType: string) {
  const c = await blobContainer();
  if (!c) throw new Error("Azure storage isn't connected.");
  await c.getBlockBlobClient(storagePath).uploadData(bytes, { blobHTTPHeaders: { blobContentType: contentType }, concurrency: 4 });
}

/** A large file from disk, sent in blocks (a 90-minute movie never sits in memory). */
export async function blobUploadFile(storagePath: string, file: string, contentType: string) {
  const c = await blobContainer();
  if (!c) throw new Error("Azure storage isn't connected.");
  await c.getBlockBlobClient(storagePath).uploadFile(file, { blobHTTPHeaders: { blobContentType: contentType }, blockSize: 8 * 1024 * 1024, concurrency: 4 });
}

export async function blobDownload(storagePath: string): Promise<Buffer> {
  const c = await blobContainer();
  if (!c) throw new Error("Azure storage isn't connected.");
  return c.getBlockBlobClient(storagePath).downloadToBuffer();
}

export async function blobDownloadToFile(storagePath: string, file: string) {
  const c = await blobContainer();
  if (!c) throw new Error("Azure storage isn't connected.");
  await c.getBlockBlobClient(storagePath).downloadToFile(file);
}

export async function blobDelete(storagePath: string) {
  const c = await blobContainer();
  if (c) await c.getBlockBlobClient(storagePath).deleteIfExists();
}

/** A signed, read-only link to the file, valid for `ttlSec` (streams and seeks; ?dl names the download). */
export async function blobReadUrl(storagePath: string, ttlSec: number, download?: string): Promise<string> {
  const c = await blobContainer();
  if (!c) throw new Error("Azure storage isn't connected.");
  return c.getBlockBlobClient(storagePath).generateSasUrl({
    permissions: BlobSASPermissions.parse("r"),
    startsOn: new Date(Date.now() - 5 * 60_000),
    expiresOn: new Date(Date.now() + ttlSec * 1000),
    ...(download ? { contentDisposition: `attachment; filename="${download}"` } : {}),
  });
}

/** Admin → Integrations → Azure storage → Test: writes, reads and removes a tiny file. */
export async function testBlob(): Promise<{ ok: boolean; message: string }> {
  try {
    const c = await blobContainer();
    if (!c) return { ok: false, message: "Add the storage account's connection string first." };
    await c.createIfNotExists();
    const p = `_ghost-post-test/${Date.now()}.txt`;
    await blobUpload(p, Buffer.from("ok"), "text/plain");
    const back = (await blobDownload(p)).toString();
    await blobDelete(p);
    return back === "ok" ? { ok: true, message: `Connected: files are kept in the "${c.containerName}" bucket of ${c.accountName}.` } : { ok: false, message: "The test file came back different." };
  } catch (e) {
    return { ok: false, message: (e as Error).message.slice(0, 300) };
  }
}
