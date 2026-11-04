import { authed, body, fail, ok } from "@/lib/http-api";
import { addSub, listSubs, removeSub, validSub, vapidKeys } from "@/lib/push";

export const dynamic = "force-dynamic";

/** The key a browser needs to subscribe, and how many of this person's devices get notifications. */
export const GET = authed(async () => ok({ publicKey: (await vapidKeys()).publicKey, devices: (await listSubs()).length }));

/** Save this device's subscription, or remove it (`{ remove: endpoint }`). */
export const POST = authed(async (req) => {
  const b = await body<{ subscription?: unknown; remove?: string }>(req);
  if (typeof b.remove === "string") {
    await removeSub(b.remove);
    return ok({ removed: true });
  }
  if (!validSub(b.subscription)) return fail("That notification subscription isn't valid.");
  await addSub(b.subscription);
  return ok({ saved: true, devices: (await listSubs()).length });
});
