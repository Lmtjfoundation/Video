import "server-only";
import { sleep } from "./utils";
import { anthropicHeaders, anthropicKey, anthropicWorkspaceHint, ownerGemini, type OwnerGemini } from "./integrations";
import { recordLlmHealth } from "./llm-health";
import { getOwnAi, type OwnAi } from "./ai-provider";
import { AI_PROVIDERS } from "./ai-providers";
import { buildCall, isKeyProblem, readText } from "./llm-providers";
import { CLAUDE_ATTEMPTS, CLAUDE_ATTEMPTS_WITH_BACKUP, engineOrder, geminiBlockReason, geminiProblem, type Engine } from "./llm-route";
import { currentUserId } from "./db";
import { getUser, trialActive } from "./auth";

const API_URL = "https://api.anthropic.com/v1/messages";

/**
 * `message` is safe for any subscriber. `ownerMessage` (setup, billing or API details) is shown to admins instead.
 */
export class LLMError extends Error {
  ownerMessage?: string;
  /**
   * Set when the AI service itself couldn't answer (not connected, no credits, key rejected, overloaded): another AI
   * service can step in, and asking again with the same service would fail the same way.
   * "config" = the owner has to fix something (shown on the dashboard); "busy" = probably passing.
   */
  kind?: "config" | "busy";
  constructor(message: string, ownerMessage?: string, kind?: "config" | "busy") {
    super(message);
    this.ownerMessage = ownerMessage;
    this.kind = kind;
  }
}

const UNAVAILABLE = "AI writing is temporarily unavailable. Please try again in a little while.";

export interface ImageInput {
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  base64: string;
}

interface CallOpts {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** Optional images shown to Claude before the text (max 5 MB each). */
  images?: ImageInput[];
  /** Override the model for this call (e.g. the strongest model on the Unlimited plan). */
  model?: string;
  /**
   * Let Claude check live reporting with Anthropic's web search tool, limited to these domains. Only used on the
   * app's own Claude key (subscribers' own AI keys get the feed reporting only). Falls back to a normal call when
   * web search isn't enabled for the organization.
   */
  webSearch?: { domains: string[]; maxUses?: number };
}

/** Set when the API refuses the web search tool (not enabled for the org), so we stop asking for an hour. */
let webSearchOffUntil = 0;
export const webSearchAvailable = () => Date.now() > webSearchOffUntil;

export async function llmConfigured() {
  return !!(await anthropicKey()) || !!(await ownerGemini()) || !!(await getOwnAi());
}

/**
 * Calls the subscriber's own AI service (Settings → AI). Errors here are about their key or their account with
 * that provider, so the message is written for them, and the app's Claude health status isn't touched.
 */
export async function callOwnAi(own: OwnAi, { system, user, maxTokens = 2500, temperature = 0.85, images }: CallOpts): Promise<string> {
  const name = AI_PROVIDERS[own.provider].name;
  const call = buildCall(own.provider, own.apiKey, own.model, { system, user, maxTokens, temperature, images });
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response;
    try {
      res = await fetch(call.url, { method: "POST", headers: call.headers, body: JSON.stringify(call.body) });
    } catch {
      lastErr = "network error";
      await sleep(1500 * 2 ** attempt);
      continue;
    }
    if (res.ok) {
      const text = readText(own.provider, await res.json().catch(() => ({})));
      if (!text.trim()) throw new LLMError(`${name} returned an empty answer. Try again, or pick a different model in Settings → AI.`);
      return text;
    }
    const errText = await res.text();
    const badKey = isKeyProblem(res.status) || (own.provider === "gemini" && res.status === 400 && /API_KEY_INVALID|API key not valid/i.test(errText));
    if (badKey) throw new LLMError(`${name} rejected your API key (${res.status}). Check it in Settings → AI.`);
    if (res.status === 404 || (res.status === 400 && /model/i.test(errText))) {
      throw new LLMError(`${name} doesn't recognize the model "${own.model}". Check the model name in Settings → AI.`);
    }
    if (res.status === 402) throw new LLMError(`Your ${name} account is out of credit. Add funds with ${name}, or switch back to the app's AI in Settings → AI.`);
    lastErr = `${res.status} ${errText.slice(0, 300)}`;
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 1500 * 2 ** attempt);
      continue;
    }
    break;
  }
  throw new LLMError(`${name} couldn't write this time (${lastErr.slice(0, 160)}). Try again, or check Settings → AI.`);
}

