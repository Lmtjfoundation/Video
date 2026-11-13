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
const apimHeaders = async () => ({ Authorization: `Bearer ${await azureToken("https://management.azure.com/.default")}` });

/** Where model calls go and how they're signed: APIM with the managed identity when set, else the endpoint + key. */
export async function foundryAuth(): Promise<{ base: string; headers: Record<string, string>; via: "apim" | "key" } | null> {
  const apim = await apimUrl();
  if (apim) return { base: `${apim}/ai`, headers: await apimHeaders(), via: "apim" };
  const [endpoint, key] = [await pick("azureAiEndpoint", "AZURE_AI_ENDPOINT"), await pick("azureAiKey", "AZURE_AI_KEY")];
  if (!endpoint || !key) return null;
  const u = new URL(endpoint.trim());
  return { base: `${u.protocol}//${u.host}`, headers: { "api-key": key }, via: "key" };
}

/** Speech (voices, Talking Presenter): APIM's speech route with the managed identity, else the regional endpoint + key. */
export async function speechAuth(kind: "tts" | "avatar"): Promise<{ url: string; headers: Record<string, string> } | null> {
  const apim = await apimUrl();
  if (apim) return { url: kind === "tts" ? `${apim}/speech/tts/cognitiveservices/v1` : `${apim}/speech/avatar/batchsyntheses`, headers: await apimHeaders() };
  const key = await pick("azureAiKey", "AZURE_AI_KEY");
  if (!key) return null;
  const region = (await pick("azureAiRegion", "AZURE_AI_REGION")) || "eastus2";
  return {
    url: kind === "tts" ? `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1` : `https://${region}.api.cognitive.microsoft.com/avatar/batchsyntheses`,
    headers: { "Ocp-Apim-Subscription-Key": key },
  };
}
