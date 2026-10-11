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
  at: string;
}

const ROW = "llm_health";
let last: { ok: boolean; message?: string } | null = null;

export async function recordLlmHealth(ok: boolean, message?: string) {
  if (last && last.ok === ok && last.message === message) return;
  last = { ok, message };
  try {
    await gdb().upsert("kv", { id: ROW, value: { ok, message, at: nowIso() } satisfies LlmHealth });
  } catch (e) {
    console.error("[nexus:llm-health]", (e as Error).message);
  }
}

export async function getLlmHealth(): Promise<LlmHealth | null> {
  const row = await gdb().get<{ id: string; value: LlmHealth }>("kv", ROW);
  return row?.value ?? null;
}
