import { authed, body, ok } from "@/lib/http-api";
import { startGeneration, type GenerationRequest } from "@/lib/generation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** AI Music, AI Sound Effects and AI Footage (in the background; see generation.ts). */
export const POST = authed(async (req, user) => ok(await startGeneration(user, await body<GenerationRequest>(req))));
