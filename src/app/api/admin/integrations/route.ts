import { authed, body, fail, ok } from "@/lib/http-api";
import { integrationStatus, saveIntegrations, stripeSecretKey, testIntegration, type Integrations } from "@/lib/integrations";
import { disconnectStripe, setupStripeBilling } from "@/lib/billing";
import { appOrigin } from "@/lib/oauth";
import { emailLayout, emailReady, sendEmail, validFrom } from "@/lib/email";
import { testReplicate } from "@/lib/seedance";

export const dynamic = "force-dynamic";

/** Admin → App settings → Integrations. Never returns a full key, only masked previews. */
export const GET = authed(async () => ok(await integrationStatus()), { admin: true });

const KEY_RULES: Record<string, { re: RegExp; msg: string }> = {
  anthropicKey: { re: /^sk-ant-[A-Za-z0-9_-]{20,}$/, msg: "A Claude API key starts with sk-ant- (Claude Console → API keys)." },
  anthropicWorkspaceId: { re: /^wrkspc_[A-Za-z0-9]{6,}$/, msg: "A workspace ID starts with wrkspc_ (Claude Console → Settings → Workspaces → ID column)." },
  geminiKey: { re: /^[A-Za-z0-9_.-]{20,}$/, msg: "That doesn't look like a Gemini API key. Create one at aistudio.google.com/apikey (it usually starts with AIza) and paste only the key." },
  geminiModel: { re: /^gemini-[a-z0-9][a-z0-9._-]{1,60}$/, msg: "A Gemini model code looks like gemini-3.8-flash (see ai.google.dev/gemini-api/docs/models). Leave it blank for the app's default." },
  elevenlabsKey: { re: /^[A-Za-z0-9_-]{20,}$/, msg: "That doesn't look like an ElevenLabs API key (elevenlabs.io → Developers → API keys)." },
  elevenlabsVoiceId: { re: /^[A-Za-z0-9]{10,40}$/, msg: "A voice ID is a short code of letters and numbers (ElevenLabs → Voices → ID)." },
  replicateKey: { re: /^r8_[A-Za-z0-9]{20,}$/, msg: "A Replicate API token starts with r8_ (replicate.com → Account → API tokens)." },
  pixabayKey: { re: /^[A-Za-z0-9-]{20,}$/, msg: "That doesn't look like a Pixabay API key. Sign in at pixabay.com/api/docs and copy the value in the \"key\" row (numbers, a dash, then letters and numbers)." },
  pexelsKey: { re: /^[A-Za-z0-9]{20,}$/, msg: "That doesn't look like a Pexels API key (pexels.com/api)." },
  resendKey: { re: /^re_[A-Za-z0-9_]{10,}$/, msg: "A Resend API key starts with re_ (resend.com → API Keys)." },
};

/** Save or remove keys. Send "" to remove one. */
export const PUT = authed(async (req) => {
  const b = await body<Record<string, unknown>>(req);
  const patch: Partial<Record<keyof Integrations, string>> = {};
  for (const [field, rule] of Object.entries(KEY_RULES)) {
    if (!(field in b)) continue;
    // Forgive common paste extras: surrounding quotes, a leading label like "Authorization:" or "Bearer".
    const v = typeof b[field] === "string" ? (b[field] as string).trim().replace(/^["'`]+|["'`]+$/g, "").replace(/^(authorization\s*:\s*|bearer\s+)/i, "").trim() : "";
    if (v && !rule.re.test(v)) return fail(rule.msg);
    patch[field as keyof Integrations] = v;
  }
  for (const flag of ["geminiForTrials", "geminiBackup"] as const) {
    if (flag in b) (patch as Record<string, unknown>)[flag] = b[flag] === false ? false : "";
  }
  if ("emailFrom" in b) {
    const from = typeof b.emailFrom === "string" ? b.emailFrom.trim() : "";
    if (from && !validFrom(from)) return fail('Use an address like "Ghost Post <support@yourdomain.com>" or support@yourdomain.com.');
    patch.emailFrom = from;
  }
  if (!Object.keys(patch).length) return fail("Nothing to save.");
  await saveIntegrations(patch);
  return ok(await integrationStatus());
}, { admin: true });

/** Actions: { action: "test", which } (which = anthropic | gemini | elevenlabs | pixabay | pexels | stripe | email) · { action: "stripe-connect", secretKey? } · { action: "stripe-disconnect" } */
export const POST = authed(async (req, user) => {
  const b = await body<{ action?: string; which?: string; secretKey?: string }>(req);
  if (b.action === "test" && b.which === "email") {
    if (!(await emailReady())) return ok({ ok: false, message: "Add both the Resend API key and the From address first." });
    try {
      await sendEmail({
        to: user.email,
        subject: "Ghost Post test email",
        text: "Email works. Password-reset links will be sent from this address.",
        html: emailLayout({ title: "Email works", lines: ["Password-reset links will be sent from this address."] }),
      });
      return ok({ ok: true, message: `Test email sent to ${user.email}. If it isn't in your inbox within a minute, check spam.` });
    } catch (e) {
      const msg = (e as Error).message;
      const hint = /domain|verify|testing emails/i.test(msg) ? " Verify your sending domain in Resend → Domains, then use an address on that domain." : "";
      return ok({ ok: false, message: msg + hint });
    }
  }
  if (b.action === "test" && b.which === "replicate") return ok(await testReplicate());
  if (b.action === "test") {
    const which = b.which as "anthropic" | "gemini" | "elevenlabs" | "pixabay" | "pexels" | "stripe";
    if (!["anthropic", "gemini", "elevenlabs", "pixabay", "pexels", "stripe"].includes(which)) return fail("Unknown integration.");
    const r = await testIntegration(which);
    console.log(`[integrations] test ${which}: ${r.ok ? "ok" : "failed"} — ${r.message}`);
    return ok(r);
  }
  if (b.action === "stripe-connect") {
    const key = (b.secretKey ?? "").trim() || (await stripeSecretKey());
    if (!key) return fail("Paste your Stripe secret key first (Stripe → Developers → API keys → Secret key).");
    if (/^pk_/.test(key)) return fail("That's the publishable key (pk_…). Paste the SECRET key — it starts with sk_test_ or sk_live_.");
    const origin = appOrigin(req);
    if (!origin.startsWith("https://")) return fail("Stripe needs the app's public https address. Set APP_URL on the server, then try again.");
    const result = await setupStripeBilling(key, origin);
    return ok({ ...result, status: await integrationStatus() });
  }
  if (b.action === "stripe-disconnect") {
    await disconnectStripe();
    return ok(await integrationStatus());
  }
  return fail("Unknown action.");
}, { admin: true });
