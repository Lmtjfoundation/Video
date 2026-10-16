import "server-only";
import { sleep } from "./utils";
import { anthropicHeaders, anthropicKey, anthropicWorkspaceHint } from "./integrations";
import { recordLlmHealth } from "./llm-health";
import { getOwnAi, type OwnAi } from "./ai-provider";
import { AI_PROVIDERS } from "./ai-providers";
import { buildCall, isKeyProblem, readText } from "./llm-providers";

const API_URL = "https://api.anthropic.com/v1/messages";

/**
 * `message` is safe for any subscriber. `ownerMessage` (setup, billing or API details) is shown to admins instead.
 */
export class LLMError extends Error {
  ownerMessage?: string;
  constructor(message: string, ownerMessage?: string) {
    super(message);
    this.ownerMessage = ownerMessage;
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
  return !!(await anthropicKey()) || !!(await getOwnAi());
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

/** Calls the subscriber's own AI if they connected one, otherwise the Claude Messages API, with retries on rate limits / overload. */
export async function claude(opts: CallOpts): Promise<string> {
  const own = await getOwnAi();
  if (own) return callOwnAi(own, opts);
  const { system, user, maxTokens = 2500, temperature = 0.85, images, model: modelOverride, webSearch } = opts;
  const apiKey = await anthropicKey();
  if (!apiKey) {
    const owner = "Claude isn't connected yet. Add the Claude API key in Admin → App settings → Integrations.";
    await recordLlmHealth(false, owner);
    throw new LLMError(UNAVAILABLE, owner);
  }
  const model = modelOverride || process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  const content = images?.length
    ? [...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.base64 } })), { type: "text", text: user }]
    : user;

  const headers = { ...(await anthropicHeaders(apiKey)), "content-type": "application/json" };
  let useSearch = !!webSearch?.domains.length && webSearchAvailable();
  const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content }];
  let collected = "";
  let lastErr = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(API_URL, {
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

    if (res.ok) {
      await recordLlmHealth(true);
      const json = (await res.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string };
      collected += (json.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      // A long web-search turn can pause; hand the partial turn back so Claude finishes it.
      if (json.stop_reason === "pause_turn" && attempt < 5) {
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
      await recordLlmHealth(false, owner);
      throw new LLMError(UNAVAILABLE, owner);
    }
    lastErr = `${res.status} ${errText.slice(0, 400)}`;
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * 2 ** attempt);
      continue;
    }
    break;
  }
  throw new LLMError("AI writing failed this time. Please try again.", `Claude API error: ${lastErr}`);
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
    if (!(e instanceof LLMError) || /API error|not set|Settings → AI/.test(e.message)) throw e;
    // One repair attempt with a stricter instruction.
    return parseJson<T>(
      await claude({ ...opts, temperature: 0.4, user: opts.user + "\n\nReturn ONLY valid JSON. No prose, no code fences." }),
    );
  }
}
