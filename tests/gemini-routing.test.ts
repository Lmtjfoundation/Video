import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_ATTEMPTS, CLAUDE_ATTEMPTS_WITH_BACKUP, engineOrder, geminiBlockReason, geminiProblem, type RouteInput } from "@/lib/llm-route";
import { AI_PROVIDERS } from "@/lib/ai-providers";
import { buildCall } from "@/lib/llm-providers";

const dir = mkdtempSync(path.join(tmpdir(), "nexus-gemini-"));
process.env.DATA_DIR = dir;
process.env.SETUP_CODE = "test-setup-code";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);
for (const k of ["SUPABASE_URL", "DATABASE_URL", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GEMINI_MODEL", "ANTHROPIC_MODEL"]) delete process.env[k];

// Retries wait seconds in real life; tests don't.
vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), sleep: () => Promise.resolve() }));

const base: RouteInput = { claudeConfigured: true, geminiConfigured: true, geminiForTrials: true, geminiBackup: true, onTrial: false, needsWebSearch: false };

describe("which AI answers (pure rules)", () => {
  it("Claude alone when there is no Gemini key", () => {
    expect(engineOrder({ ...base, geminiConfigured: false })).toEqual(["claude"]);
    expect(engineOrder({ ...base, geminiConfigured: false, onTrial: true })).toEqual(["claude"]);
  });

  it("free trials start on Gemini and fall back to Claude so a trial never breaks", () => {
    expect(engineOrder({ ...base, onTrial: true })).toEqual(["gemini", "claude"]);
  });

  it("trials that need live news checking stay on Claude (Gemini has no web search here), with Gemini as the backup", () => {
    expect(engineOrder({ ...base, onTrial: true, needsWebSearch: true })).toEqual(["claude", "gemini"]);
  });

  it("turning off 'free trials use Gemini' puts trials back on Claude", () => {
    expect(engineOrder({ ...base, onTrial: true, geminiForTrials: false })).toEqual(["claude", "gemini"]);
  });

  it("paying and Free accounts use Claude first, with Gemini as the backup", () => {
    expect(engineOrder(base)).toEqual(["claude", "gemini"]);
  });

  it("with the backup switched off, Claude is the only engine", () => {
    expect(engineOrder({ ...base, geminiBackup: false })).toEqual(["claude"]);
  });

  it("when only Gemini is connected, Gemini answers everyone", () => {
    expect(engineOrder({ ...base, claudeConfigured: false })).toEqual(["gemini"]);
    expect(engineOrder({ ...base, claudeConfigured: false, geminiBackup: false, geminiForTrials: false })).toEqual(["gemini"]);
  });

  it("fails over from Claude in seconds when a backup is waiting", () => {
    expect(CLAUDE_ATTEMPTS_WITH_BACKUP).toBeLessThan(CLAUDE_ATTEMPTS);
  });
});

describe("Gemini request and error reading", () => {
  it("defaults to a current stable model, not the legacy 2.5 one", () => {
    expect(AI_PROVIDERS.gemini.defaultModel).toMatch(/^gemini-3\./);
    const c = buildCall("gemini", "k", AI_PROVIDERS.gemini.defaultModel, { system: "s", user: "u", maxTokens: 100, temperature: 0.8 });
    expect(c.url).toContain(`/models/${AI_PROVIDERS.gemini.defaultModel}:generateContent`);
  });

  it("explains key, model and limit problems for the owner", () => {
    expect(geminiProblem(403, "{}", "m")).toMatch(/rejected the Gemini key/);
    expect(geminiProblem(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}', "m")).toMatch(/rejected the Gemini key/);
    expect(geminiProblem(404, "{}", "gemini-x")).toMatch(/doesn't recognize the model "gemini-x"/);
    expect(geminiProblem(429, "{}", "m")).toMatch(/billing/);
    expect(geminiProblem(500, "{}", "m")).toBeNull();
  });

  it("names the reason Gemini returned nothing", () => {
    expect(geminiBlockReason({ promptFeedback: { blockReason: "SAFETY" } })).toBe(" (SAFETY)");
    expect(geminiBlockReason({ candidates: [{ finishReason: "STOP" }] })).toBe("");
  });
});

/* ───────── claude() end to end, with a fake Anthropic and a fake Gemini ───────── */

type Reply = { status: number; body: unknown };
const calls: string[] = [];
let anthropic: Reply[] = [];
let gemini: Reply[] = [];
const take = (q: Reply[]) => (q.length > 1 ? q.shift()! : q[0]);
const json = (r: Reply) => new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
const claudeOk = (text: string): Reply => ({ status: 200, body: { content: [{ type: "text", text }], stop_reason: "end_turn" } });
const geminiOk = (text: string): Reply => ({ status: 200, body: { candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] } });
const noCredit: Reply = { status: 400, body: { error: { message: "Your credit balance is too low to access the Anthropic API." } } };

function fakeAi() {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) {
      calls.push("claude");
      return json(take(anthropic));
    }
    if (u.includes("generativelanguage.googleapis.com")) {
      calls.push("gemini");
      return json(take(gemini));
    }
    return new Response("unexpected", { status: 500 });
  });
}

