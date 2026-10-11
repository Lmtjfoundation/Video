import { authed, ok } from "@/lib/http-api";
import { sendApproved } from "@/lib/engage";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = authed(async () => ok({ sent: await sendApproved(undefined, 10) }));
