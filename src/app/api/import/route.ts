import { authed, body, fail, ok } from "@/lib/http-api";
import { requireFeature } from "@/lib/credits";
import { finalizePost } from "@/lib/generate";
import { getSettings, log, savePosts } from "@/lib/repo";
import { zonedToUtc } from "@/lib/time";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";
import { PLATFORMS, type Platform, type Post } from "@/lib/types";
import { nowIso, uid } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, newlines inside quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/**
 * Bulk import posts from CSV. Columns (header row required, any order):
 * platform, text, date (YYYY-MM-DD, optional), time (HH:MM, optional), hashtags (space-separated, optional)
 * Rows with a date and time are scheduled (or sent to review); the rest become drafts.
 */
export const POST = authed(async (req, user) => {
  requireFeature(user, "bulkImport", "Bulk import");
  const { csv } = await body<{ csv: string }>(req);
  if (!csv?.trim()) return fail("Paste or upload a CSV first.");
  const rows = parseCsv(csv);
  const header = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
  const col = (n: string) => header.indexOf(n);
  if (col("platform") < 0 || col("text") < 0) return fail('The first row must include "platform" and "text" columns.');
  if (rows.length > 500) return fail("Import up to 500 rows at a time.");
  const s = await getSettings();
  const posts: Post[] = [];
  const errors: string[] = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const platform = (r[col("platform")] ?? "").trim().toLowerCase().replace("twitter", "x") as Platform;
    const text = (r[col("text")] ?? "").trim();
    if (!PLATFORMS.includes(platform)) return errors.push(`Row ${line}: unknown platform “${r[col("platform")]}”.`);
    if (!text) return errors.push(`Row ${line}: text is empty.`);
    const date = col("date") >= 0 ? (r[col("date")] ?? "").trim() : "";
    const time = col("time") >= 0 ? (r[col("time")] ?? "").trim() : "";
    const [hook, ...rest] = text.split(/\n+/);
    const t = nowIso();
    const post: Post = {
      id: uid("post"), platform, pillar: "wealth_systems", format: PLATFORM_SPECS[platform].formats[0],
      hook: hook.trim(), body: rest.join("\n").trim(), parts: [],
      hashtags: col("hashtags") >= 0 ? (r[col("hashtags")] ?? "").split(/[\s,]+/).filter(Boolean) : [],
      offerId: null, status: "draft", moneyScore: 0, revenue: { low: 0, high: 0, basis: "" }, scoreNotes: [], safetyFlags: [], attempts: 0, createdAt: t, updatedAt: t,
    };
    if (date || time) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return errors.push(`Row ${line}: use date YYYY-MM-DD and time HH:MM.`);
      const at = zonedToUtc(date, time, s.timezone);
      if (at.getTime() < Date.now()) return errors.push(`Row ${line}: that time is in the past.`);
      post.scheduledAt = at.toISOString();
      post.status = user.requireApproval ? "pending_review" : "scheduled";
    }
    posts.push(finalizePost(post, s));
  });
  if (posts.length) await savePosts(posts);
  await log("info", "generate", `Imported ${posts.length} post${posts.length === 1 ? "" : "s"} from CSV${errors.length ? ` (${errors.length} rows skipped)` : ""}`);
  return ok({ imported: posts.length, scheduled: posts.filter((p) => p.scheduledAt).length, errors: errors.slice(0, 50) });
});