const opts = { system: "sys", user: "write a post", maxTokens: 500 };
let trialUser: string;
let paidUser: string;

beforeAll(async () => {
  const { createUser, getUser, saveUser } = await import("@/lib/auth");
  await createUser({ email: "owner@example.com", password: "Correct-horse-battery-9", setupCode: "test-setup-code" });
  const t = await createUser({ email: "trial@example.com", password: "Correct-horse-battery-9" });
  const p = await createUser({ email: "paid@example.com", password: "Correct-horse-battery-9" });
  const tu = (await getUser(t.id))!;
  tu.plan = "pro";
  tu.billing = { subscriptionId: "sub_t", status: "trialing", trialEnd: new Date(Date.now() + 7 * 86_400_000).toISOString(), trialUsed: true };
  await saveUser(tu);
  const pu = (await getUser(p.id))!;
  pu.plan = "pro";
  pu.billing = { subscriptionId: "sub_p", status: "active", interval: "month", currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000).toISOString() };
  await saveUser(pu);
  trialUser = t.id;
  paidUser = p.id;
});

beforeEach(async () => {
  calls.length = 0;
  anthropic = [claudeOk("from claude")];
  gemini = [geminiOk("from gemini")];
  vi.stubGlobal("fetch", fakeAi());
  const { saveIntegrations } = await import("@/lib/integrations");
  await saveIntegrations({ anthropicKey: "sk-ant-test-key-0123456789abcdef", geminiKey: "AIza-test-key-0123456789abcdef", geminiModel: "", geminiForTrials: "", geminiBackup: "" });
});

afterEach(() => vi.unstubAllGlobals());

const as = async <T>(id: string, fn: () => Promise<T>) => (await import("@/lib/db")).asUser(id, fn);
const ask = async (id: string, extra: object = {}) => {
  const { claude } = await import("@/lib/llm");
  return as(id, () => claude({ ...opts, ...extra }));
};

