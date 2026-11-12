import "server-only";
import { promises as fs } from "fs";
import { foundryBase } from "./azure-foundry";
import { pick } from "./integrations";
import { reasoningModel } from "./own-writer";

/**
 * Azure OpenAI Batch: the full GPT-5.4 at batch rates, for writing that can wait (a long video's outline and chapters,
 * inside a job that runs for hours anyway). Answers usually arrive in minutes, always within 24 hours. A `stateFile`
 * keeps the batch id, so a server restart picks up the same batch instead of paying for it again.
 */
export const batchDeployment = async () => (await pick("azureAiBatchDeployment", "AZURE_AI_BATCH_DEPLOYMENT")) || "gpt-5.4-batch";

async function conn() {
  const [endpoint, key] = [await pick("azureAiEndpoint", "AZURE_AI_ENDPOINT"), await pick("azureAiKey", "AZURE_AI_KEY")];
  if (!endpoint || !key) return null;
  return { base: `${foundryBase(endpoint)}/openai/v1`, headers: { Authorization: `Bearer ${key}` } };
}
export const batchReady = async () => !!(await conn()) && (await batchDeployment()) !== "off";

export interface BatchAsk {
  id: string;
  system: string;
  user: string;
  maxTokens: number;
}

const POLL_MS = 30_000;

/** Runs every request in one Azure batch; returns each answer's text by id (missing when that one failed). */
export async function runBatch(asks: BatchAsk[], o: { stateFile: string; say?: (m: string) => void; pollMs?: number; maxWaitMs?: number }): Promise<Map<string, string>> {
  const c = await conn();
  if (!c) throw new Error("Azure AI isn't set up.");
  const model = await batchDeployment();
  let batchId = await fs.readFile(o.stateFile, "utf8").then((s) => s.trim(), () => "");
  if (!batchId) {
    const lines = asks.map((a) =>
      JSON.stringify({
        custom_id: a.id,
        method: "POST",
        url: "/chat/completions",
        body: { model, messages: [{ role: "system", content: a.system }, { role: "user", content: a.user }], response_format: { type: "json_object" }, ...(reasoningModel(model) ? { max_completion_tokens: Math.max(4000, a.maxTokens * 3) } : { max_tokens: a.maxTokens }) },
      }),
    );
    const form = new FormData();
    form.set("purpose", "batch");
    form.set("file", new Blob([lines.join("\n")], { type: "application/jsonl" }), "ghost-post.jsonl");
    const up = await fetch(`${c.base}/files`, { method: "POST", headers: c.headers, body: form });
    if (!up.ok) throw new Error(`Azure batch upload failed (${up.status}): ${(await up.text()).slice(0, 200)}`);
    const file = (await up.json()) as { id: string };
    let created: Response | null = null;
    for (let i = 0; i < 10; i++) {
      created = await fetch(`${c.base}/batches`, { method: "POST", headers: { ...c.headers, "Content-Type": "application/json" }, body: JSON.stringify({ input_file_id: file.id, endpoint: "/chat/completions", completion_window: "24h" }) });
      if (created.ok) break;
      await new Promise((r) => setTimeout(r, 5000)); // the file can take a few seconds to be ready
    }
    if (!created?.ok) throw new Error(`Azure batch couldn't start (${created?.status}): ${(await created?.text())?.slice(0, 200)}`);
    batchId = ((await created.json()) as { id: string }).id;
    await fs.writeFile(o.stateFile, batchId);
  }
  const started = Date.now();
  for (;;) {
    const b = (await (await fetch(`${c.base}/batches/${batchId}`, { headers: c.headers })).json()) as { status: string; output_file_id?: string; request_counts?: { completed?: number; total?: number }; errors?: unknown };
    if (b.status === "completed") {
      const out = new Map<string, string>();
      if (b.output_file_id) {
        const text = await (await fetch(`${c.base}/files/${b.output_file_id}/content`, { headers: c.headers })).text();
        for (const line of text.split("\n").filter(Boolean)) {
          const r = JSON.parse(line) as { custom_id: string; response?: { status_code?: number; body?: { choices?: { message?: { content?: string } }[] } } };
          const content = r.response?.body?.choices?.[0]?.message?.content;
          if (r.response?.status_code === 200 && content) out.set(r.custom_id, content);
        }
      }
      await fs.rm(o.stateFile, { force: true });
      return out;
    }
    if (["failed", "expired", "cancelled", "cancelling"].includes(b.status)) {
      await fs.rm(o.stateFile, { force: true });
      throw new Error(`Azure batch ${b.status}.`);
    }
    if (Date.now() - started > (o.maxWaitMs ?? 26 * 3600_000)) throw new Error("Azure batch took too long.");
    o.say?.(`GPT-5.4 is writing (${b.request_counts?.completed ?? 0} of ${b.request_counts?.total ?? asks.length} done)…`);
    await new Promise((r) => setTimeout(r, o.pollMs ?? (Number(process.env.AZURE_BATCH_POLL_MS) || POLL_MS)));
  }
}
