import "server-only";
import { gdb } from "./db";
import { decrypt, encrypt } from "./crypto";
import { nowIso } from "./utils";

/**
 * App-wide service keys the owner pastes in Admin → App settings → Integrations.
 * Stored as one AES-256-GCM encrypted row (ENCRYPTION_KEY). Environment variables always win, so a key set
 * in the host's dashboard overrides the stored one.
 */
export interface Integrations {
  anthropicKey?: string;
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

export const anthropicKey = async () => process.env.ANTHROPIC_API_KEY || (await getIntegrations()).anthropicKey || "";
export const elevenlabsKey = async () => process.env.ELEVENLABS_API_KEY || (await getIntegrations()).elevenlabsKey || "";
export const elevenlabsVoice = async () => process.env.ELEVENLABS_VOICE_ID || (await getIntegrations()).elevenlabsVoiceId || "";
export const pexelsKey = async () => process.env.PEXELS_API_KEY || (await getIntegrations()).pexelsKey || "";
export const stripeSecretKey = async () => process.env.STRIPE_SECRET_KEY || (await getIntegrations()).stripeSecretKey || "";
export const stripeWebhookSecret = async () => process.env.STRIPE_WEBHOOK_SECRET || (await getIntegrations()).stripeWebhookSecret || "";
export const stripePortalConfig = async () => process.env.STRIPE_PORTAL_CONFIGURATION || (await getIntegrations()).stripePortalConfig || "";
export const resendKey = async () => process.env.RESEND_API_KEY || (await getIntegrations()).resendKey || "";
export const emailFrom = async () => process.env.EMAIL_FROM || (await getIntegrations()).emailFrom || "";

export async function stripePriceId(plan: string, interval: "month" | "year") {
  const env = process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${interval === "year" ? "ANNUAL" : "MONTHLY"}`];
  return env || (await getIntegrations()).stripePrices?.[`${plan}_${interval}`] || "";
}

const mask = (v: string) => (v.length > 12 ? `${v.slice(0, 7)}…${v.slice(-4)}` : "••••");
function entry(envName: string, stored?: string) {
  const env = process.env[envName];
  if (env) return { set: true, source: "server" as const, preview: mask(env) };
  if (stored) return { set: true, source: "app" as const, preview: mask(stored) };
  return { set: false as const };
}

/** Safe for the browser: never returns a full key. */
export async function integrationStatus() {
  const i = await getIntegrations();
  const sk = process.env.STRIPE_SECRET_KEY || i.stripeSecretKey || "";
  const prices = ["creator", "pro", "unlimited"].flatMap((p) => ["month", "year"].map((iv) => `${p}_${iv}`));
  const priced = (await Promise.all(prices.map((k) => stripePriceId(k.split("_")[0], k.split("_")[1] as "month" | "year")))).filter(Boolean).length;
  return {
    anthropic: entry("ANTHROPIC_API_KEY", i.anthropicKey),
    elevenlabs: { ...entry("ELEVENLABS_API_KEY", i.elevenlabsKey), voiceId: process.env.ELEVENLABS_VOICE_ID || i.elevenlabsVoiceId || "" },
    pexels: entry("PEXELS_API_KEY", i.pexelsKey),
    email: { ...entry("RESEND_API_KEY", i.resendKey), from: process.env.EMAIL_FROM || i.emailFrom || "" },
    stripe: {
      ...entry("STRIPE_SECRET_KEY", i.stripeSecretKey),
      mode: sk ? (sk.includes("_live_") ? "live" : "test") : null,
      prices: priced,
      pricesNeeded: prices.length,
      webhook: !!(process.env.STRIPE_WEBHOOK_SECRET || i.stripeWebhookSecret),
      portal: !!(process.env.STRIPE_PORTAL_CONFIGURATION || i.stripePortalConfig),
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
      const res = await fetch("https://api.anthropic.com/v1/models?limit=5", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } });
      if (res.ok) return { ok: true, message: "Claude API key works." };
      return { ok: false, message: res.status === 401 ? "Claude rejected this key (401). Copy it again from console.anthropic.com." : `Claude answered ${res.status}: ${(await res.text()).slice(0, 160)}` };
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
