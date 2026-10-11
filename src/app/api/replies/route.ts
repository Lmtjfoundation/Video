import { body, fail, authed, ok } from "@/lib/http-api";
import { getReply, getSettings, listReplies, log, saveReply } from "@/lib/repo";
import { checkOutput } from "@/lib/safety";
import type { ReplyStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = authed(async (req: Request) => {
  const status = new URL(req.url).searchParams.get("status");
  let rs = await listReplies();
  if (status) rs = rs.filter((r) => status.split(",").includes(r.status));
  rs.sort((a, b) => b.priority - a.priority || b.createdAt.localeCompare(a.createdAt));
  return ok(rs);
});

/** Edit text and/or approve / skip. Approving re-runs the safety check on the final text. */
export const PATCH = authed(async (req: Request) => {
  const b = await body<{ id?: string; ids?: string[]; text?: string; status?: ReplyStatus }>(req);
  const ids = b.ids ?? (b.id ? [b.id] : []);
  if (!ids.length) return fail("Missing id");
  if (b.status && !["approved", "skipped", "pending_approval"].includes(b.status)) return fail("Invalid status");
  const s = await getSettings();
  const out = [];
  for (const id of ids) {
    const r = await getReply(id);
    if (!r || r.status === "sent" || r.status === "sending") continue;
    if (typeof b.text === "string" && ids.length === 1) r.text = b.text.trim();
    if (b.status === "approved") {
      if (!r.text) continue;
      const check = checkOutput(r.text, r.platform, { allowedUrls: s.offers.map((o) => o.url), perPartLimit: r.platform === "x" ? 280 : 2000 });
      r.safetyFlags = [...new Set([...r.safetyFlags.filter((f) => !f.startsWith("block:")), ...check.flags])];
      if (!check.ok) {
        r.status = "blocked";
        await saveReply(r);
        out.push(r);
        continue;
      }
    }
    if (b.status) r.status = b.status;
    await saveReply(r);
    out.push(r);
  }
  if (b.status) await log("info", "reply", `${out.length} repl${out.length === 1 ? "y" : "ies"} marked ${b.status}`);
  return ok(out);
});
