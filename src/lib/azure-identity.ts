import "server-only";
import { pick } from "./integrations";

/**
 * Keyless Azure: the app signs in with the server's managed identity (on an Azure VM it comes from the instance
 * metadata service; locally, `az login` works too). With it set up, model calls go through Azure API Management
 * (one endpoint, rate limits and caching; APIM signs in to Foundry and Speech with its own identity) and storage,
 * queues and Cosmos DB use Microsoft Entra roles. No keys are stored or sent. Without it, the older endpoint + key
 * settings keep working.
 */
type TokenCredential = { getToken(scopes: string | string[]): Promise<{ token: string; expiresOnTimestamp: number } | null> };

let cred: TokenCredential | null = null;
export async function azureCredential(): Promise<TokenCredential> {
  if (!cred) {
    const { DefaultAzureCredential } = await import("@azure/identity");
    cred = new DefaultAzureCredential();
  }
  return cred;
}

const cache = new Map<string, { token: string; exp: number }>();
/** A bearer token for `scope`, reused until 5 minutes before it expires. */
export async function azureToken(scope: string): Promise<string> {
  const hit = cache.get(scope);
  if (hit && hit.exp - 300_000 > Date.now()) return hit.token;
  const t = await (await azureCredential()).getToken(scope);
  if (!t) throw new Error("The server's managed identity didn't return a token. Check that it's switched on for this VM.");
  cache.set(scope, { token: t.token, exp: t.expiresOnTimestamp });
  return t.token;
}

/** The API Management gateway, e.g. https://ghostpost-apim-2114.azure-api.net (Admin → Integrations, or AZURE_APIM_URL). */
export const apimUrl = async () => (await pick("azureApimUrl", "AZURE_APIM_URL")).replace(/\/+$/, "");
/** APIM accepts the app's managed identity: a token for Azure Resource Manager, checked against the app's client id. */
const apimHeaders = async () => {
  const { tenantHeaders } = await import("./tenancy");
  return { Authorization: `Bearer ${await azureToken("https://management.azure.com/.default")}`, ...(await tenantHeaders()) };
};

/**
 * Direct keyless access (no API Management): the server's managed identity signs in to the Azure AI resource itself.
 * Needs the endpoint, this switch (Admin, or AZURE_AI_IDENTITY=1) and the identity's "Cognitive Services User" and
 * "Cognitive Services OpenAI User" roles on the resource. Voices also need the resource's ID (azureAiResourceId).
 */
export const aiIdentity = async () => ["1", "true", "on"].includes((await pick("azureAiIdentity", "AZURE_AI_IDENTITY")).trim().toLowerCase());
const COGNITIVE = "https://cognitiveservices.azure.com/.default";

/**
 * Where model calls go and how they're signed: APIM with the managed identity when set, else the endpoint + key, else
 * the endpoint with the managed identity's own token.
 */
export async function foundryAuth(): Promise<{ base: string; headers: Record<string, string>; via: "apim" | "key" | "identity" } | null> {
  const apim = await apimUrl();
  if (apim) return { base: `${apim}/ai`, headers: await apimHeaders(), via: "apim" };
  const [endpoint, key] = [await pick("azureAiEndpoint", "AZURE_AI_ENDPOINT"), await pick("azureAiKey", "AZURE_AI_KEY")];
  if (!endpoint) return null;
  const u = new URL(endpoint.trim());
  if (key) return { base: `${u.protocol}//${u.host}`, headers: { "api-key": key }, via: "key" };
  if (!(await aiIdentity())) return null;
  return { base: `${u.protocol}//${u.host}`, headers: { Authorization: `Bearer ${await azureToken(COGNITIVE)}` }, via: "identity" };
}

/**
 * Speech (voices, Talking Presenter): APIM's speech route with the managed identity, else the regional endpoint + key,
 * else the regional endpoint with the managed identity (Speech wants "aad#<resource id>#<token>").
 */
export async function speechAuth(kind: "tts" | "avatar"): Promise<{ url: string; headers: Record<string, string> } | null> {
  const apim = await apimUrl();
  if (apim) return { url: kind === "tts" ? `${apim}/speech/tts/cognitiveservices/v1` : `${apim}/speech/avatar/batchsyntheses`, headers: await apimHeaders() };
  const region = (await pick("azureAiRegion", "AZURE_AI_REGION")) || "eastus2";
  const url = kind === "tts" ? `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1` : `https://${region}.api.cognitive.microsoft.com/avatar/batchsyntheses`;
  const key = await pick("azureAiKey", "AZURE_AI_KEY");
  if (key) return { url, headers: { "Ocp-Apim-Subscription-Key": key } };
  const resourceId = (await pick("azureAiResourceId", "AZURE_AI_RESOURCE_ID")).trim();
  if (!resourceId || !(await aiIdentity())) return null;
  return { url, headers: { Authorization: `Bearer aad#${resourceId}#${await azureToken(COGNITIVE)}` } };
}
