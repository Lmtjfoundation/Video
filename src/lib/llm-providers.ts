/**
 * Request builders and response readers for the non-Claude AI services a subscriber can plug in.
 * Pure functions (no network), so they're unit-tested; llm.ts does the fetch, retries and error handling.
 */
import type { AiProvider } from "./ai-providers";

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  images?: { mediaType: string; base64: string }[];
}

export interface HttpCall {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Reasoning models (GPT-5, Gemini 2.5) spend part of the output budget thinking before they write, so they get
 * more room than the visible answer needs. Only what the model actually generates is billed.
 */
const roomy = (n: number) => Math.max(n * 3, 8192);

export function buildCall(provider: AiProvider, apiKey: string, model: string, r: LlmRequest): HttpCall {
  if (provider === "anthropic") {
    const content = r.images?.length
      ? [...r.images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.base64 } })), { type: "text", text: r.user }]
      : r.user;
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: { model, max_tokens: r.maxTokens, temperature: r.temperature, system: r.system, messages: [{ role: "user", content }] },
    };
  }

  if (provider === "gemini") {
    const parts = [...(r.images ?? []).map((i) => ({ inline_data: { mime_type: i.mediaType, data: i.base64 } })), { text: r.user }];
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: {
        systemInstruction: { parts: [{ text: r.system }] },
        contents: [{ role: "user", parts }],
        generationConfig: { maxOutputTokens: roomy(r.maxTokens), temperature: r.temperature },
      },
    };
  }

  // OpenAI and OpenRouter share the Chat Completions format.
  const userContent = r.images?.length
    ? [...r.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mediaType};base64,${i.base64}` } })), { type: "text", text: r.user }]
    : r.user;
  const messages = [
    { role: "system", content: r.system },
    { role: "user", content: userContent },
  ];
  if (provider === "openai") {
    // Newer OpenAI models only accept the default temperature, so it isn't sent.
    return {
      url: "https://api.openai.com/v1/chat/completions",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: { model, messages, max_completion_tokens: roomy(r.maxTokens) },
    };
  }
  return {
    url: "https://openrouter.ai/api/v1/chat/completions",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json", "X-Title": "Nexus Pulse" },
    body: { model, messages, max_tokens: roomy(r.maxTokens), temperature: r.temperature },
  };
}

/** Pulls the generated text out of each provider's response shape. */
export function readText(provider: AiProvider, json: unknown): string {
  const j = json as Record<string, unknown>;
  if (provider === "anthropic") {
    const blocks = (j.content as { type: string; text?: string }[] | undefined) ?? [];
    return blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  }
  if (provider === "gemini") {
    const cands = (j.candidates as { content?: { parts?: { text?: string; thought?: boolean }[] } }[] | undefined) ?? [];
    return (cands[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  }
  const choices = (j.choices as { message?: { content?: string | { type?: string; text?: string }[] | null } }[] | undefined) ?? [];
  const c = choices[0]?.message?.content;
  if (Array.isArray(c)) return c.map((p) => p.text ?? "").join("");
  return c ?? "";
}

/** Status codes that mean the key itself is wrong, revoked or not allowed to use the model. */
export const isKeyProblem = (status: number) => status === 401 || status === 403;
