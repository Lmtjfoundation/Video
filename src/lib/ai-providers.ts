/**
 * "Bring your own AI": the AI services a subscriber can plug in with their own API key.
 * Shared by the server and the Settings page (no secrets here).
 *
 * Model names change often, so each provider has an editable default and the user can type any model the
 * provider offers. Calls made on a subscriber's own key are billed by that provider, so they use no credits.
 */
export type AiProvider = "anthropic" | "openai" | "gemini" | "openrouter";

export interface AiProviderInfo {
  id: AiProvider;
  name: string;
  /** Shown under the picker. */
  blurb: string;
  defaultModel: string;
  modelHint: string;
  keyPrefix?: string;
  keyUrl: string;
}

export const AI_PROVIDERS: Record<AiProvider, AiProviderInfo> = {
  anthropic: {
    id: "anthropic",
    name: "Claude (your own Anthropic key)",
    blurb: "The same AI the app uses, billed to your own Anthropic account.",
    defaultModel: "claude-sonnet-5-5",
    modelHint: "Any model from docs.claude.com → Models, e.g. claude-sonnet-5-5 or claude-opus-5-5.",
    keyPrefix: "sk-ant-",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  openai: {
    id: "openai",
    name: "ChatGPT (OpenAI)",
    blurb: "OpenAI's GPT models, billed to your OpenAI API account (separate from a ChatGPT Plus subscription).",
    defaultModel: "gpt-5-mini",
    modelHint: "Any chat model on platform.openai.com → Models, e.g. gpt-5 or gpt-5-mini.",
    keyPrefix: "sk-",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    blurb: "Google's Gemini models through Google AI Studio. Has a free tier with daily limits.",
    defaultModel: "gemini-2.5-flash",
    modelHint: "Any model on ai.google.dev → Models, e.g. gemini-2.5-flash or gemini-2.5-pro.",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter (hundreds of models)",
    blurb: "One key for models from OpenAI, Google, Meta, Mistral, DeepSeek, xAI and more. 'openrouter/auto' picks one for you.",
    defaultModel: "openrouter/auto",
    modelHint: "Any model id from openrouter.ai/models, e.g. openai/gpt-5 or google/gemini-2.5-pro.",
    keyPrefix: "sk-or-",
    keyUrl: "https://openrouter.ai/keys",
  },
};

export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AiProvider[];
export const isAiProvider = (v: unknown): v is AiProvider => typeof v === "string" && v in AI_PROVIDERS;

/** What the browser may see about a subscriber's own AI connection. */
export interface OwnAiStatus {
  provider: AiProvider;
  model: string;
  keyPreview: string;
  updatedAt: string;
}
