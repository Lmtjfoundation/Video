import "server-only";
import { getIntegrations, pick } from "./integrations";

/**
 * Ghost Post's own writer: an open AI model the app owner runs (deploy/azure-app/install.sh puts Qwen3-4B on the
 * Azure server's processor with Ollama), reached through the OpenAI Chat Completions format. It writes before Claude
 * and Gemini, so writing needs no outside AI credits. The same setting can point at Azure OpenAI's /openai/v1 endpoint
 * or any other OpenAI-compatible service later.
 */
export type OwnWriterMode = "first" | "backup" | "only";

export interface OwnWriter {
  url: string;
  key: string;
  model: string;
  /** When it writes: after Claude and Gemini (backup), before them (first), or alone (only). */
  mode: OwnWriterMode;
  /** Never fall back to Claude or Gemini (mode "only"). */
  only: boolean;
}

const MODES: OwnWriterMode[] = ["first", "backup", "only"];

/**
 * The admin's choice (Admin → Integrations → Own writer), else OWN_WRITER_MODE, else the older "only" switch. With
 * none set, Claude or Gemini write first when either key is there (better writing), the own writer covers when they fail.
 */
export async function ownWriterMode(i?: Awaited<ReturnType<typeof getIntegrations>>): Promise<OwnWriterMode> {
  const s = i ?? (await getIntegrations());
  const chosen = [s.ownWriterMode, process.env.OWN_WRITER_MODE?.trim().toLowerCase()].find((m): m is OwnWriterMode => MODES.includes(m as OwnWriterMode));
  if (chosen) return chosen;
  if (s.ownWriterOnly === true || ["1", "true"].includes(process.env.OWN_WRITER_ONLY ?? "")) return "only";
  const [anthropic, gemini] = await Promise.all([pick("anthropicKey", "ANTHROPIC_API_KEY"), pick("geminiKey", "GEMINI_API_KEY")]);
  return anthropic || gemini ? "backup" : "first";
}

export async function ownWriter(): Promise<OwnWriter | null> {
  const [url, key, model, i] = await Promise.all([pick("ownWriterUrl", "OWN_WRITER_URL"), pick("ownWriterKey", "OWN_WRITER_KEY"), pick("ownWriterModel", "OWN_WRITER_MODEL"), getIntegrations()]);
  if (!url) return null;
  const mode = await ownWriterMode(i);
  return { url: url.replace(/\/+$/, ""), key, model: model || "qwen3:4b-instruct-2507-q4_K_M", mode, only: mode === "only" };
}

export class OwnWriterError extends Error {}

/** Writes one answer. `json`: the model must answer with a JSON object (the server enforces it). */
export async function writeWithOwnWriter(w: OwnWriter, o: { system: string; user: string; maxTokens: number; temperature: number; json?: boolean }, timeoutMs = 10 * 60_000): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${w.url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(w.key ? { Authorization: `Bearer ${w.key}` } : {}) },
      body: JSON.stringify({
        model: w.model,
        messages: [
          { role: "system", content: o.system },
          { role: "user", content: o.user },
        ],
        max_tokens: o.maxTokens,
        temperature: o.temperature,
        ...(o.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new OwnWriterError(`Ghost Post's own writer didn't answer at ${w.url} (${(e as Error).message}).`);
  }
  if (res.status === 401 || res.status === 403) throw new OwnWriterError("Ghost Post's own writer rejected its key. Check it in Admin → App settings → Integrations → Own writer.");
  if (!res.ok) throw new OwnWriterError(`Ghost Post's own writer answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const j = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
  // Some open models think out loud first; only the answer is kept.
  const text = (j?.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!text) throw new OwnWriterError("Ghost Post's own writer returned nothing.");
  return text;
}

/** Admin → Integrations → Own writer → Test: one short sentence, and how long it took. */
export async function testOwnWriter(): Promise<{ ok: boolean; message: string }> {
  const w = await ownWriter();
  if (!w) return { ok: false, message: "Add the writer's address first." };
  const t = Date.now();
  try {
    const text = await writeWithOwnWriter(w, { system: "You are a helpful writer.", user: "Write one short friendly sentence welcoming a new subscriber.", maxTokens: 60, temperature: 0.7 }, 120_000);
    return { ok: true, message: `Connected: ${w.model} answered in ${((Date.now() - t) / 1000).toFixed(1)} s: “${text.slice(0, 160)}”` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
