import { fail, authed, ok } from "@/lib/http-api";
import { getCredential, log } from "@/lib/repo";
import { postWebhook } from "@/lib/platforms/webhook-send";

export const dynamic = "force-dynamic";

/** Sends a clearly-labelled test message to the saved webhook so the user can confirm it works. */
export const POST = authed(async () => {
  const cred = await getCredential("webhook");
  if (!cred?.accessToken) return fail("Save a webhook URL first.");
  try {
    const res = await postWebhook(
      cred.accessToken,
      {
        event: "test",
        platform: "webhook",
        text: "This is a test message from Ghost Post. If you can read this, your connection works.",
        sentAt: new Date().toISOString(),
      },
      cred.refreshToken,
    );
    await log("info", "system", `Webhook test succeeded (${res.status})`, { platform: "webhook" });
    return ok({ status: res.status });
  } catch (e) {
    await log("warn", "system", `Webhook test failed: ${(e as Error).message}`, { platform: "webhook" });
    return fail((e as Error).message.slice(0, 300));
  }
});