/** True while the signed-in account is on a free trial (background jobs with no signed-in user are not). */
async function onFreeTrial() {
  const id = currentUserId();
  if (!id) return false;
  try {
    const u = await getUser(id);
    return !!u && trialActive(u);
  } catch {
    return false;
  }
}

/**
 * Calls the app's own Gemini key (Admin → Integrations → Gemini). Errors are written for the owner, never the
 * subscriber, and don't touch Claude's health status. Web search isn't available here.
 */
export async function callGemini(g: Pick<OwnerGemini, "key" | "model">, { system, user, maxTokens = 2500, temperature = 0.85, images }: CallOpts): Promise<string> {
  const call = buildCall("gemini", g.key, g.model, { system, user, maxTokens, temperature, images });
  const attempts = 3;
  let lastErr = "";
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 0; attempt < attempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(call.url, { method: "POST", headers: call.headers, body: JSON.stringify(call.body) });
    } catch (e) {
      lastErr = `network error: ${(e as Error).message}`;
      if (attempt < attempts - 1) await sleep(1500 * 2 ** attempt);
      continue;
    }
    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      const text = readText("gemini", json);
      if (!text.trim()) throw new LLMError(UNAVAILABLE, `Gemini returned an empty answer${geminiBlockReason(json)}.`, "busy");
      return text;
    }
    lastStatus = res.status;
    lastBody = await res.text();
    lastErr = `${res.status} ${lastBody.replace(/\s+/g, " ").slice(0, 300)}`;
    const retryable = res.status === 429 || res.status === 503 || res.status >= 500;
    if (!retryable) {
      const problem = geminiProblem(res.status, lastBody, g.model);
      throw new LLMError(UNAVAILABLE, problem ?? `Gemini error: ${lastErr}`, problem ? "config" : "busy");
    }
    if (attempt < attempts - 1) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 20) * 1000 : 1500 * 2 ** attempt);
    }
  }
  const problem = lastStatus ? geminiProblem(lastStatus, lastBody, g.model) : null;
  throw new LLMError(UNAVAILABLE, problem ?? `Gemini couldn't write this time (${lastErr}).`, "busy");
}

/** One Claude Messages API request (with retries on rate limits and overload). Throws LLMError with `kind` set when Claude itself can't answer. */
async function callClaude(opts: CallOpts, maxAttempts: number): Promise<string> {
  const { system, user, maxTokens = 2500, temperature = 0.85, images, model: modelOverride, webSearch } = opts;
  const apiKey = await anthropicKey();
  if (!apiKey) throw new LLMError(UNAVAILABLE, "Claude isn't connected yet. Add the Claude API key in Admin → App settings → Integrations.", "config");
  const model = modelOverride || process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  const content = images?.length
    ? [...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.base64 } })), { type: "text", text: user }]
    : user;

  const headers = { ...(await anthropicHeaders(apiKey)), "content-type": "application/json" };
  let useSearch = !!webSearch?.domains.length && webSearchAvailable();
  const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content }];
  let collected = "";
  let lastErr = "";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          max_tokens: maxTokens + (useSearch ? 2000 : 0),
          temperature,
          system,
          messages,
          ...(useSearch
            ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: webSearch!.maxUses ?? 3, allowed_domains: webSearch!.domains }] }
            : {}),
        }),
      });
    } catch (e) {
      lastErr = `network error: ${(e as Error).message}`;
      if (attempt < maxAttempts - 1) await sleep(1500 * 2 ** attempt);
      continue;
    }

    if (res.ok) {
      await recordLlmHealth(true);
      const json = (await res.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string };
      collected += (json.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      // A long web-search turn can pause; hand the partial turn back so Claude finishes it.
      if (json.stop_reason === "pause_turn" && attempt < maxAttempts - 1) {
        messages.push({ role: "assistant", content: json.content ?? [] });
        continue;
      }
      if (!collected.trim()) throw new LLMError("Model returned an empty response.");
      return collected;
    }

    const errText = await res.text();
    if (useSearch && res.status === 400 && /web_search|tool/i.test(errText)) {
      webSearchOffUntil = Date.now() + 3600_000;
      useSearch = false;
      continue;
    }
    const hint = anthropicWorkspaceHint(res.status, errText);
    if (hint || res.status === 401 || res.status === 403) {
      const owner = hint ?? `Claude rejected the API key (${res.status}). Check it in Admin → App settings → Integrations.`;
      throw new LLMError(UNAVAILABLE, owner, "config");
    }
    lastErr = `${res.status} ${errText.slice(0, 400)}`;
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      if (attempt < maxAttempts - 1) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 1500 * 2 ** attempt);
      }
      continue;
    }
    break;
  }
  throw new LLMError("AI writing failed this time. Please try again.", `Claude API error: ${lastErr}`, "busy");
}

