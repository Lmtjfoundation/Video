import { authed, ok } from "@/lib/http-api";
import { createPortal } from "@/lib/billing";
import { appOrigin } from "@/lib/oauth";

export const dynamic = "force-dynamic";

/** Stripe's customer portal: change plan, update card, see invoices, cancel. */
export const POST = authed(async (req, user) => ok({ url: await createPortal(user, appOrigin(req)) }));
