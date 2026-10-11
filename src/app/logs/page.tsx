"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronRight, Download, RefreshCw, ScrollText, Search } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import type { LogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button, Card, Empty, Input, PageHeader, PlatformChip, Select } from "@/components/ui";

const KINDS = ["post", "reply", "engage", "schedule", "generate", "safety", "system"];

export default function LogsPage() {
  const toast = useApp((s) => s.toast);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [kind, setKind] = useState("");
  const [level, setLevel] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const tz = useApp((s) => s.status?.settings.timezone ?? "UTC");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (kind) params.set("kind", kind);
      if (level) params.set("level", level);
      if (q) params.set("q", q);
      setLogs(await api<LogEntry[]>(`/api/logs?${params}`));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [kind, level, q, toast]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const fmt = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(iso));

  return (
    <>
      <PageHeader
        title="Activity Log"
        subtitle="Every post, reply, skip, block and error — with the exact text the agent sent."
        actions={
          <>
            {(["csv", "md", "json"] as const).map((f) => (
              <a key={f} href={`/api/export?type=logs&format=${f}`}>
                <Button size="sm" variant="ghost"><Download className="h-3.5 w-3.5" /> {f.toUpperCase()}</Button>
              </a>
            ))}
            <Button size="sm" onClick={load} loading={loading}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
          </>
        }
      />

      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-[1fr_180px_160px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages and details…" className="pl-9" />
        </div>
        <Select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All types</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </Select>
        <Select value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">All levels</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </Select>
      </Card>

      <Card className="overflow-hidden">
        {logs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-white/40">
                <tr>
                  <th className="w-8 px-4 py-3" />
                  <th className="px-2 py-3 font-medium">Time</th>
                  <th className="px-2 py-3 font-medium">Type</th>
                  <th className="px-2 py-3 font-medium">Platform</th>
                  <th className="px-2 py-3 font-medium">Event</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {logs.map((l) => (
                  <Fragment key={l.id}>
                    <tr className={cn("cursor-pointer hover:bg-white/[0.02]", open === l.id && "bg-white/[0.03]")} onClick={() => setOpen(open === l.id ? null : l.id)}>
                      <td className="px-4 py-3">
                        <ChevronRight className={cn("h-3.5 w-3.5 text-white/30 transition-transform", open === l.id && "rotate-90")} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-3 tabular-nums text-white/50">{fmt(l.at)}</td>
                      <td className="px-2 py-3">
                        <span className={cn("inline-flex items-center gap-1.5 text-xs", l.level === "error" ? "text-red-300" : l.level === "warn" ? "text-gold-300" : "text-white/60")}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", l.level === "error" ? "bg-red-400" : l.level === "warn" ? "bg-gold-400" : "bg-mint-400")} />
                          {l.kind}
                        </span>
                      </td>
                      <td className="px-2 py-3">{l.platform ? <PlatformChip platform={l.platform} /> : <span className="text-white/25">—</span>}</td>
                      <td className="px-2 py-3 pr-4 text-white/85">{l.message}</td>
                    </tr>
                    {open === l.id && (
                      <tr>
                        <td colSpan={5} className="bg-ink-950/50 px-6 py-4">
                          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-white/65">
                            {l.meta && Object.keys(l.meta).length ? JSON.stringify(l.meta, null, 2) : "No additional details."}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={<ScrollText className="h-6 w-6" />} title={loading ? "Loading…" : "No log entries"} body="Activity appears here as the agent works." />
        )}
      </Card>
    </>
  );
}
