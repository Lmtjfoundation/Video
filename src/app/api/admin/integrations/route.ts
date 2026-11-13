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
  azureAiEndpoint: { re: /^https:\/\/[a-z0-9-]+\.(services\.ai|cognitiveservices|openai)\.azure\.com(\/[^\s]*)?$/i, msg: "Paste the Azure AI resource's endpoint, e.g. https://myresource.services.ai.azure.com (Azure portal → your AI resource → Keys and Endpoint)." },
  azureAiKey: { re: /^[A-Za-z0-9]{32,120}$/, msg: "Paste KEY 1 from the Azure AI resource (Azure portal → Keys and Endpoint)." },
  azureAiRegion: { re: /^[a-z]{2,20}[0-9]?$/, msg: "The region looks like eastus2 (Azure portal → your AI resource → Overview → Location)." },
  azureStorageConnection: { re: /^DefaultEndpointsProtocol=https;AccountName=[a-z0-9]{3,24};AccountKey=[A-Za-z0-9+/=]{40,};EndpointSuffix=core\.windows\.net$/, msg: "Paste the whole connection string: Azure portal → your storage account → Access keys → Connection string (starts with DefaultEndpointsProtocol=https;AccountName=…)." },
  azureApimUrl: { re: /^https:\/\/[a-z0-9-]+\.azure-api\.net\/?$/, msg: "The API Management gateway address, e.g. https://ghostpost-apim-2114.azure-api.net." },
  azureStorageAccount: { re: /^[a-z0-9]{3,24}$/, msg: "The storage account's name: 3-24 lowercase letters and numbers, e.g. ghostpostmedia133314." },
  azureCosmosEndpoint: { re: /^https:\/\/[a-z0-9-]+\.documents\.azure\.com(:443)?\/?$/, msg: "The Cosmos DB endpoint, e.g. https://ghostpost-cosmos-2114.documents.azure.com:443/." },
  azureInsightsConnection: { re: /^InstrumentationKey=[0-9a-fA-F-]{36};.*IngestionEndpoint=https:\/\/[^;]+/, msg: "Paste Application Insights → Overview → Connection string (starts with InstrumentationKey=)." },
  azureStorageContainer: { re: /^[a-z0-9](?!.*--)[a-z0-9-]{1,61}[a-z0-9]$/, msg: "A bucket (container) name is 3-63 lowercase letters, numbers and dashes, e.g. media." },
  azureAiChatDeployment: { re: /^[A-Za-z0-9._-]{1,64}$/, msg: "The writing model's deployment name, e.g. gpt-5.4-mini." },
  azureAiImageDeployment: { re: /^[A-Za-z0-9._-]{1,64}$/, msg: "The deployment name is what you called the FLUX Kontext deployment, e.g. flux-kontext." },
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
  smtpHost: { re: /^[a-z0-9.-]+\.[a-z]{2,}$/i, msg: "The mail server name looks like smtp.gmail.com, smtp.office365.com or smtp.zoho.com." },
  smtpPort: { re: /^(25|465|587|2525)$/, msg: "The port is usually 587 (or 465)." },
  smtpUser: { re: /^[^\s]{3,200}$/, msg: "The login is usually your full email address." },
  smtpPass: { re: /^.{4,200}$/, msg: "Paste the mail account's password (for Gmail, an app password)." },
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
    // Gmail shows app passwords in groups of four ("abcd efgh ijkl mnop"); the spaces aren't part of it.
    patch[field as keyof Integrations] = field === "smtpPass" && /^([a-z]{4} ){3}[a-z]{4}$/.test(v) ? v.replace(/ /g, "") : v;
  }
  for (const flag of ["geminiForTrials", "geminiBackup"] as const) {
    if (flag in b) (patch as Record<string, unknown>)[flag] = b[flag] === false ? false : "";
  }
  // Off unless switched on: only then are Claude and Gemini never used.
  if ("ownWriterOnly" in b) (patch as Record<string, unknown>).ownWriterOnly = b.ownWriterOnly === true ? true : "";
  // When the own writer writes: after Claude and Gemini, before them, or alone. It replaces the older switch.
  // On unless switched off: pictures, clips and voices go to Curbflix's own engine first.
  if ("engineFirst" in b) (patch as Record<string, unknown>).engineFirst = b.engineFirst === false ? false : "";
  // Off unless switched on: then every AI job runs on Azure only.
  if ("azureOnly" in b) (patch as Record<string, unknown>).azureOnly = b.azureOnly === true ? true : "";
  if ("ownWriterMode" in b) {
    if (!["first", "backup", "only"].includes(String(b.ownWriterMode))) return fail("Choose when the own writer writes.");
    patch.ownWriterMode = b.ownWriterMode as "first" | "backup" | "only";
    (patch as Record<string, unknown>).ownWriterOnly = "";
  }
  if ("emailFrom" in b) {
    const from = typeof b.emailFrom === "string" ? b.emailFrom.trim() : "";
    if (from && !validFrom(from)) return fail('Use an address like "Curbflix <support@yourdomain.com>" or support@yourdomain.com.');
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
    if (!(await emailReady())) return ok({ ok: false, message: "Add a mail account (server, login and password), or a Resend API key and From address, first." });
    try {
      await sendEmail({
        to: user.email,
        subject: "Curbflix test email",
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
  if (b.action === "test" && b.which === "azureAi") return ok(await testAzureAi());
  if (b.action === "test" && b.which === "azureIdentity") return ok(await testAzureIdentity());
  if (b.action === "test" && b.which === "azureStorage") return ok(await (await import("@/lib/azure-blob")).testBlob());
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

/** One small picture on Azure AI (a few cents) to prove the endpoint, key and deployment work. */
async function testAzureAi(): Promise<{ ok: boolean; message: string }> {
  const { foundryImage, foundryReady } = await import("@/lib/azure-foundry");
  if (!(await foundryReady())) return { ok: false, message: "Add the endpoint and key first." };
  try {
    const t = Date.now();
    const img = await foundryImage({ prompt: "A small brass trumpet on a wooden table, soft window light, photorealistic. No text.", aspect: "1:1" });
    return { ok: true, message: `Working: made a test picture (${Math.round(img.bytes.length / 1024)} KB) on Azure's GPUs in ${Math.round((Date.now() - t) / 1000)} s.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message.slice(0, 400) };
  }
}

/** Admin → Azure keyless → Test: each part with the server's managed identity, no keys. */
async function testAzureIdentity(): Promise<{ ok: boolean; message: string }> {
  const parts: string[] = [];
  let good = true;
  const step = async (label: string, run: () => Promise<string>) => {
    try {
      parts.push(`${label}: ${await run()}`);
    } catch (e) {
      good = false;
      parts.push(`${label}: ${(e as Error).message.slice(0, 160)}`);
    }
  };
  const { apimUrl, foundryAuth } = await import("@/lib/azure-identity");
  await step("Models (API Management)", async () => {
    if (!(await apimUrl())) return "not set";
    const a = await foundryAuth();
    const r = await fetch(`${a!.base}/openai/v1/chat/completions`, { method: "POST", headers: { ...a!.headers, "Content-Type": "application/json" }, body: JSON.stringify({ model: "gpt-5.4-mini", messages: [{ role: "user", content: "Reply OK" }], max_completion_tokens: 200 }), signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`gateway answered ${r.status}`);
    return `OK (${r.headers.get("x-cache") === "HIT" ? "from cache" : "live"})`;
  });
  await step("Storage", async () => ((await (await import("@/lib/azure-blob")).testBlob()).message));
  await step("Cosmos DB", async () => {
    const { cosmosReady, motionPresets } = await import("@/lib/azure-cosmos");
    if (!(await cosmosReady())) return "not set";
    return `OK, ${(await motionPresets()).length} motion presets`;
  });
  await step("Telemetry", async () => {
    await (await import("@/lib/telemetry")).trackEvent("AdminTest", { at: new Date().toISOString() });
    return "sent";
  });
  return { ok: good, message: parts.join(" · ") };
}
