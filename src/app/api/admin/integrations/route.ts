import { authed, body, fail, ok } from "@/lib/http-api";
import { integrationStatus, saveIntegrations, stripeSecretKey, testIntegration, type Integrations } from "@/lib/integrations";
import { disconnectStripe, setupStripeBilling } from "@/lib/billing";
import { appOrigin } from "@/lib/oauth";
import { emailLayout, emailReady, sendEmail, validFrom } from "@/lib/email";
import { testReplicate } from "@/lib/replicate-video";
import { testOwnEngine } from "@/lib/own-video";
import { testOwnWriter } from "@/lib/own-writer";
import { testUploadPost } from "@/lib/upload-post";

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
  videoEngineUrl: { re: /^https?:\/\/[^\s/$.?#][^\s]*$/i, msg: "Paste the engine's web address, e.g. https://ghostpost-1a2b3c.eastus.cloudapp.azure.com (Azure) or https://abc123-8000.proxy.runpod.net (RunPod)." },
  videoEngineToken: { re: /^[A-Za-z0-9_.~-]{12,}$/, msg: "Paste the ENGINE_TOKEN you started the engine with (12+ letters, numbers, - or _)." },
  vmWake: { re: /^(?=.*tenant=)(?=.*client=)(?=.*secret=)(?=.*subscription=)(?=.*group=)(?=.*vm=)[^\s]{40,1000}$/, msg: "Paste the whole wake line: tenant=…;client=…;secret=…;subscription=…;group=…;vm=…" },
  uploadPostKey: { re: /^[A-Za-z0-9_.\-]{16,400}$/, msg: "Paste the API key from Upload-Post (app.upload-post.com → API keys)." },
  ownWriterUrl: { re: /^https?:\/\/[^\s/$.?#][^\s]*$/i, msg: "Paste the writer's address, e.g. https://writer.20-127-104-87.sslip.io/v1 (it ends in /v1)." },
  ownWriterKey: { re: /^[A-Za-z0-9_.~-]{12,200}$/, msg: "Paste the writer's key (OWN_WRITER_KEY on the server)." },
  ownWriterModel: { re: /^[A-Za-z0-9_.:/-]{2,120}$/, msg: "A model name looks like qwen3:4b-instruct-2507-q4_K_M." },
  videoEngineGpuUrl: { re: /^https?:\/\/[^\s/$.?#][^\s]*$/i, msg: "Paste the GPU engine's web address, e.g. https://20-1-2-3.sslip.io." },
  videoEngineGpuToken: { re: /^[A-Za-z0-9_.~-]{12,}$/, msg: "Paste the ENGINE_TOKEN the GPU engine was started with (12+ letters, numbers, - or _)." },
  vmWakeGpu: { re: /^(?=.*tenant=)(?=.*client=)(?=.*secret=)(?=.*subscription=)(?=.*group=)(?=.*vm=)[^\s]{40,1000}$/, msg: "Paste the GPU machine's whole wake line: tenant=…;client=…;secret=…;subscription=…;group=…;vm=…" },
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
  // Off unless switched on: only then are Claude and Gemini never used.
  if ("ownWriterOnly" in b) (patch as Record<string, unknown>).ownWriterOnly = b.ownWriterOnly === true ? true : "";
  // When the own writer writes: after Claude and Gemini, before them, or alone. It replaces the older switch.
  // On unless switched off: pictures, clips and voices go to Ghost Post's own engine first.
  if ("engineFirst" in b) (patch as Record<string, unknown>).engineFirst = b.engineFirst === false ? false : "";
  if ("ownWriterMode" in b) {
    if (!["first", "backup", "only"].includes(String(b.ownWriterMode))) return fail("Choose when the own writer writes.");
    patch.ownWriterMode = b.ownWriterMode as "first" | "backup" | "only";
    (patch as Record<string, unknown>).ownWriterOnly = "";
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
  if (b.action === "test" && b.which === "ownWriter") return ok(await testOwnWriter());
  if (b.action === "test" && b.which === "uploadPost") return ok(await testUploadPost());
  if (b.action === "test" && b.which === "videoEngine") return ok(await testOwnEngine("main"));
  if (b.action === "test" && b.which === "videoEngineGpu") return ok(await testOwnEngine("gpu"));
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
