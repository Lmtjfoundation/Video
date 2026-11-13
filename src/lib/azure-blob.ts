import "server-only";
import { BlobSASPermissions, BlobServiceClient, generateBlobSASQueryParameters, SASProtocol, type ContainerClient, type UserDelegationKey } from "@azure/storage-blob";
import { azureCredential } from "./azure-identity";
import { pick } from "./integrations";

/**
 * Azure Blob Storage buckets for Ghost Post's media: every new upload and every video Ghost Post makes is kept here
 * when the owner connects a storage account (Admin → Integrations → Azure storage, or AZURE_STORAGE_CONNECTION_STRING).
 * Files are private; people get them through short-lived signed links straight from Azure, which stream and seek
 * without the app holding a multi-gigabyte movie in memory.
 */
export const blobConnection = () => pick("azureStorageConnection", "AZURE_STORAGE_CONNECTION_STRING");
export const blobContainerName = async () => (await pick("azureStorageContainer", "AZURE_STORAGE_CONTAINER")) || "media";
/** Keyless: the storage account's name, reached with the server's managed identity (Storage Blob Data Contributor). */
export const blobAccountName = () => pick("azureStorageAccount", "AZURE_STORAGE_ACCOUNT");

let cached: { conn: string; name: string; client: ContainerClient; service: BlobServiceClient; identity: boolean } | null = null;

export async function blobContainer(): Promise<ContainerClient | null> {
  const [conn, name, account] = [await blobConnection(), await blobContainerName(), await blobAccountName()];
  const key = conn || (account ? `identity:${account}` : "");
  if (!key) return null;
  if (cached?.conn === key && cached.name === name) return cached.client;
  const identity = !conn;
  const service = identity ? new BlobServiceClient(`https://${account}.blob.core.windows.net`, await azureCredential() as never) : BlobServiceClient.fromConnectionString(conn);
  const client = service.getContainerClient(name);
  cached = { conn: key, name, client, service, identity };
  return client;
}

export const blobReady = async () => !!((await blobConnection()) || (await blobAccountName()));

/** A user delegation key (signed by Microsoft Entra for the managed identity), reused until an hour before it expires. */
let udk: { key: UserDelegationKey; exp: number } | null = null;
async function delegationKey(service: BlobServiceClient) {
  if (udk && udk.exp - 3600_000 > Date.now()) return udk.key;
  const start = new Date(Date.now() - 5 * 60_000), end = new Date(Date.now() + 6 * 3600_000);
  udk = { key: await service.getUserDelegationKey(start, end), exp: end.getTime() };
  return udk.key;
}

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
  const opts = {
    permissions: BlobSASPermissions.parse("r"),
    startsOn: new Date(Date.now() - 5 * 60_000),
    expiresOn: new Date(Date.now() + Math.min(ttlSec, 5 * 3600) * 1000),
    ...(download ? { contentDisposition: `attachment; filename="${download}"` } : {}),
  };
  const blob = c.getBlockBlobClient(storagePath);
  if (!cached?.identity) return blob.generateSasUrl(opts);
  // Keyless: signed with a user delegation key from the managed identity, not the account key.
  const sas = generateBlobSASQueryParameters({ ...opts, containerName: c.containerName, blobName: storagePath, protocol: SASProtocol.Https }, await delegationKey(cached.service), c.accountName);
  return `${blob.url}?${sas.toString()}`;
}

/** Admin → Integrations → Azure storage → Test: writes, reads and removes a tiny file. */
export async function testBlob(): Promise<{ ok: boolean; message: string }> {
  try {
    const c = await blobContainer();
    if (!c) return { ok: false, message: "Add the storage account name (managed identity) or its connection string first." };
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
