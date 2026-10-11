import "server-only";
import { sleep } from "./utils";
import { anthropicKey } from "./integrations";

const API_URL = "https://api.anthropic.com/v1/messages";

export class LLMError extends Error {}

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
}

export async function llmConfigured() {
  return !!(await anthropicKey());
}

/** Calls the Claude Messages API with retries on rate limits / overload. */
export async function claude({ system, user, maxTokens = 2500, temperature = 0.85, images, model: modelOverride }: CallOpts): Promise<string> {
  const apiKey = await anthropicKey();
  if (!apiKey) throw new LLMError("Claude isn't connected yet. The admin adds the Claude API key in Admin → App settings → Integrations.");
  const model = modelOverride || process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  const content = images?.length
    ? [...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.base64 } })), { type: "text", text: user }]
    : user;

  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: "user", content }],
      }),
    });

    if (res.ok) {
      const json = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = (json.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      if (!text.trim()) throw new LLMError("Model returned an empty response.");
      return text;
    }

    lastErr = `${res.status} ${(await res.text()).slice(0, 400)}`;
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * 2 ** attempt);
      continue;
    }
    break;
  }
  throw new LLMError(`Claude API error: ${lastErr}`);
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
    if (!(e instanceof LLMError) || /API error|not set/.test(e.message)) throw e;
    // One repair attempt with a stricter instruction.
    return parseJson<T>(
      await claude({ ...opts, temperature: 0.4, user: opts.user + "\n\nReturn ONLY valid JSON. No prose, no code fences." }),
    );
  }
}
