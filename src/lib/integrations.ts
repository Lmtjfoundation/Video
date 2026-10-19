import "server-only";
import { gdb } from "./db";
import { decrypt, encrypt } from "./crypto";
import { nowIso } from "./utils";
import { recordLlmHealth } from "./llm-health";
import { AI_PROVIDERS } from "./ai-providers";
import { buildCall, readText } from "./llm-providers";
import { geminiProblem } from "./llm-route";

/**
 * App-wide service keys the owner pastes in Admin → App settings → Integrations.
 * Stored as one AES-256-GCM encrypted row (ENCRYPTION_KEY). A value saved in the app wins; the matching
 * environment variable is the fallback, so the host's variables work as defaults and the owner can always
 * replace a key from the app without touching the server.
 */
export interface Integrations {
  anthropicKey?: string;
  /** Only for personal/service-account keys that aren't tied to one workspace (sent as anthropic-workspace-id). */
  anthropicWorkspaceId?: string;
  /**
   * Google Gemini key owned by the app (not a subscriber's). Used for free trials and as an automatic backup when Claude
   * can't answer, so subscribers never need an AI account of their own. Use a key from a billing-enabled Google Cloud
   * project: on the free tier Google may use prompts and answers to improve its products.
   */
  geminiKey?: string;
  /** Model code, e.g. gemini-3.8-flash. Blank = the app's default. */
  geminiModel?: string;
  /** Free-trial accounts write with Gemini (default on). */
  geminiForTrials?: boolean;
  /** Gemini answers when Claude can't (default on). */
  geminiBackup?: boolean;
  elevenlabsKey?: string;
  elevenlabsVoiceId?: string;
  /** Replicate (https://replicate.com) API token: Seedance 2.5 animated scenes in Movie Studio, billed on that account. */
  replicateKey?: string;
  /** Pixabay (https://pixabay.com/api/docs/) — free stock video, the main footage source. */
  pixabayKey?: string;
  /** Pexels — optional second footage source. */
  pexelsKey?: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  stripeWebhookId?: string;
  stripePortalConfig?: string;
  stripeMode?: "live" | "test";
  /** `${planId}_${month|year}` → Stripe price id */
  stripePrices?: Record<string, string>;
  /** planId → Stripe product id */
  stripeProducts?: Record<string, string>;
  /** planId → Stripe coupon id for the trial plans' discounted first paid month (created by "Connect Stripe"). */
  stripeCoupons?: Record<string, string>;
  /** Resend (https://resend.com) API key for password-reset emails. Railway blocks SMTP on Hobby, so email goes over HTTPS. */
  resendKey?: string;
  /** Sender, e.g. "Ghost Post <support@yourdomain.com>" (the domain must be verified in Resend). */
  emailFrom?: string;
  updatedAt?: string;
}

const ROW = "integrations";
let cache: { at: number; value: Integrations } | null = null;

export async function getIntegrations(): Promise<Integrations> {
  if (cache && Date.now() - cache.at < 15_000) return cache.value;
  const row = await gdb().get<{ id: string; value?: { cipher?: string } }>("kv", ROW);
  let value: Integrations = {};
  if (row?.value?.cipher) {
    try {
      value = JSON.parse(decrypt(row.value.cipher)) as Integrations;
    } catch {
      value = {};
    }
  }
  cache = { at: Date.now(), value };
  return value;
}

/** Merges a patch; empty strings / null remove a field. */
export async function saveIntegrations(patch: Partial<Record<keyof Integrations, unknown>>) {
  const next: Record<string, unknown> = { ...(await getIntegrations()) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === "" || v === null || v === undefined) delete next[k];
    else next[k] = typeof v === "string" ? v.trim() : v;
  }
  next.updatedAt = nowIso();
  await gdb().upsert("kv", { id: ROW, value: { cipher: encrypt(JSON.stringify(next)) } });
  cache = { at: Date.now(), value: next as Integrations };
  return next as Integrations;
}

const pick = async (field: keyof Integrations, envName: string) => ((await getIntegrations())[field] as string | undefined) || process.env[envName] || "";

export const anthropicKey = () => pick("anthropicKey", "ANTHROPIC_API_KEY");
export const anthropicWorkspace = () => pick("anthropicWorkspaceId", "ANTHROPIC_WORKSPACE_ID");

