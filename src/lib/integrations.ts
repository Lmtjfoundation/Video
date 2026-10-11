import "server-only";
import { gdb } from "./db";
import { decrypt, encrypt } from "./crypto";
import { nowIso } from "./utils";

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
  elevenlabsKey?: string;
  elevenlabsVoiceId?: string;
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
  /** Resend (https://resend.com) API key for password-reset emails. Railway blocks SMTP on Hobby, so email goes over HTTPS. */
  resendKey?: string;
  /** Sender, e.g. "Nexus Pulse <support@yourdomain.com>" (the domain must be verified in Resend). */
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

/** Turns Claude's workspace-related 400/404 answers into plain instructions (null when it's another error). */
export function anthropicWorkspaceHint(status: number, body: string) {
  if (status === 400 && /anthropic-workspace-id is required|not scoped to a workspace/i.test(body)) {
    return "This Claude key is a personal key that isn't tied to one workspace, so it needs a workspace ID. Add it in Admin → App settings → Integrations → Claude (Claude Console → Settings → Workspaces → ID column, starts with wrkspc_), or create a key scoped to a workspace.";
  }
  if (status === 400 && /must be a valid workspace ID/i.test(body)) return "That workspace ID isn't valid. Copy it again from Claude Console → Settings → Workspaces (it starts with wrkspc_).";
  if (status === 404 && /Workspace .* not found/i.test(body)) return "Claude couldn't find that workspace, or this key can't use it. Check the workspace ID in Claude Console → Settings → Workspaces.";
  return null;
}
export const elevenlabsKey = () => pick("elevenlabsKey", "ELEVENLABS_API_KEY");
export const elevenlabsVoice = () => pick("elevenlabsVoiceId", "ELEVENLABS_VOICE_ID");
export const pexelsKey = () => pick("pexelsKey", "PEXELS_API_KEY");
export const stripeSecretKey = () => pick("stripeSecretKey", "STRIPE_SECRET_KEY");
export const stripeWebhookSecret = () => pick("stripeWebhookSecret", "STRIPE_WEBHOOK_SECRET");
export const stripePortalConfig = () => pick("stripePortalConfig", "STRIPE_PORTAL_CONFIGURATION");
export const resendKey = () => pick("resendKey", "RESEND_API_KEY");
export const emailFrom = () => pick("emailFrom", "EMAIL_FROM");

export async function stripePriceId(plan: string, interval: "month" | "year") {
  const env = process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${interval === "year" ? "ANNUAL" : "MONTHLY"}`];
  return (await getIntegrations()).stripePrices?.[`${plan}_${interval}`] || env || "";
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
    elevenlabs: { ...entry("ELEVENLABS_API_KEY", i.elevenlabsKey), voiceId: i.elevenlabsVoiceId || process.env.ELEVENLABS_VOICE_ID || "" },
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

/** Lightweight live checks used by the admin "Test" buttons (none of them spend credits). */
export async function testIntegration(which: "anthropic" | "elevenlabs" | "pexels" | "stripe"): Promise<{ ok: boolean; message: string }> {
  try {
    if (which === "anthropic") {
      const key = await anthropicKey();
      if (!key) return { ok: false, message: "No Claude API key saved yet." };
      const res = await fetch("https://api.anthropic.com/v1/models?limit=5", { headers: await anthropicHeaders(key) });
      if (res.ok) {
        const ws = res.headers.get("anthropic-workspace-id");
        return { ok: true, message: ws ? `Claude API key works (workspace ${ws}).` : "Claude API key works." };
      }
      const text = await res.text();
      const hint = anthropicWorkspaceHint(res.status, text);
      if (hint) return { ok: false, message: hint };
      return { ok: false, message: res.status === 401 ? "Claude rejected this key (401). Copy it again from the Claude Console → API keys." : `Claude answered ${res.status}: ${text.slice(0, 160)}` };
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
    if (which === "pexels") {
      const key = await pexelsKey();
      if (!key) return { ok: false, message: "No Pexels key saved yet." };
      const res = await fetch("https://api.pexels.com/videos/search?query=ocean&per_page=1", { headers: { Authorization: key } });
      return res.ok ? { ok: true, message: "Pexels stock footage works." } : { ok: false, message: `Pexels answered ${res.status}.` };
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
