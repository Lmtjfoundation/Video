import { copyText } from "./compose";
import type { LogEntry, Post, Reply, Settings } from "./types";
import { PILLAR_LABEL } from "./utils";

const csvCell = (v: unknown) => {
  const s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
};

export function postRows(posts: Post[], s: Settings) {
  return posts.map((p) => ({
    id: p.id,
    platform: p.platform,
    status: p.status,
    scheduled_at: p.scheduledAt ?? "",
    published_at: p.publishedAt ?? "",
    pillar: PILLAR_LABEL[p.pillar],
    format: p.format,
    hook: p.hook,
    full_text: copyText(p, s),
    money_score: p.moneyScore,
    est_revenue_low: p.revenue.low,
    est_revenue_high: p.revenue.high,
    offer: s.offers.find((o) => o.id === p.offerId)?.name ?? "",
    safety_flags: p.safetyFlags.join(" "),
    url: p.externalUrl ?? "",
  }));
}

export const replyRows = (rs: Reply[]) =>
  rs.map((r) => ({
    id: r.id,
    platform: r.platform,
    status: r.status,
    author: r.author,
    comment: r.commentText,
    reply: r.text,
    mode: r.mode,
    priority: r.priority,
    safety_flags: r.safetyFlags.join(" "),
    created_at: r.createdAt,
    sent_at: r.sentAt ?? "",
  }));

export const logRows = (ls: LogEntry[]) =>
  ls.map((l) => ({ at: l.at, level: l.level, kind: l.kind, platform: l.platform ?? "", message: l.message, meta: l.meta ?? {} }));

export function postsMarkdown(posts: Post[], s: Settings) {
  return [
    `# Nexus Pulse — content export (${new Date().toISOString().slice(0, 10)})`,
    "",
    ...posts.map((p) =>
      [
        `## ${p.hook}`,
        `*${p.platform} · ${PILLAR_LABEL[p.pillar]} · ${p.format} · ${p.status}${p.scheduledAt ? ` · ${p.scheduledAt}` : ""} · money score ${p.moneyScore}*`,
        "",
        "```",
        copyText(p, s),
        "```",
        "",
      ].join("\n"),
    ),
  ].join("\n");
}

export function repliesMarkdown(rs: Reply[]) {
  return [
    `# Nexus Pulse — replies export`,
    "",
    ...rs.map((r) => `### ${r.platform} · ${r.author} · ${r.status}\n> ${r.commentText.replace(/\n/g, "\n> ")}\n\n${r.text || "_(no reply)_"}\n`),
  ].join("\n");
}

export function logsMarkdown(ls: LogEntry[]) {
  return [`# Nexus Pulse — activity log`, "", "| Time | Level | Kind | Platform | Message |", "|---|---|---|---|---|", ...ls.map((l) => `| ${l.at} | ${l.level} | ${l.kind} | ${l.platform ?? ""} | ${l.message.replace(/\|/g, "\\|")} |`)].join("\n");
}