/** Headers for every Claude API call: the key, the API version and, when set, the workspace for multi-workspace keys. */
export async function anthropicHeaders(key: string): Promise<Record<string, string>> {
  const workspace = await anthropicWorkspace();
  return { "x-api-key": key, "anthropic-version": "2023-06-01", ...(workspace ? { "anthropic-workspace-id": workspace } : {}) };
}

/** Turns Claude's account/workspace errors into plain instructions (null when it's another error). */
export function anthropicWorkspaceHint(status: number, body: string) {
  if (/credit balance is too low/i.test(body)) {
    return "Your Claude API account is out of credits, so Claude can't write right now. Add credits in the Claude Console → Settings → Billing. On a Max plan, first claim your monthly API credits on claude.ai → Settings → Billing → API credits and link the same Console organization this key belongs to.";
  }
  if (status === 400 && /anthropic-workspace-id is required|not scoped to a workspace/i.test(body)) {
    return "This Claude key is a personal key that isn't tied to one workspace, so it needs a workspace ID. Add it in Admin → App settings → Integrations → Claude (Claude Console → Settings → Workspaces → ID column, starts with wrkspc_), or create a key scoped to a workspace.";
  }
  if (status === 400 && /must be a valid workspace ID/i.test(body)) return "That workspace ID isn't valid. Copy it again from Claude Console → Settings → Workspaces (it starts with wrkspc_).";
  if (status === 404 && /Workspace .* not found/i.test(body)) return "Claude couldn't find that workspace, or this key can't use it. Check the workspace ID in Claude Console → Settings → Workspaces.";
  return null;
}

/** The app's Gemini connection, or null when no key is set. */
export interface OwnerGemini {
  key: string;
  model: string;
  forTrials: boolean;
  backup: boolean;
}
export async function ownerGemini(): Promise<OwnerGemini | null> {
  const i = await getIntegrations();
  const key = i.geminiKey || process.env.GEMINI_API_KEY || "";
  if (!key) return null;
  return {
    key,
    model: i.geminiModel || process.env.GEMINI_MODEL || AI_PROVIDERS.gemini.defaultModel,
    forTrials: i.geminiForTrials !== false,
    backup: i.geminiBackup !== false,
  };
}

export const elevenlabsKey = () => pick("elevenlabsKey", "ELEVENLABS_API_KEY");
export const replicateKey = () => pick("replicateKey", "REPLICATE_API_TOKEN");
export const elevenlabsVoice = () => pick("elevenlabsVoiceId", "ELEVENLABS_VOICE_ID");
export const pixabayKey = () => pick("pixabayKey", "PIXABAY_API_KEY");
/** True when any stock-footage source is connected. */
export const stockReady = async () => !!((await pixabayKey()) || (await pexelsKey()));
export const pexelsKey = () => pick("pexelsKey", "PEXELS_API_KEY");
/** Pexels sits behind a firewall that rejects anonymous HTTP clients, so identify the app. */
export const pexelsHeaders = (key: string) => ({
  Authorization: key,
  Accept: "application/json",
  "User-Agent": `GhostPost/1.0 (+${(process.env.APP_URL || "https://ghost-post-autopilot.up.railway.app").replace(/\/$/, "")})`,
});
export const stripeSecretKey = () => pick("stripeSecretKey", "STRIPE_SECRET_KEY");
export const stripeWebhookSecret = () => pick("stripeWebhookSecret", "STRIPE_WEBHOOK_SECRET");
export const stripePortalConfig = () => pick("stripePortalConfig", "STRIPE_PORTAL_CONFIGURATION");
export const resendKey = () => pick("resendKey", "RESEND_API_KEY");
export const emailFrom = () => pick("emailFrom", "EMAIL_FROM");

