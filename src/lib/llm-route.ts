/**
 * Which AI answers a request, in what order. Pure (no network, no storage) so the rules are unit-tested.
 *
 * - A subscriber's own AI (Settings → AI) is decided before this, in llm.ts.
 * - Free trial: Gemini first (when the owner connected a Gemini key and left "use for free trials" on), then Claude
 *   if Gemini can't answer, so a trial never breaks. Requests that need Claude's live web search stay on Claude.
 * - Everyone else: Claude first. If Claude can't answer (no credits, key rejected, overloaded) and the owner left
 *   "backup" on, Gemini answers instead, so a Claude outage never stops subscribers.
 * - Claude not connected at all but Gemini is: Gemini answers everything.
 */
export type Engine = "claude" | "gemini";

export interface RouteInput {
  claudeConfigured: boolean;
  geminiConfigured: boolean;
  /** Owner setting: free-trial accounts use Gemini. */
  geminiForTrials: boolean;
  /** Owner setting: Gemini steps in when Claude can't answer. */
  geminiBackup: boolean;
  /** The signed-in account is on a free trial. */
  onTrial: boolean;
  /** The request asks for Claude's web search tool, which Gemini can't provide. */
  needsWebSearch: boolean;
}

export function engineOrder(i: RouteInput): Engine[] {
  if (!i.geminiConfigured) return ["claude"];
  if (!i.claudeConfigured) return ["gemini"];
  if (i.onTrial && i.geminiForTrials && !i.needsWebSearch) return ["gemini", "claude"];
  return i.geminiBackup ? ["claude", "gemini"] : ["claude"];
}

/** Claude attempts when a backup is waiting: fail over after ~10 s instead of ~95 s of retries. */
export const CLAUDE_ATTEMPTS_WITH_BACKUP = 3;
export const CLAUDE_ATTEMPTS = 6;

/**
 * Plain-language explanation of a Gemini API error for the owner (never shown to subscribers).
 * Returns null for errors that are worth retrying (429 handled by the caller, 5xx) or unknown ones.
 */
export function geminiProblem(status: number, body: string, model: string): string | null {
  if (status === 401 || status === 403 || (status === 400 && /API_KEY_INVALID|API key not valid|API key expired/i.test(body))) {
    return `Google rejected the Gemini key (${status}). Copy it again from aistudio.google.com/apikey and paste it in Admin → App settings → Integrations → Gemini.`;
  }
  if (status === 404 || (status === 400 && /model/i.test(body) && !/API key/i.test(body))) {
    return `Gemini doesn't recognize the model "${model}". Pick a current model from ai.google.dev/gemini-api/docs/models and save it in Admin → App settings → Integrations → Gemini.`;
  }
  if (status === 429) {
    return "Gemini's rate or daily limit was reached (429). Free-tier keys have small limits. Turn on billing for the key's Google Cloud project (it also stops Google using prompts to improve its products), or try again later.";
  }
  return null;
}

/** Why Gemini returned nothing, if it says (safety block etc.). */
export function geminiBlockReason(json: unknown): string {
  const j = json as { promptFeedback?: { blockReason?: string }; candidates?: { finishReason?: string }[] };
  const r = j?.promptFeedback?.blockReason || j?.candidates?.[0]?.finishReason;
  return r && r !== "STOP" ? ` (${r})` : "";
}
