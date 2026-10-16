import "server-only";
import { gdb } from "./db";
import { nowIso } from "./utils";

/**
 * Remembers whether Claude is currently working app-wide (e.g. out of API credits), so the owner sees it on
 * the dashboard right away — when Claude stops working, every subscriber's AI writing stops too.
 * Written only when the state changes.
 */
export interface LlmHealth {
  ok: boolean;
  message?: string;
  /** Claude is failing but the Gemini backup answered, so subscribers are not affected. */
  covered?: boolean;
  at: string;
}

const ROW = "llm_health";
let last: { ok: boolean; message?: string; covered: boolean } | null = null;

export async function recordLlmHealth(ok: boolean, message?: string, covered = false) {
  if (last && last.ok === ok && last.message === message && last.covered === covered) return;
  last = { ok, message, covered };
  try {
    await gdb().upsert("kv", { id: ROW, value: { ok, message, covered: covered || undefined, at: nowIso() } satisfies LlmHealth });
  } catch (e) {
    console.error("[nexus:llm-health]", (e as Error).message);
  }
}

export async function getLlmHealth(): Promise<LlmHealth | null> {
  const row = await gdb().get<{ id: string; value: LlmHealth }>("kv", ROW);
  return row?.value ?? null;
}
