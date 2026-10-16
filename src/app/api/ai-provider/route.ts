import { authed, body, fail, ok } from "@/lib/http-api";
import { clearOwnAi, getOwnAi, ownAiStatus, saveOwnAi } from "@/lib/ai-provider";
import { AI_PROVIDERS, isAiProvider } from "@/lib/ai-providers";
import { callOwnAi, LLMError } from "@/lib/llm";
import { log } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The subscriber's own AI connection (never the key itself). */
export const GET = authed(async () => ok(await ownAiStatus()));

/** Save provider + model (+ key). Body: { provider, model?, apiKey? } */
export const PUT = authed(async (req) => {
  const b = await body<{ provider?: string; model?: string; apiKey?: string }>(req);
  if (!isAiProvider(b.provider)) return fail("Choose an AI service.");
  const key = (b.apiKey ?? "").trim();
  if (key && (key.length < 20 || key.length > 400 || /\s/.test(key))) return fail("That doesn't look like an API key. Copy the whole key with no spaces.");
  const status = await saveOwnAi(b.provider, String(b.model ?? ""), key || undefined);
  await log("info", "system", `AI switched to ${AI_PROVIDERS[b.provider].name} (${status?.model}) on your own key`);
  return ok(status);
});

/** Sends a one-line test prompt to the saved provider. */
export const POST = authed(async () => {
  const own = await getOwnAi();
  if (!own) return fail("Save an AI service and key first.");
  try {
    const text = await callOwnAi(own, { system: "You are a connection test.", user: "Reply with the single word: ready", maxTokens: 20, temperature: 0 });
    return ok({ ok: true, message: `${AI_PROVIDERS[own.provider].name} answered: “${text.trim().slice(0, 60)}”. Generating now uses your key and no credits.` });
  } catch (e) {
    return ok({ ok: false, message: e instanceof LLMError ? e.message : (e as Error).message });
  }
});

/** Go back to the app's built-in AI. */
export const DELETE = authed(async () => {
  await clearOwnAi();
  await log("info", "system", "AI switched back to the app's built-in Claude");
  return ok({ ok: true });
});