describe("claude() routing", () => {
  it("a free-trial account is written by Gemini, and Claude is never called", async () => {
    expect(await ask(trialUser)).toBe("from gemini");
    expect(calls).toEqual(["gemini"]);
  });

  it("sends the configured Gemini model and the key in a header, not the URL", async () => {
    const f = fakeAi();
    vi.stubGlobal("fetch", f);
    await ask(trialUser);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/models/${AI_PROVIDERS.gemini.defaultModel}:generateContent`);
    expect(url).not.toContain("AIza");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("AIza-test-key-0123456789abcdef");
  });

  it("a paying account is written by Claude", async () => {
    expect(await ask(paidUser)).toBe("from claude");
    expect(calls).toEqual(["claude"]);
  });

  it("a trial request that needs live news checking stays on Claude", async () => {
    expect(await ask(trialUser, { webSearch: { domains: ["apnews.com"] } })).toBe("from claude");
    expect(calls).toEqual(["claude"]);
  });

  it("if Gemini fails during a trial, Claude answers so the trial still works", async () => {
    gemini = [{ status: 403, body: { error: { message: "denied" } } }];
    expect(await ask(trialUser)).toBe("from claude");
    expect(calls).toEqual(["gemini", "claude"]);
  });

  it("turning off 'free trials use Gemini' sends trials to Claude", async () => {
    const { saveIntegrations } = await import("@/lib/integrations");
    await saveIntegrations({ geminiForTrials: false });
    expect(await ask(trialUser)).toBe("from claude");
    expect(calls).toEqual(["claude"]);
  });

  it("when Claude has no credits, Gemini answers and the owner sees a 'covered' notice instead of an outage", async () => {
    anthropic = [noCredit];
    expect(await ask(paidUser)).toBe("from gemini");
    expect(calls).toEqual(["claude", "gemini"]);
    const { getLlmHealth } = await import("@/lib/llm-health");
    const h = await getLlmHealth();
    expect(h).toMatchObject({ ok: false, covered: true });
    expect(h!.message).toMatch(/out of credits/);
    expect(h!.message).toMatch(/Gemini is covering/);
  });

  it("the notice clears the next time Claude answers", async () => {
    anthropic = [claudeOk("back")];
    expect(await ask(paidUser)).toBe("back");
    const { getLlmHealth } = await import("@/lib/llm-health");
    expect(await getLlmHealth()).toMatchObject({ ok: true });
  });

  it("an overloaded Claude hands over to Gemini after a few quick tries", async () => {
    anthropic = [{ status: 529, body: { error: { message: "Overloaded" } } }];
    expect(await ask(paidUser)).toBe("from gemini");
    expect(calls.filter((c) => c === "claude")).toHaveLength(CLAUDE_ATTEMPTS_WITH_BACKUP);
    expect(calls.at(-1)).toBe("gemini");
  });

  it("with the backup switched off, a Claude outage is an outage and says what to fix", async () => {
    const { saveIntegrations } = await import("@/lib/integrations");
    await saveIntegrations({ geminiBackup: false });
    anthropic = [noCredit];
    const { LLMError } = await import("@/lib/llm");
    const err = await ask(paidUser).catch((e) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(err.message).toMatch(/temporarily unavailable/);
    expect(err.ownerMessage).toMatch(/out of credits/);
    expect(calls).toEqual(["claude"]);
    const { getLlmHealth } = await import("@/lib/llm-health");
    expect(await getLlmHealth()).toMatchObject({ ok: false });
    expect((await getLlmHealth())!.covered).toBeFalsy();
  });

  it("when Claude and Gemini both fail the error is Claude's, and subscribers see only the safe message", async () => {
    anthropic = [noCredit];
    gemini = [{ status: 403, body: {} }];
    const err = await ask(paidUser).catch((e) => e);
    expect(err.message).toBe("AI writing is temporarily unavailable. Please try again in a little while.");
    expect(err.ownerMessage).toMatch(/out of credits/);
    expect(calls).toEqual(["claude", "gemini"]);
  });

  it("with only a Gemini key (Claude not connected) everyone is written by Gemini", async () => {
    const { saveIntegrations } = await import("@/lib/integrations");
    await saveIntegrations({ anthropicKey: "" });
    expect(await ask(paidUser)).toBe("from gemini");
    expect(calls).toEqual(["gemini"]);
    const { llmConfigured } = await import("@/lib/llm");
    expect(await llmConfigured()).toBe(true);
  });

  it("a bad Gemini key is explained to the owner, never to the subscriber", async () => {
    const { saveIntegrations } = await import("@/lib/integrations");
    await saveIntegrations({ anthropicKey: "" });
    gemini = [{ status: 400, body: { error: { message: "API key not valid. Please pass a valid API key." } } }];
    const err = await ask(paidUser).catch((e) => e);
    expect(err.message).toMatch(/temporarily unavailable/);
    expect(err.ownerMessage).toMatch(/rejected the Gemini key/);
  });

  it("a subscriber's own AI key still comes first and uses neither the app's Claude nor Gemini", async () => {
    const { saveOwnAi } = await import("@/lib/ai-provider");
    await as(paidUser, () => saveOwnAi("openai", "gpt-5-mini", "sk-own-key-0123456789"));
    const f = vi.fn(async (url: string) => {
      calls.push(String(url).includes("openai.com") ? "openai" : "other");
      return json({ status: 200, body: { choices: [{ message: { content: "from their key" } }] } });
    });
    vi.stubGlobal("fetch", f);
    expect(await ask(paidUser)).toBe("from their key");
    expect(calls).toEqual(["openai"]);
    const { clearOwnAi } = await import("@/lib/ai-provider");
    await as(paidUser, () => clearOwnAi());
  });

  it("the Test button reports a working key, and an unknown model", async () => {
    const { testIntegration } = await import("@/lib/integrations");
    expect(await testIntegration("gemini")).toMatchObject({ ok: true });
    gemini = [{ status: 404, body: {} }];
    const bad = await testIntegration("gemini");
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/doesn't recognize the model/);
  });

  it("the status shown to the owner never contains the full key and reports the switches", async () => {
    const { integrationStatus } = await import("@/lib/integrations");
    const s = await integrationStatus();
    expect(JSON.stringify(s)).not.toContain("AIza-test-key-0123456789abcdef");
    expect(s.gemini).toMatchObject({ set: true, source: "app", model: AI_PROVIDERS.gemini.defaultModel, forTrials: true, backup: true });
  });
});
