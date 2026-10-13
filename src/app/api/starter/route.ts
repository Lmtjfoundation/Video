import { authed, body, ok } from "@/lib/http-api";
import { getSettings, log } from "@/lib/repo";
import { addStarterContent } from "@/lib/starter";
import { enabledPlatforms } from "@/lib/scheduler";
import { PLATFORMS, type Platform } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Adds hand-written, fact-checked starter drafts (no AI, no credits) for the chosen or enabled platforms. */
export const POST = authed(async (req) => {
  const b = await body<{ platforms?: Platform[] }>(req);
  const s = await getSettings();
  const chosen = Array.isArray(b.platforms) ? b.platforms.filter((p) => PLATFORMS.includes(p)) : [];
  const platforms = chosen.length ? chosen : enabledPlatforms(s).length ? enabledPlatforms(s) : [...PLATFORMS];
  const posts = await addStarterContent(platforms, s);
  if (posts.length) await log("info", "generate", `Added ${posts.length} ready-made starter draft${posts.length === 1 ? "" : "s"} (no credits used)`);
  return ok({ created: posts.length, platforms });
});
