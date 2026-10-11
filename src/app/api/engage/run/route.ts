import { authed, ok } from "@/lib/http-api";
import { runEngage } from "@/lib/engage";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Manual "Check comments now" from the Engage page. */
export const POST = authed(async () => ok(await runEngage({ manual: true })));
