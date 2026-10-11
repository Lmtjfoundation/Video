import { authed, body, ok } from "@/lib/http-api";
import { getAppSettings, saveAppSettings, type AppSettings } from "@/lib/auth";
import { stripeReady } from "@/lib/billing";
import { storageMode } from "@/lib/db";
import { llmConfigured } from "@/lib/llm";

export const dynamic = "force-dynamic";

export const GET = authed(async () =>
  ok({
    settings: await getAppSettings(),
    env: { stripe: stripeReady(), webhook: !!process.env.STRIPE_WEBHOOK_SECRET, storage: storageMode(), llm: llmConfigured(), appUrl: process.env.APP_URL ?? "", cron: !!process.env.CRON_SECRET },
  }), { admin: true });

export const PUT = authed(async (req) => {
  const b = await body<Partial<AppSettings>>(req);
  return ok(
    await saveAppSettings({
      ...(typeof b.allowSignups === "boolean" ? { allowSignups: b.allowSignups } : {}),
      ...(typeof b.requireApprovalForNewUsers === "boolean" ? { requireApprovalForNewUsers: b.requireApprovalForNewUsers } : {}),
      ...(typeof b.supportEmail === "string" ? { supportEmail: b.supportEmail.trim().slice(0, 200) } : {}),
    }),
  );
}, { admin: true });
