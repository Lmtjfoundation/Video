// Shared helpers: everything authenticates with the Function App's managed identity (no keys).
const { DefaultAzureCredential } = require("@azure/identity");
const { CosmosClient } = require("@azure/cosmos");
const { QueueServiceClient } = require("@azure/storage-queue");

const credential = new DefaultAzureCredential();
const env = (k, d = "") => process.env[k] || d;

let cosmos;
function renders() {
  cosmos ??= new CosmosClient({ endpoint: env("COSMOS_ENDPOINT"), aadCredentials: credential });
  return cosmos.database(env("COSMOS_DATABASE", "ghostpost")).container("renders");
}

let queues;
function queue(name) {
  queues ??= new QueueServiceClient(env("RenderQueue__queueServiceUri"), credential);
  return queues.getQueueClient(name);
}

/** Azure Resource Manager call with the managed identity. */
async function arm(method, path, body) {
  const { token } = await credential.getToken("https://management.azure.com/.default");
  const res = await fetch(`https://management.azure.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 202) throw new Error(`ARM ${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 202 || res.status === 204 ? null : res.json();
}

const RG = () => `/subscriptions/${env("SUBSCRIPTION_ID")}/resourceGroups/${env("WORKER_RESOURCE_GROUP", "GHOSTPOST")}`;

/** Render VMs: every VM in the resource group tagged role=render-worker, with its power state. */
async function workers() {
  const list = await arm("GET", `${RG()}/providers/Microsoft.Compute/virtualMachines?api-version=2024-07-01`);
  const tagged = (list.value || []).filter((v) => (v.tags || {}).role === "render-worker");
  return Promise.all(
    tagged.map(async (v) => {
      const iv = await arm("GET", `${RG()}/providers/Microsoft.Compute/virtualMachines/${v.name}/instanceView?api-version=2024-07-01`);
      const power = (iv.statuses || []).map((s) => s.code).find((c) => c.startsWith("PowerState/")) || "PowerState/unknown";
      return { name: v.name, power: power.split("/")[1] };
    }),
  );
}
const vmAction = (name, action) => arm("POST", `${RG()}/providers/Microsoft.Compute/virtualMachines/${name}/${action}?api-version=2024-07-01`);

module.exports = { credential, env, renders, queue, workers, vmAction };
