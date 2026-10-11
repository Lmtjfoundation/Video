import { authed, body, ok } from "@/lib/http-api";
import { getAppSettings, saveAppSettings, type AppSettings } from "@/lib/auth";
import { stripeReady } from "@/lib/billing";
import { storageMode } from "@/lib/db";
import { llmConfigured } from "@/lib/llm";
import { elevenlabsKey, pexelsKey, stripeWebhookSecret } from "@/lib/integrations";
import { emailReady } from "@/lib/email";

export const dynamic = "force-dynamic";

export const GET = authed(async () => {
  const [settings, stripe, webhook, llm, voice, stock, email] = await Promise.all([
    getAppSettings(),
    stripeReady(),
    stripeWebhookSecret().then(Boolean),
    llmConfigured(),
    elevenlabsKey().then(Boolean),
    pexelsKey().then(Boolean),
    emailReady(),
  ]);
  return ok({
    settings,
    env: {
      stripe,
      webhook,
      storage: storageMode(),
      dataDir: !!process.env.DATA_DIR,
      llm,
      voice,
      stock,
      email,
      appUrl: process.env.APP_URL ?? "",
      cron: !!process.env.CRON_SECRET,
      scheduler: process.env.INTERNAL_SCHEDULER === "1",
      encryption: !!process.env.ENCRYPTION_KEY,
    },
  });
}, { admin: true });

export const PUT = authed(async (req) => {
  const b = await body<Partial<AppSettings>>(req);
  return ok(
    await saveAppSettings({
      ...(typeof b.allowSignups === "boolean" ? { allowSignups: b.allowSignups } : {}),
      ...(typeof b.requireApprovalForNewUsers === "boolean" ? { requireApprovalForNewUsers: b.requireApprovalForNewUsers } : {}),
      ...(typeof b.supportEmail === "string" ? { supportEmail: b.supportEmail.trim().slice(0, 200) } : {}),
      ...(typeof b.legalName === "string" ? { legalName: b.legalName.trim().slice(0, 120) } : {}),
      ...(typeof b.legalJurisdiction === "string" ? { legalJurisdiction: b.legalJurisdiction.trim().slice(0, 120) } : {}),
    }),
  );
}, { admin: true });
