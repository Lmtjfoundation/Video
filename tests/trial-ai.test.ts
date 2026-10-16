import { describe, expect, it } from "vitest";
import { PLANS, TRIAL_DAILY_FREE_CREDITS, TRIAL_DAYS, introDiscount, planById } from "@/lib/plans";
import { AI_PROVIDER_IDS, AI_PROVIDERS, isAiProvider } from "@/lib/ai-providers";
import { buildCall, isKeyProblem, readText } from "@/lib/llm-providers";

describe("free trial", () => {
  it("Pro and Unlimited get 14 free days, then a $10 / $20 first month, then the regular price", () => {
    expect(planById("pro").trial).toEqual({ days: TRIAL_DAYS, firstMonth: 10 });
    expect(planById("unlimited").trial).toEqual({ days: TRIAL_DAYS, firstMonth: 20 });
    expect(TRIAL_DAYS).toBe(14);
    expect(introDiscount(planById("pro"))).toBe(planById("pro").monthly - 10);
    expect(introDiscount(planById("unlimited"))).toBe(planById("unlimited").monthly - 20);
  });

  it("Free and Creator have no trial or intro discount", () => {
    expect(planById("free").trial).toBeUndefined();
    expect(planById("creator").trial).toBeUndefined();
    expect(introDiscount(planById("creator"))).toBe(0);
  });

  it("the intro month is never free or above the regular price", () => {
    for (const p of PLANS.filter((x) => x.trial)) {
      expect(p.trial!.firstMonth).toBeGreaterThan(0);
      expect(p.trial!.firstMonth).toBeLessThan(p.monthly);
    }
  });

  it("the daily free AI allowance covers a real day of writing but stays bounded", () => {
    expect(TRIAL_DAILY_FREE_CREDITS).toBeGreaterThanOrEqual(20);
    expect(TRIAL_DAILY_FREE_CREDITS).toBeLessThanOrEqual(100);
  });
});

describe("bring your own AI", () => {
  const req = { system: "sys", user: "hello", maxTokens: 1000, temperature: 0.7 };
  const img = { mediaType: "image/png", base64: "AAAA" };

  it("lists the four providers with a default model and key page", () => {
    expect(AI_PROVIDER_IDS.sort()).toEqual(["anthropic", "gemini", "openai", "openrouter"]);
    for (const id of AI_PROVIDER_IDS) {
      expect(AI_PROVIDERS[id].defaultModel).toBeTruthy();
      expect(AI_PROVIDERS[id].keyUrl).toMatch(/^https:\/\//);
    }
    expect(isAiProvider("openai")).toBe(true);
    expect(isAiProvider("builtin")).toBe(false);
  });

  it("builds an OpenAI chat request with the key as a bearer token and images as data URLs", () => {
    const c = buildCall("openai", "sk-test", "gpt-5-mini", { ...req, images: [img] });
    expect(c.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(c.headers.Authorization).toBe("Bearer sk-test");
    const body = c.body as { model: string; messages: { role: string; content: unknown }[]; max_completion_tokens: number; temperature?: number };
    expect(body.model).toBe("gpt-5-mini");
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(JSON.stringify(body.messages[1].content)).toContain("data:image/png;base64,AAAA");
    expect(body.temperature).toBeUndefined();
    expect(body.max_completion_tokens).toBeGreaterThanOrEqual(1000);
  });

  it("builds Gemini and OpenRouter requests", () => {
    const g = buildCall("gemini", "AIza-test", "gemini-2.5-flash", req);
    expect(g.url).toContain("/models/gemini-2.5-flash:generateContent");
    expect(g.headers["x-goog-api-key"]).toBe("AIza-test");
    expect(JSON.stringify(g.body)).toContain('"systemInstruction"');
    const o = buildCall("openrouter", "sk-or-test", "openrouter/auto", req);
    expect(o.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((o.body as { model: string }).model).toBe("openrouter/auto");
  });

  it("builds a Claude request on the subscriber's own key", () => {
    const a = buildCall("anthropic", "sk-ant-test", "claude-sonnet-5-5", req);
    expect(a.headers["x-api-key"]).toBe("sk-ant-test");
    expect((a.body as { system: string }).system).toBe("sys");
  });

  it("reads the text out of each provider's response", () => {
    expect(readText("openai", { choices: [{ message: { content: "hi" } }] })).toBe("hi");
    expect(readText("openrouter", { choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }] })).toBe("ab");
    expect(readText("gemini", { candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text: "answer" }] } }] })).toBe("answer");
    expect(readText("anthropic", { content: [{ type: "text", text: "yo" }] })).toBe("yo");
    expect(readText("openai", {})).toBe("");
  });

  it("treats 401 and 403 as key problems", () => {
    expect(isKeyProblem(401)).toBe(true);
    expect(isKeyProblem(403)).toBe(true);
    expect(isKeyProblem(429)).toBe(false);
  });
});