export async function stripePriceId(plan: string, interval: "month" | "year") {
  const env = process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${interval === "year" ? "ANNUAL" : "MONTHLY"}`];
  return (await getIntegrations()).stripePrices?.[`${plan}_${interval}`] || env || "";
}

/** Coupon that makes the first paid month after a trial cost the plan's intro price. Env: STRIPE_COUPON_<PLAN>_INTRO. */
export async function stripeIntroCoupon(plan: string) {
  return (await getIntegrations()).stripeCoupons?.[plan] || process.env[`STRIPE_COUPON_${plan.toUpperCase()}_INTRO`] || "";
}

const mask = (v: string) => (v.length > 12 ? `${v.slice(0, 7)}…${v.slice(-4)}` : "••••");
function entry(envName: string, stored?: string) {
  const env = process.env[envName];
  if (stored) return { set: true, source: "app" as const, preview: mask(stored), serverFallback: !!env };
  if (env) return { set: true, source: "server" as const, preview: mask(env), serverFallback: false };
  return { set: false as const, serverFallback: false };
}

/** Safe for the browser: never returns a full key. */
export async function integrationStatus() {
  const i = await getIntegrations();
  const sk = i.stripeSecretKey || process.env.STRIPE_SECRET_KEY || "";
  const prices = ["creator", "pro", "unlimited"].flatMap((p) => ["month", "year"].map((iv) => `${p}_${iv}`));
  const priced = (await Promise.all(prices.map((k) => stripePriceId(k.split("_")[0], k.split("_")[1] as "month" | "year")))).filter(Boolean).length;
  return {
    anthropic: { ...entry("ANTHROPIC_API_KEY", i.anthropicKey), workspaceId: i.anthropicWorkspaceId || process.env.ANTHROPIC_WORKSPACE_ID || "" },
    gemini: {
      ...entry("GEMINI_API_KEY", i.geminiKey),
      model: i.geminiModel || process.env.GEMINI_MODEL || AI_PROVIDERS.gemini.defaultModel,
      forTrials: i.geminiForTrials !== false,
      backup: i.geminiBackup !== false,
    },
    elevenlabs: { ...entry("ELEVENLABS_API_KEY", i.elevenlabsKey), voiceId: i.elevenlabsVoiceId || process.env.ELEVENLABS_VOICE_ID || "" },
    replicate: entry("REPLICATE_API_TOKEN", i.replicateKey),
    pixabay: entry("PIXABAY_API_KEY", i.pixabayKey),
    pexels: entry("PEXELS_API_KEY", i.pexelsKey),
    email: { ...entry("RESEND_API_KEY", i.resendKey), from: i.emailFrom || process.env.EMAIL_FROM || "" },
    stripe: {
      ...entry("STRIPE_SECRET_KEY", i.stripeSecretKey),
      mode: sk ? (sk.includes("_live_") ? "live" : "test") : null,
      prices: priced,
      pricesNeeded: prices.length,
      webhook: !!(i.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET),
      portal: !!(i.stripePortalConfig || process.env.STRIPE_PORTAL_CONFIGURATION),
    },
    updatedAt: i.updatedAt ?? null,
  };
}

/** Live checks for the admin "Test" buttons. Only the Claude test spends anything: one tiny reply (a tiny fraction of a cent) to confirm billing works. */
export async function testIntegration(which: "anthropic" | "gemini" | "elevenlabs" | "pixabay" | "pexels" | "stripe"): Promise<{ ok: boolean; message: string }> {
  try {
    if (which === "anthropic") {
      const key = await anthropicKey();
      if (!key) return { ok: false, message: "No Claude API key saved yet." };
      const headers = await anthropicHeaders(key);
      const res = await fetch("https://api.anthropic.com/v1/models?limit=50", { headers });
      if (res.ok) {
        const ws = res.headers.get("anthropic-workspace-id");
        const where = ws ? ` (workspace ${ws})` : "";
        // The key is valid; now confirm the account can actually generate (credits / billing) with one tiny reply.
        const ids = (((await res.json().catch(() => ({}))) as { data?: { id: string }[] }).data ?? []).map((m) => m.id);
        const model = ids.find((m) => m.includes("haiku")) ?? ids[0] ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
        const gen = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "Hi" }] }),
        });
        if (gen.ok) {
          await recordLlmHealth(true);
          return { ok: true, message: `Claude works — key, workspace and billing all OK${where}.` };
        }
        const gtext = await gen.text();
        const ghint = anthropicWorkspaceHint(gen.status, gtext);
        const gmsg = ghint ?? `The key is valid${where}, but a test reply failed (${gen.status}): ${gtext.slice(0, 160)}`;
        await recordLlmHealth(false, gmsg);
        return { ok: false, message: gmsg };
      }
      const text = await res.text();
      const hint = anthropicWorkspaceHint(res.status, text);
      const msg =
        hint ?? (res.status === 401 ? "Claude rejected this key (401). Copy it again from the Claude Console → API keys." : `Claude answered ${res.status}: ${text.slice(0, 160)}`);
      await recordLlmHealth(false, msg);
      return { ok: false, message: msg };
    }
    if (which === "gemini") {
      const g = await ownerGemini();
      if (!g) return { ok: false, message: "No Gemini API key saved yet." };
      const call = buildCall("gemini", g.key, g.model, { system: "Answer in one word.", user: "Say OK.", maxTokens: 16, temperature: 0.7 });
      const res = await fetch(call.url, { method: "POST", headers: call.headers, body: JSON.stringify(call.body) });
      if (res.ok) {
        const text = readText("gemini", await res.json().catch(() => ({}))).trim();
        if (!text) return { ok: false, message: `Google accepted the key but ${g.model} returned an empty answer. Press Test again, or choose another model.` };
        return {
          ok: true,
          message: `Gemini works — ${g.model} answered. This test can't see whether billing is on: use a key from a Google Cloud project with billing enabled, because on the free tier Google may use prompts and answers to improve its products.`,
        };
      }
      const body = await res.text();
      return { ok: false, message: geminiProblem(res.status, body, g.model) ?? `Gemini answered ${res.status}: ${body.replace(/\s+/g, " ").slice(0, 160)}` };
    }
    if (which === "elevenlabs") {
      const key = await elevenlabsKey();
      if (!key) return { ok: false, message: "No ElevenLabs key saved yet." };
      const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": key } });
      if (!res.ok) return { ok: false, message: `ElevenLabs answered ${res.status}: ${(await res.text()).slice(0, 160)}` };
      const s = (await res.json()) as { tier?: string; character_count?: number; character_limit?: number };
      const left = s.character_limit != null && s.character_count != null ? (s.character_limit - s.character_count).toLocaleString() : "?";
      return { ok: true, message: `ElevenLabs works · plan ${s.tier ?? "?"} · ${left} voice characters left this period.` };
    }
    if (which === "pixabay") {
      const key = await pixabayKey();
      if (!key) return { ok: false, message: "No Pixabay key saved yet." };
      const res = await fetch(`https://pixabay.com/api/videos/?${new URLSearchParams({ key, q: "ocean waves", per_page: "3", safesearch: "true" })}`, {
        headers: { Accept: "application/json", "User-Agent": pexelsHeaders("")["User-Agent"] },
      });
      if (res.ok) {
        const d = (await res.json().catch(() => ({}))) as { totalHits?: number };
        return { ok: true, message: `Pixabay stock footage works (${(d.totalHits ?? 0).toLocaleString()} test clips found).` };
      }
      const body = (await res.text()).replace(/\s+/g, " ").slice(0, 200);
      console.warn(`[integrations] Pixabay test failed: ${res.status} ${body}`);
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { ok: false, message: `Pixabay didn't accept this key (${res.status}). Sign in at pixabay.com/api/docs — your key is shown in the "key" row of the parameters table. Copy just that value.` };
      }
      if (res.status === 429) return { ok: false, message: "Pixabay's limit of 100 requests a minute was reached. Wait a minute and press Test again." };
      return { ok: false, message: `Pixabay answered ${res.status}: ${body.slice(0, 120)}` };
    }
    if (which === "pexels") {
      const key = await pexelsKey();
      if (!key) return { ok: false, message: "No Pexels key saved yet." };
      const res = await fetch("https://api.pexels.com/videos/search?query=ocean&per_page=1", { headers: pexelsHeaders(key) });
      if (res.ok) return { ok: true, message: "Pexels stock footage works." };
      const body = (await res.text()).replace(/\s+/g, " ").slice(0, 200);
      console.warn(`[integrations] Pexels test failed: ${res.status} ${body}`);
      if (/error code: 10\d\d|cloudflare|<html/i.test(body)) {
        return { ok: false, message: `Pexels' firewall blocked the request from the server (${res.status}). Press Test again in a minute; if it keeps failing, tell your developer the code: ${body.slice(0, 60)}` };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: `Pexels didn't accept this key (${res.status}). On pexels.com/api, copy the key shown under "Your API Key" (one long line of letters and numbers) and paste it again.` };
      }
      return { ok: false, message: `Pexels answered ${res.status}: ${body.slice(0, 120)}` };
    }
    const key = await stripeSecretKey();
    if (!key) return { ok: false, message: "No Stripe key saved yet." };
    const res = await fetch("https://api.stripe.com/v1/balance", { headers: { Authorization: `Bearer ${key}` } });
    return res.ok
      ? { ok: true, message: `Stripe key works (${key.includes("_live_") ? "LIVE — real payments" : "TEST mode — no real charges"}).` }
      : { ok: false, message: `Stripe answered ${res.status}: ${(await res.text()).slice(0, 160)}` };
  } catch (e) {
    return { ok: false, message: `Couldn't reach the service: ${(e as Error).message}` };
  }
}
