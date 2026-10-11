"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CheckCheck, Download, MessageSquare, RefreshCw, Send, ShieldAlert, SkipForward } from "lucide-react";
import { useApp } from "@/lib/store";
import { api, timeAgo } from "@/lib/client";
import type { Reply, ReplyMode, ReplyStatus } from "@/lib/types";
import { REPLY_MODES } from "@/lib/types";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";
import { MODE_LABEL, cn } from "@/lib/utils";
import { Badge, Button, Card, Empty, PageHeader, PlatformChip, Select, StatusBadge, Textarea } from "@/components/ui";

const TABS: { key: string; label: string; statuses: ReplyStatus[] }[] = [
  { key: "queue", label: "Needs approval", statuses: ["pending_approval"] },
  { key: "escalated", label: "Escalated", statuses: ["escalated", "blocked", "failed"] },
  { key: "approved", label: "Approved", statuses: ["approved", "sending"] },
  { key: "sent", label: "Sent", statuses: ["sent"] },
  { key: "skipped", label: "Skipped", statuses: ["skipped"] },
];

export default function EngagePage() {
  const { status, toast, refresh } = useApp();
  const [replies, setReplies] = useState<Reply[]>([]);
  const [tab, setTab] = useState("queue");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReplies(await api<Reply[]>("/api/replies"));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);

  const current = TABS.find((t) => t.key === tab)!;
  const shown = useMemo(() => replies.filter((r) => current.statuses.includes(r.status)), [replies, current]);
  const engageable = Object.values(PLATFORM_SPECS)
    .filter((s) => !s.engage.startsWith("Copy-ready"))
    .map((s) => s.name);

  async function act(key: string, fn: () => Promise<unknown>, msg?: string) {
    setBusy(key);
    try {
      await fn();
      if (msg) toast(msg, "success");
      await load();
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const update = (r: Reply) => setReplies((list) => list.map((x) => (x.id === r.id ? r : x)));

  return (
    <>
      <PageHeader
        title="Engagement"
        subtitle={`The agent reads new comments, skips spam and trolls, escalates sensitive ones, and drafts the best reply. Auto-reply supported on ${engageable.join(", ")}.`}
        actions={
          <>
            <a href="/api/export?type=replies&format=csv">
              <Button size="sm" variant="ghost"><Download className="h-3.5 w-3.5" /> CSV</Button>
            </a>
            <Button loading={busy === "run"} onClick={() => act("run", () => api("/api/engage/run", { method: "POST" }), "Comments checked")}>
              <RefreshCw className="h-4 w-4" /> Check comments now
            </Button>
            <Button variant="primary" loading={busy === "send"} onClick={() => act("send", async () => { const r = await api<{ sent: number }>("/api/engage/send", { method: "POST" }); toast(`${r.sent} sent`, "success"); })}>
              <Send className="h-4 w-4" /> Send approved
            </Button>
          </>
        }
      />

      {status && !status.settings.autoReply && (
        <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-white/70">Auto-engagement is off — the scheduler won't fetch comments. You can still check manually.</p>
          <Button size="sm" variant="primary" onClick={() => useApp.getState().updateSettings({ autoReply: true })}>Turn on</Button>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {TABS.map((t) => {
          const n = replies.filter((r) => t.statuses.includes(r.status)).length;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn("focus-ring rounded-lg px-3 py-1.5 text-xs font-medium", tab === t.key ? "bg-white/10 text-white" : "text-white/50 hover:text-white")}
            >
              {t.label} <span className={cn(n && t.key === "queue" ? "text-gold-300" : "text-white/35")}>{n}</span>
            </button>
          );
        })}
        {tab === "queue" && shown.length > 1 && (
          <Button
            size="sm"
            className="ml-auto"
            loading={busy === "all"}
            onClick={() => act("all", () => api("/api/replies", { method: "PATCH", body: { ids: shown.map((r) => r.id), status: "approved" } }), `Approved ${shown.length}`)}
          >
            <CheckCheck className="h-3.5 w-3.5" /> Approve all
          </Button>
        )}
      </div>

      <div className="grid gap-3">
        {shown.map((r) => (
          <ReplyRow key={r.id} reply={r} onUpdate={update} onDone={() => { load(); refresh(); }} />
        ))}
      </div>
      {!shown.length && (
        <Card>
          <Empty icon={<MessageSquare className="h-6 w-6" />} title="Nothing here" body={tab === "queue" ? "New reply drafts will appear here, highest-value commenters first." : "No replies in this state."} />
        </Card>
      )}
    </>
  );
}

function ReplyRow({ reply, onUpdate, onDone }: { reply: Reply; onUpdate: (r: Reply) => void; onDone: () => void }) {
  const toast = useApp((s) => s.toast);
  const [text, setText] = useState(reply.text);
  const [mode, setMode] = useState<ReplyMode>(reply.mode);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setText(reply.text), [reply.text]);

  const editable = ["pending_approval", "blocked", "failed", "escalated", "approved"].includes(reply.status);
  const limit = reply.platform === "x" ? 280 : 450;
  const sensitive = reply.safetyFlags.filter((f) => !f.startsWith("warn:"));

  async function go(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="animate-rise p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <PlatformChip platform={reply.platform} />
        <span className="text-sm font-medium text-white">{reply.author}</span>
        <StatusBadge status={reply.status} />
        <Badge tone="neutral">priority {reply.priority}</Badge>
        {sensitive.map((f) => (
          <Badge key={f} tone="red"><ShieldAlert className="h-3 w-3" />{f.replace(/^block:/, "").replace(/_/g, " ")}</Badge>
        ))}
        {reply.safetyFlags.filter((f) => f.startsWith("warn:")).map((f) => (
          <Badge key={f} tone="gold">{f.slice(5).replace(/_/g, " ")}</Badge>
        ))}
        <span className="ml-auto text-[11px] text-white/35">{timeAgo(reply.createdAt)}</span>
      </div>

      <blockquote className="mb-3 border-l-2 border-white/15 pl-3 text-[13.5px] leading-relaxed text-white/65">{reply.commentText}</blockquote>

      {reply.status === "escalated" && (
        <p className="mb-3 rounded-lg bg-red-500/[0.07] p-3 text-xs text-red-200 ring-1 ring-red-400/20">
          The agent won't auto-reply here. Read it yourself; if someone may be in danger or is a minor, respond personally or point them to appropriate help.
        </p>
      )}

      {editable ? (
        <>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a reply…" className="min-h-[80px]" />
          <div className="mt-1 text-right text-[11px] tabular-nums text-white/35">
            <span className={cn(text.length > limit && "text-red-300")}>{text.length}</span>/{limit}
          </div>
        </>
      ) : (
        <p className="rounded-xl bg-ink-950/60 p-3 text-[13.5px] leading-relaxed text-white/85 ring-1 ring-white/[0.05]">{reply.text || <span className="text-white/35">No reply</span>}</p>
      )}
      {reply.error && <p className="mt-2 text-xs text-red-300/80">{reply.error}</p>}

      {editable && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={!text.trim() || text.length > limit}
            loading={busy === "approve"}
            onClick={() =>
              go("approve", async () => {
                const [r] = await api<Reply[]>("/api/replies", { method: "PATCH", body: { id: reply.id, text, status: "approved" } });
                if (r) {
                  onUpdate(r);
                  toast(r.status === "blocked" ? "Blocked by safety filter — edit the text" : "Approved — sends on the next run (or press Send approved)", r.status === "blocked" ? "error" : "success");
                }
                onDone();
              })
            }
          >
            <Check className="h-3.5 w-3.5" /> Approve
          </Button>
          <Select value={mode} onChange={(e) => setMode(e.target.value as ReplyMode)} className="w-52">
            {REPLY_MODES.map((m) => (
              <option key={m} value={m}>{MODE_LABEL[m]}</option>
            ))}
          </Select>
          <Button
            size="sm"
            loading={busy === "regen"}
            onClick={() =>
              go("regen", async () => {
                const r = await api<Reply>("/api/replies/regenerate", { body: { id: reply.id, mode } });
                onUpdate(r);
                setText(r.text);
              })
            }
          >
            <RefreshCw className="h-3.5 w-3.5" /> Rewrite
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            loading={busy === "skip"}
            onClick={() => go("skip", async () => { await api("/api/replies", { method: "PATCH", body: { id: reply.id, status: "skipped" } }); onDone(); })}
          >
            <SkipForward className="h-3.5 w-3.5" /> Skip
          </Button>
        </div>
      )}
    </Card>
  );
}
