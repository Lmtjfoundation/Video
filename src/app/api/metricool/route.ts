import { body, fail, authed, ok } from "@/lib/http-api";
import { credentialStatuses, getSettings, log, saveSettings } from "@/lib/repo";
import { MC_PLATFORMS, checkMetricool, clearMetricool, getMetricool, metricoolStatus, parseMetricoolIds, saveMetricool, type McPlatform, type MetricoolConn } from "@/lib/metricool";
import { planById } from "@/lib/plans";
import { PLATFORMS } from "@/lib/types";
import type { User } from "@/lib/auth";
import { nowIso } from "@/lib/utils";

export const dynamic = "force-dynamic";

const reply = async () => ok({ metricool: metricoolStatus(await getMetricool()), credentials: await credentialStatuses() });

/** Turns on the platforms that now post through Metricool, as far as the plan's platform limit allows. */
async function switchOn(user: User, platforms: McPlatform[]) {
  const s = await getSettings();
  const max = planById(user.plan).maxPlatforms;
  const next = { ...s.platforms };
  let on = PLATFORMS.filter((p) => next[p]).length;
  const skipped: string[] = [];
  for (const p of platforms) {
    if (next[p]) continue;
    if (on >= max) {
      skipped.push(p);
      continue;
    }
    next[p] = true;
    on++;
  }
  await saveSettings({ platforms: next });
  return skipped;
}

export const GET = authed(async () => reply());

/**
 * Connect: { token, userId, blogId } or { token, link } (any Metricool address-bar link while the brand is open).
 * Refresh: { action: "refresh" } reads the brand's connected accounts again.
 */
export const POST = authed(async (req, user) => {
  const input = await body<{ action?: "refresh"; token?: string; userId?: string; blogId?: string; link?: string }>(req);
  const cur = await getMetricool();

  if (input.action === "refresh") {
    if (!cur) return fail("Connect Metricool first.");
    const r = await checkMetricool(cur);
    await saveMetricool({ ...cur, brand: r.brand ?? cur.brand, found: r.found, checkedAt: nowIso() });
    return reply();
  }

  const fromLink = parseMetricoolIds(input.link ?? "");
  const token = (input.token ?? "").trim() || cur?.token || "";
  const userId = (input.userId ?? "").trim() || fromLink.userId || "";
  const blogId = (input.blogId ?? "").trim() || fromLink.blogId || "";
  if (!token) return fail("Paste your Metricool API token.");
  if (!/^\d{3,15}$/.test(userId) || !/^\d{3,15}$/.test(blogId)) {
    return fail("Add your Metricool user ID and brand ID — or paste a Metricool link from your browser's address bar while your brand is open (it contains blogId=… and userId=…).");
  }
  const r = await checkMetricool({ token, userId, blogId });
  // Platforms already connected directly keep posting that way; the rest go through Metricool.
  const direct = new Set((await credentialStatuses()).filter((c) => c.direct).map((c) => c.platform));
  const use = Object.fromEntries(MC_PLATFORMS.map((p) => [p, r.found.includes(p) && !direct.has(p)])) as MetricoolConn["use"];
  const at = nowIso();
  await saveMetricool({ token, userId, blogId, brand: r.brand, found: r.found, use, connectedAt: cur?.connectedAt ?? at, checkedAt: at });
  const skipped = await switchOn(user, MC_PLATFORMS.filter((p) => use[p]));
  await log("info", "system", `Metricool connected${r.brand ? ` (${r.brand})` : ""}: ${r.found.length ? r.found.join(", ") : "no accounts found yet"}`);
  const res = await reply();
  const data = await res.json();
  return ok({ ...data, skipped });
});

/** Choose which platforms post through Metricool: { use: { instagram: true, facebook: false, … } }. */
export const PATCH = authed(async (req, user) => {
  const { use } = await body<{ use?: Partial<Record<McPlatform, boolean>> }>(req);
  const cur = await getMetricool();
  if (!cur) return fail("Connect Metricool first.");
  const next = { ...cur.use };
  for (const p of MC_PLATFORMS) if (typeof use?.[p] === "boolean") next[p] = use[p];
  await saveMetricool({ ...cur, use: next });
  const turnedOn = MC_PLATFORMS.filter((p) => use?.[p] === true);
  const skipped = turnedOn.length ? await switchOn(user, turnedOn) : [];
  const res = await reply();
  return ok({ ...(await res.json()), skipped });
});

export const DELETE = authed(async () => {
  await clearMetricool();
  await log("info", "system", "Metricool disconnected");
  return reply();
});