/**
 * Writes with the right AI, so subscribers never need an AI account of their own:
 * their own AI if they connected one (Settings → AI); otherwise the app's Claude, with the app's Gemini key taking
 * free trials and stepping in whenever Claude can't answer (see llm-route.ts for the order).
 */
export async function claude(opts: CallOpts): Promise<string> {
  const own = await getOwnAi();
  if (own) return callOwnAi(own, opts);

  const gemini = await ownerGemini();
  const claudeConfigured = !!(await anthropicKey());
  const order = engineOrder({
    claudeConfigured,
    geminiConfigured: !!gemini,
    geminiForTrials: !!gemini?.forTrials,
    geminiBackup: !!gemini?.backup,
    onTrial: gemini ? await onFreeTrial() : false,
    needsWebSearch: !!opts.webSearch?.domains.length,
  });

  let claudeErr: LLMError | null = null;
  let firstErr: unknown = null;
  for (let i = 0; i < order.length; i++) {
    const engine: Engine = order[i];
    const hasNext = i < order.length - 1;
    try {
      if (engine === "gemini") {
        const text = await callGemini(gemini!, opts);
        // Claude failed first and Gemini covered for it: tell the owner without alarming subscribers.
        if (claudeErr?.kind === "config") await recordLlmHealth(false, `${claudeErr.ownerMessage} Gemini is covering for now, so subscribers can still generate.`, true);
        return text;
      }
      return await callClaude(opts, hasNext ? CLAUDE_ATTEMPTS_WITH_BACKUP : CLAUDE_ATTEMPTS);
    } catch (e) {
      firstErr ??= e;
      if (engine === "claude" && e instanceof LLMError) claudeErr = e;
      const canMove = hasNext && (engine === "gemini" || (e instanceof LLMError && !!e.kind));
      if (!canMove) {
        // Nothing could answer: a Claude problem the owner must fix goes on the dashboard.
        if (claudeErr?.kind === "config") await recordLlmHealth(false, claudeErr.ownerMessage);
        throw claudeErr ?? e;
      }
      console.warn(`[llm] ${engine} couldn't answer (${e instanceof LLMError ? e.ownerMessage ?? e.message : (e as Error).message}); trying ${order[i + 1]}.`);
    }
  }
  throw firstErr instanceof Error ? firstErr : new LLMError("AI writing failed this time. Please try again.");
}

/** Extracts and parses the first JSON object/array in a model response. */
export function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.search(/[\[{]/);
  if (start === -1) throw new LLMError("Model response contained no JSON.");
  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  const end = cleaned.lastIndexOf(close);
  if (end <= start) throw new LLMError("Model response JSON was incomplete.");
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    throw new LLMError("Model response JSON could not be parsed.");
  }
}

export async function claudeJson<T>(opts: CallOpts): Promise<T> {
  try {
    return parseJson<T>(await claude(opts));
  } catch (e) {
    if (!(e instanceof LLMError) || e.kind || /API error|not set|Settings → AI/.test(e.message)) throw e;
    // One repair attempt with a stricter instruction.
    return parseJson<T>(
      await claude({ ...opts, temperature: 0.4, user: opts.user + "\n\nReturn ONLY valid JSON. No prose, no code fences." }),
    );
  }
}
