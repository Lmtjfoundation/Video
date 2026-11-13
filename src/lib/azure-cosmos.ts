import "server-only";
import { azureCredential } from "./azure-identity";
import { pick } from "./integrations";

/**
 * Azure Cosmos DB (SQL API, serverless) with the managed identity: motion presets, prompt templates, user projects
 * and render records, read by key in single-digit milliseconds. Containers: presets (/kind), templates (/kind),
 * projects (/ownerId), renders (/projectId).
 */
export const cosmosEndpoint = () => pick("azureCosmosEndpoint", "AZURE_COSMOS_ENDPOINT");
export const cosmosReady = async () => !!(await cosmosEndpoint());

type Container = import("@azure/cosmos").Container;
let db: { endpoint: string; get: (name: string) => Container } | null = null;

export async function cosmos(name: "presets" | "templates" | "projects" | "renders"): Promise<Container> {
  const endpoint = await cosmosEndpoint();
  if (!endpoint) throw new Error("Cosmos DB isn't connected: add its endpoint in Admin → Integrations.");
  if (db?.endpoint !== endpoint) {
    const { CosmosClient } = await import("@azure/cosmos");
    const client = new CosmosClient({ endpoint, aadCredentials: (await azureCredential()) as never });
    const database = client.database(process.env.AZURE_COSMOS_DATABASE || "ghostpost");
    db = { endpoint, get: (n) => database.container(n) };
  }
  return db.get(name);
}

export interface MotionPreset {
  id: string;
  kind: "motion";
  label: string;
  /** Added to the prompt: how things move in the shot. */
  motion: string;
  frames: number;
  steps: number;
}

/** Built-in motion presets, written to Cosmos the first time presets are read. */
export const DEFAULT_PRESETS: MotionPreset[] = [
  { id: "action-fast", kind: "motion", label: "Fast action", motion: "fast dynamic motion, intense movement, motion blur", frames: 33, steps: 8 },
  { id: "walk-talk", kind: "motion", label: "Walk and talk", motion: "walking naturally toward the camera, talking, natural gestures", frames: 49, steps: 8 },
  { id: "slow-cinematic", kind: "motion", label: "Slow cinematic", motion: "slow subtle movement, gentle camera push, breathing, blinking", frames: 49, steps: 8 },
  { id: "dance", kind: "motion", label: "Dance", motion: "dancing energetically to the beat, full body movement", frames: 49, steps: 8 },
];

export async function motionPresets(): Promise<MotionPreset[]> {
  const c = await cosmos("presets");
  const { resources } = await c.items.query<MotionPreset>({ query: "SELECT * FROM p WHERE p.kind = 'motion'" }, { partitionKey: "motion" }).fetchAll();
  if (resources.length) return resources;
  await Promise.all(DEFAULT_PRESETS.map((p) => c.items.upsert(p)));
  return DEFAULT_PRESETS;
}
