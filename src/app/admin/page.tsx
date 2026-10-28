"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bot, Power, Share2, Check, CircleDollarSign, CreditCard, ExternalLink, Film, KeyRound, Mail, Mic, Pencil, RefreshCw, RotateCcw, Search, ShieldCheck, Sparkles, Trash2, Users, X } from "lucide-react";
import { useApp } from "@/lib/store";
import { api, copyToClipboard } from "@/lib/client";
import { PLANS, type PlanId } from "@/lib/plans";
import { copyText } from "@/lib/compose";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import type { Post } from "@/lib/types";
import { cn, usd } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, PageHeader, PlatformChip, Select, Stat, StatusBadge, Switch, Textarea } from "@/components/ui";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  status: "active" | "suspended";
  plan: PlanId;
  requireApproval: boolean;
  usage: { period: string; credits: number; posts: number };
  billing?: { status?: string };
  createdAt: string;
  lastLoginAt?: string;
  counts: { total: number; scheduled: number; review: number };
  isOwner?: boolean;
  isCoOwner?: boolean;
  staff?: boolean;
}
interface ContentRow {
  owner: string;
  email: string;
  post: Post;
}
interface Stats {
  users: number;
  active: number;
  newThisMonth: number;
  byPlan: Record<PlanId, number>;
  mrr: number;
  creditsUsed: number;
  aiCostEstimate: number;
  vaultCredits: number;
  pool: { balance: number; availableToday: number; swept: number; drawn: number };
  postsPublishedThisMonth: number;
  awaitingReview: number;
  creditsComp: number;
  trialing: number;
  pastDue: number;
  costs: Costs;
  engineHours: { main: number; gpu: number };
  profit: { revenue: number; fees: number; aiPaid: number; aiComp: number; engines: number; fixed: number; costs: number; profit: number; margin: number | null; breakEven: Record<string, number | null> };
  planEconomics: { id: PlanId; name: string; monthly: number; annual: number; typical: number; full: number; fullYearly: number; breakEven: number | null }[];
}
type Costs = { appServerMonthly: number; storageNetworkMonthly: number; otherMonthly: number; connectServiceMonthly: number; cpuEngineHourly: number; gpuEngineHourly: number; targetMargin: number };
interface AppSettingsPayload {
  settings: { allowSignups: boolean; requireApprovalForNewUsers: boolean; supportEmail: string; legalName: string; legalJurisdiction: string };
  env: {
    stripe: boolean;
    webhook: boolean;
    storage: string;
    dataDir: boolean;
    llm: boolean;
    voice: boolean;
    stock: boolean;
    email: boolean;
    appUrl: string;
    cron: boolean;
    scheduler: boolean;
    encryption: boolean;
  };
}
type KeyState = { set: boolean; source?: "server" | "app"; preview?: string; serverFallback?: boolean };
interface IntegrationStatus {
  anthropic: KeyState & { workspaceId: string };
  gemini: KeyState & { model: string; forTrials: boolean; backup: boolean };
  elevenlabs: KeyState & { voiceId: string };
  replicate: KeyState;
  videoEngine: KeyState & { url: string };
  vmWake?: KeyState & { vm: string };
  videoEngineGpu?: KeyState & { url: string };
  ownWriter?: KeyState & { url: string; model: string; only: boolean };
  uploadPost?: KeyState;
  vmWakeGpu?: KeyState & { vm: string };
  pixabay: KeyState;
  pexels: KeyState;
  email: KeyState & { from: string };
  stripe: KeyState & { mode: "live" | "test" | null; prices: number; pricesNeeded: number; webhook: boolean; portal: boolean };
  updatedAt: string | null;
}

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "review", label: "Content review" },
  { key: "users", label: "Users" },
  { key: "settings", label: "App settings" },
] as const;

export default function AdminPage() {
  const { status } = useApp();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("overview");
  const [stats, setStats] = useState<Stats | null>(null);

  const loadStats = useCallback(() => api<Stats>("/api/admin/stats").then(setStats).catch(() => {}), []);
  useEffect(() => {
    loadStats();
    const want = new URLSearchParams(window.location.search).get("tab");
    const match = TABS.find((t) => t.key === want);
    if (match) setTab(match.key);
  }, [loadStats]);

  if (status && status.me.user.role !== "admin") {
    return <Card><Empty icon={<ShieldCheck className="h-6 w-6" />} title="Admins only" body="Ask the workspace owner for admin access." /></Card>;
  }

  return (
    <>
      <PageHeader title="Admin" subtitle="Users, plans, content review and app-wide settings." />
      <div className="mb-5 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={cn("focus-ring shrink-0 rounded-xl px-3.5 py-2 text-sm font-medium", tab === t.key ? "bg-white/10 text-white" : "text-white/50 hover:text-white")}>
            {t.label}
            {t.key === "review" && stats?.awaitingReview ? <span className="ml-1.5 rounded-full bg-gold-400 px-1.5 text-[11px] font-semibold text-ink-950">{stats.awaitingReview}</span> : null}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview stats={stats} onStats={setStats} />}
      {tab === "review" && <Review onChange={loadStats} />}
      {tab === "users" && <UsersTab onChange={loadStats} />}
      {tab === "settings" && <AppSettingsTab />}
    </>
  );
}

function Overview({ stats, onStats }: { stats: Stats | null; onStats: (s: Stats) => void }) {
  if (!stats) return <div className="glass h-64 animate-pulse" />;
  const margin = stats.profit.margin;
  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Monthly recurring revenue" value={<span className="text-gradient">{usd(stats.mrr)}</span>} sub={`Paid-up subscriptions${stats.trialing ? ` · ${stats.trialing} on a free trial` : ""}${stats.pastDue ? ` · ${stats.pastDue} payment overdue` : ""}`} icon={<CircleDollarSign className="h-4 w-4" />} accent="gold" />
        <Stat label="Users" value={stats.users} sub={`${stats.active} active · ${stats.newThisMonth} new this month`} icon={<Users className="h-4 w-4" />} accent="violet" />
        <Stat label="AI cost this month (est.)" value={`≈ ${usd(stats.aiCostEstimate)}`} sub={`${(stats.creditsUsed + stats.creditsComp).toLocaleString()} credits used at ~2¢ each${stats.creditsComp ? `, ${stats.creditsComp.toLocaleString()} by you and your team` : ""}${margin !== null ? ` · ${margin}% profit after all costs` : ""}`} accent="mint" />
        <Stat label="Waiting for review" value={stats.awaitingReview} sub={`${stats.postsPublishedThisMonth.toLocaleString()} posts published this month`} accent={stats.awaitingReview ? "red" : "mint"} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Credits in vaults" value={stats.vaultCredits.toLocaleString()} sub="unspent, each lot expires 30 days after it was added" accent="violet" />
        <Stat label="Community pool" value={stats.pool.balance.toLocaleString()} sub={`${stats.pool.availableToday.toLocaleString()} can go out today`} accent="mint" />
        <Stat label="Expired into the pool" value={stats.pool.swept.toLocaleString()} sub="all time" accent="gold" />
        <Stat label="Given out from the pool" value={stats.pool.drawn.toLocaleString()} sub="all time, to accounts that ran out" accent="gold" />
      </div>
      <ProfitCard stats={stats} onStats={onStats} />
      <Card>
        <CardHeader title="Users by plan" />
        <div className="grid grid-cols-1 gap-3 p-5">
          {PLANS.map((p) => {
            const n = stats.byPlan[p.id] ?? 0;
            return (
              <div key={p.id} className="grid grid-cols-[110px_1fr_60px] items-center gap-3 text-sm">
                <span className="text-white/80">{p.name} <span className="text-white/40">${p.monthly}</span></span>
                <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]"><div className="h-full rounded-full bg-gradient-to-r from-mint-400 to-gold-400" style={{ width: `${stats.users ? (n / stats.users) * 100 : 0}%` }} /></div>
                <span className="text-right tabular-nums text-white">{n}</span>
              </div>
            );
          })}
        </div>
      </Card>
      <Card className="p-5 text-sm text-white/65">
        <p className="font-medium text-white">Platform setup</p>
        <p className="mt-1">Connect buttons for X, Facebook, Instagram, LinkedIn, YouTube and TikTok are set up once by you in <Link className="text-mint-300 hover:underline" href="/platforms">Platforms</Link>. Every user then links their own accounts with one click.</p>
      </Card>
    </div>
  );
}

const COST_FIELDS: [keyof Costs, string, string][] = [
  ["appServerMonthly", "App server, $ a month", "Azure D4ads v7 always on: $166.44"],
  ["storageNetworkMonthly", "Disks and IP addresses, $ a month", "Billed even while a machine is off"],
  ["otherMonthly", "Other fixed bills, $ a month", "Domain, email, anything else"],
  ["connectServiceMonthly", "Social connect service, $ a month", "Upload-Post: Basic $24, Professional $50"],
  ["gpuEngineHourly", "GPU engine, $ an hour while on", "NV36ads A10 v5: $3.20"],
  ["cpuEngineHourly", "Tools engine, $ an hour while on", "Ghost (Spot D2nlds v6): $0.0295"],
];

/** Revenue minus every cost of running Ghost Post, what each plan leaves, and how many subscribers pay the bills. */
function ProfitCard({ stats, onStats }: { stats: Stats; onStats: (s: Stats) => void }) {
  const toast = useApp((s) => s.toast);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const p = stats.profit;
  const rows: [string, number, string][] = [
    ["Subscription revenue", p.revenue, ""],
    ["Card fees (Stripe 2.9% + 30¢)", -p.fees, ""],
    ["AI for subscribers", -p.aiPaid, ""],
    ["AI used free by you and your team", -p.aiComp, ""],
    ["Engine machines", -p.engines, `${stats.engineHours.gpu} GPU hours, ${stats.engineHours.main} tools-engine hours this month`],
    ["Servers, disks and other fixed bills", -p.fixed, ""],
  ];
  async function save() {
    setBusy(true);
    try {
      const patch = Object.fromEntries(Object.entries(draft).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, k === "targetMargin" ? Number(v) / 100 : Number(v)]));
      onStats(await api<Stats>("/api/admin/stats", { method: "PUT", body: patch }));
      setEdit(false);
      setDraft({});
      toast("Costs saved.", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader
        title="Profit & operating costs"
        subtitle="This month so far. Replace the cost estimates with your real bills for an exact figure."
        icon={<CircleDollarSign className="h-4 w-4" />}
        action={<Button size="sm" variant="ghost" onClick={() => setEdit(!edit)}><Pencil className="h-3.5 w-3.5" /> {edit ? "Close" : "Edit costs"}</Button>}
      />
      <div className="grid grid-cols-1 gap-5 p-5">
        <div className="grid grid-cols-1 gap-1.5 text-sm">
          {rows.map(([label, v, note]) => (
            <div key={label} className="flex items-baseline justify-between gap-4">
              <span className="text-white/70">{label}{note && <span className="block text-xs text-white/40">{note}</span>}</span>
              <span className={cn("tabular-nums", v < 0 ? "text-white/70" : "text-white")}>{v < 0 ? `−${usd(-v)}` : usd(v)}</span>
            </div>
          ))}
          <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-white/10 pt-2 font-semibold">
            <span>Profit</span>
            <span className={cn("tabular-nums", p.profit < 0 ? "text-red-300" : "text-mint-300")}>{p.profit < 0 ? `−${usd(-p.profit)}` : usd(p.profit)}{p.margin !== null ? ` (${p.margin}%)` : ""}</span>
          </div>
        </div>
        {edit && (
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:grid-cols-2">
            {COST_FIELDS.map(([k, label, hint]) => (
              <Field key={k} label={label} hint={hint}>
                <Input type="number" min={0} step="0.01" inputMode="decimal" placeholder={String(stats.costs[k])} value={draft[k] ?? ""} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
              </Field>
            ))}
            <Field label="Target profit, %" hint="After card fees">
              <Input type="number" min={0} max={95} inputMode="decimal" placeholder={String(Math.round(stats.costs.targetMargin * 100))} value={draft.targetMargin ?? ""} onChange={(e) => setDraft({ ...draft, targetMargin: e.target.value })} />
            </Field>
            <div className="flex items-end"><Button variant="primary" loading={busy} onClick={save}>Save costs</Button></div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-xs text-white/45">
              <tr><th className="py-2 font-medium">Plan</th><th className="font-medium">Leaves a month, typical use</th><th className="font-medium">Every credit used</th><th className="font-medium">Subscribers to pay all fixed bills</th></tr>
            </thead>
            <tbody>
              {stats.planEconomics.map((x) => (
                <tr key={x.id} className="border-t border-white/[0.06]">
                  <td className="py-2 text-white/85">{x.name} <span className="text-white/40">${x.monthly}</span></td>
                  <td className="tabular-nums">{usd(x.typical)}</td>
                  <td className="tabular-nums">{usd(x.full)}<span className="text-white/40"> · yearly {usd(x.fullYearly)}</span></td>
                  <td className="tabular-nums">{x.breakEven ?? "never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-white/45">After card fees and AI. GPU work (clips, voices, lip sync) is priced in credits per job, so it is covered by the credits it uses. Anyone who needs more buys a credit pack.</p>
        </div>
      </div>
    </Card>
  );
}

function Review({ onChange }: { onChange: () => void }) {
  const toast = useApp((s) => s.toast);
  const [filter, setFilter] = useState("pending_review");
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api<ContentRow[]>(`/api/admin/content?status=${filter}`));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [filter, toast]);
  useEffect(() => {
    load();
  }, [load]);

  const shown = rows.filter((r) => !q || r.email.includes(q.toLowerCase()) || r.post.hook.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="grid grid-cols-1 gap-4">
      <Card className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[220px_1fr]">
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter">
          <option value="pending_review">Waiting for review</option>
          <option value="scheduled">Scheduled (all users)</option>
          <option value="rejected">Sent back</option>
          <option value="draft">Drafts</option>
          <option value="published">Published</option>
          <option value="all">Everything</option>
        </Select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by user email or text" className="pl-9" />
        </div>
      </Card>
      {loading ? <div className="glass h-40 animate-pulse" /> : shown.length ? shown.map((r) => <ReviewCard key={`${r.owner}:${r.post.id}`} row={r} onDone={() => { load(); onChange(); }} />) : (
        <Card><Empty icon={<ShieldCheck className="h-6 w-6" />} title="Nothing here" body={filter === "pending_review" ? "Posts from users who need approval show up here before they can publish." : "No posts match."} /></Card>
      )}
    </div>
  );
}

function ReviewCard({ row, onDone }: { row: ContentRow; onDone: () => void }) {
  const toast = useApp((s) => s.toast);
  const p = row.post;
  const [edit, setEdit] = useState(false);
  const [hook, setHook] = useState(p.hook);
  const [bodyText, setBodyText] = useState(p.body);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const locked = p.status === "published" || p.status === "publishing";

  async function act(action: "approve" | "reject" | "edit" | "unschedule" | "delete") {
    setBusy(action);
    try {
      await api("/api/admin/content", { method: "PATCH", body: { owner: row.owner, postId: p.id, action, note: note || undefined, edit: edit ? { hook, body: bodyText } : undefined } });
      toast({ approve: "Approved and scheduled", reject: "Sent back to the user", edit: "Saved", unschedule: "Moved to drafts", delete: "Removed" }[action], "success");
      onDone();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const preview = useMemo(() => copyText(p, DEFAULT_SETTINGS), [p]);
  return (
    <Card className="grid grid-cols-1 gap-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <PlatformChip platform={p.platform} />
        <StatusBadge status={p.status} />
        {p.mature && <Badge tone="red">18+ mature</Badge>}
        <span className="text-sm text-white/70">{row.email}</span>
        <span className="ml-auto text-xs text-white/45">{p.scheduledAt ? new Date(p.scheduledAt).toLocaleString() : "No date"}</span>
      </div>
      {edit ? (
        <div className="grid grid-cols-1 gap-2">
          <Input value={hook} onChange={(e) => setHook(e.target.value)} aria-label="Hook" />
          <Textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} className="min-h-[140px]" aria-label="Body" />
        </div>
      ) : (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-ink-950/60 p-3 font-sans text-[13.5px] leading-relaxed text-white/85 ring-1 ring-white/[0.05]">{preview}</pre>
      )}
      {p.safetyFlags.length > 0 && <p className="text-xs text-gold-300/90">Flags: {p.safetyFlags.map((f) => f.replace(/^(block|warn):/, "").replace(/_/g, " ")).join(", ")}</p>}
      {p.reviewNote && <p className="text-xs text-white/50">Last note: {p.reviewNote}</p>}
      {!locked && (
        <>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note to the user (optional, shown on their post)" aria-label="Review note" />
          <div className="flex flex-wrap gap-2">
            {p.status !== "scheduled" && <Button size="sm" variant="primary" loading={busy === "approve"} onClick={() => act("approve")}><Check className="h-3.5 w-3.5" /> Approve{edit ? " with edits" : ""}</Button>}
            <Button size="sm" onClick={() => setEdit((v) => !v)}><Pencil className="h-3.5 w-3.5" /> {edit ? "Stop editing" : "Edit"}</Button>
            {edit && <Button size="sm" loading={busy === "edit"} onClick={() => act("edit")}>Save edits only</Button>}
            {p.status === "scheduled" && <Button size="sm" loading={busy === "unschedule"} onClick={() => act("unschedule")}>Unschedule</Button>}
            <Button size="sm" variant="danger" loading={busy === "reject"} onClick={() => act("reject")}><X className="h-3.5 w-3.5" /> Send back</Button>
            <Button size="sm" variant="ghost" className="ml-auto" loading={busy === "delete"} onClick={() => act("delete")}>Remove</Button>
          </div>
        </>
      )}
    </Card>
  );
}

function UsersTab({ onChange }: { onChange: () => void }) {
  const toast = useApp((s) => s.toast);
  const me = useApp((s) => s.status?.me.user.id);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState("");
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [pw, setPw] = useState("");

  const load = useCallback(() => api<AdminUser[]>("/api/admin/users").then(setUsers).catch((e) => toast((e as Error).message, "error")), [toast]);
  useEffect(() => {
    load();
  }, [load]);

  async function patch(id: string, p: Record<string, unknown>, msg: string) {
    try {
      await api("/api/admin/users", { method: "PATCH", body: { id, ...p } });
      toast(msg, "success");
      load();
      onChange();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const shown = users.filter((u) => !q || u.email.includes(q.toLowerCase()) || u.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Card>
      <CardHeader title={`${users.length} users`} subtitle="Change plans, require approval before posting, suspend, or reset a password." action={<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="w-48" aria-label="Search users" />} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-white/40">
            <tr><th className="px-5 py-3">User</th><th className="px-3 py-3">Plan</th><th className="px-3 py-3">Usage this month</th><th className="px-3 py-3">Posts</th><th className="px-3 py-3">Approval</th><th className="px-3 py-3">Status</th><th className="px-5 py-3" /></tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {shown.map((u) => {
              const plan = PLANS.find((p) => p.id === u.plan)!;
              return (
                <tr key={u.id} className="align-top">
                  <td className="px-5 py-3">
                    <p className="font-medium text-white">{u.name} {u.isOwner ? <Badge tone="gold">owner</Badge> : u.isCoOwner ? <Badge tone="gold">co-owner</Badge> : u.role === "admin" && <Badge tone="gold">admin</Badge>} {u.staff && u.role !== "admin" && <Badge tone="mint">employee · unlimited</Badge>}</p>
                    <p className="text-xs text-white/45">{u.email}</p>
                    <p className="text-xs text-white/35">Joined {new Date(u.createdAt).toLocaleDateString()}{u.lastLoginAt ? ` · last seen ${new Date(u.lastLoginAt).toLocaleDateString()}` : ""}</p>
                  </td>
                  <td className="px-3 py-3">
                    <Select value={u.plan} onChange={(e) => patch(u.id, { plan: e.target.value }, `Plan changed to ${e.target.value}`)} className="w-36" aria-label="Plan">
                      {PLANS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                    {u.billing?.status && <p className="mt-1 text-xs text-white/40">Stripe: {u.billing.status}</p>}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-white/70">
                    {u.usage.credits.toLocaleString()} / {plan.credits.toLocaleString()} credits
                    <br />
                    {u.usage.posts.toLocaleString()} / {plan.postsPerMonth === null ? "∞" : plan.postsPerMonth.toLocaleString()} posts
                  </td>
                  <td className="px-3 py-3 tabular-nums text-white/70">{u.counts.total} total<br />{u.counts.scheduled} scheduled{u.counts.review ? <><br /><span className="text-gold-300">{u.counts.review} in review</span></> : null}</td>
                  <td className="px-3 py-3"><Switch checked={u.requireApproval} onChange={(v) => patch(u.id, { requireApproval: v }, v ? "Posts now need approval" : "Approval no longer required")} label="Require approval" /></td>
                  <td className="px-3 py-3"><Badge tone={u.status === "active" ? "mint" : "red"}>{u.status}</Badge></td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => patch(u.id, { resetUsage: true }, "Usage reset")} title="Reset this month's usage"><RotateCcw className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => { setResetFor(u.id); setPw(""); }} title="Set a new password"><KeyRound className="h-3.5 w-3.5" /></Button>
                      {u.id !== me && !u.isOwner && (
                        <>
                          {u.role !== "admin" && (u.staff
                            ? <Button size="sm" onClick={() => patch(u.id, { staff: false }, "Employee access removed")}>Remove employee</Button>
                            : <Button size="sm" onClick={() => { if (confirm(`Make ${u.email} an employee? They get unlimited use, without admin access.`)) void patch(u.id, { staff: true }, "Employee: unlimited use"); }} title="Unlimited use, no admin access">Make employee</Button>)}
                          {!u.isCoOwner && <Button size="sm" variant="primary" onClick={() => { if (confirm(`Make ${u.email} a co-owner? They get full admin access and unlimited use.`)) void patch(u.id, { makeCoOwner: true }, "Co-owner: admin access and unlimited use"); }} title="Admin access and the Unlimited plan">Make co-owner</Button>}
                          <Button size="sm" onClick={() => patch(u.id, { role: u.role === "admin" ? "user" : "admin" }, u.role === "admin" ? "Admin removed" : "Made admin")}>{u.role === "admin" ? "Remove admin" : "Make admin"}</Button>
                          <Button size="sm" variant={u.status === "active" ? "danger" : "primary"} onClick={() => patch(u.id, { status: u.status === "active" ? "suspended" : "active" }, u.status === "active" ? "Suspended" : "Reactivated")}>{u.status === "active" ? "Suspend" : "Reactivate"}</Button>
                        </>
                      )}
                    </div>
                    {resetFor === u.id && (
                      <div className="mt-2 flex gap-1.5">
                        <Input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (10+ chars)" className="h-8" autoComplete="off" />
                        <Button size="sm" variant="primary" disabled={pw.length < 10} onClick={async () => { await patch(u.id, { newPassword: pw }, "Password reset — share it with the user securely"); setResetFor(null); }}>Set</Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AppSettingsTab() {
  const toast = useApp((s) => s.toast);
  const [data, setData] = useState<AppSettingsPayload | null>(null);
  const load = useCallback(() => api<AppSettingsPayload>("/api/admin/settings").then(setData).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!data) return <div className="glass h-64 animate-pulse" />;
  const s = data.settings;
  async function save(patch: Partial<AppSettingsPayload["settings"]>) {
    try {
      const next = await api<AppSettingsPayload["settings"]>("/api/admin/settings", { method: "PUT", body: patch });
      setData((d) => (d ? { ...d, settings: next } : d));
      toast("Saved", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  const env = data.env;
  const health: [string, boolean, string][] = [
    ["Claude (AI writing)", env.llm, "Add the key in Integrations"],
    ["Voiceover (ElevenLabs)", env.voice, "Optional — add in Integrations"],
    ["Stock footage (Pixabay)", env.stock, "Optional — add in Integrations"],
    ["Subscriptions (Stripe)", env.stripe && env.webhook, env.stripe ? "Press Connect Stripe again" : "Connect Stripe in Integrations"],
    ["Password-reset email", env.email, "Optional — add Resend in Integrations"],
    ["Support email (legal pages)", !!s.supportEmail, "Add it in Sign-ups and approval"],
    ["Public app URL", !!env.appUrl, "Set APP_URL on the server"],
    ["Scheduler", env.cron || env.scheduler, "INTERNAL_SCHEDULER=1 or CRON_SECRET"],
    ["Encryption key", env.encryption, "Set ENCRYPTION_KEY on the server"],
    ["Database", env.storage === "supabase" || env.dataDir, env.storage === "supabase" ? "Supabase" : "Mount a volume and set DATA_DIR"],
  ];
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <IntegrationsCard onChange={load} />
      <Card>
        <CardHeader title="Sign-ups and approval" />
        <div className="grid grid-cols-1 gap-3 p-5">
          <Row title="Allow new sign-ups" desc="Turn off to make the app invite-only." control={<Switch checked={s.allowSignups} onChange={(v) => save({ allowSignups: v })} label="Allow sign-ups" />} />
          <Row title="New users need approval" desc="Their scheduled posts wait in Content review until you approve them." control={<Switch checked={s.requireApprovalForNewUsers} onChange={(v) => save({ requireApprovalForNewUsers: v })} label="Require approval for new users" />} />
          <Field label="Support email" hint="shown to users and on the legal pages">
            <Input type="email" defaultValue={s.supportEmail} onBlur={(e) => e.target.value !== s.supportEmail && save({ supportEmail: e.target.value })} placeholder="support@yourdomain.com" />
          </Field>
          <Field label="Business name" hint="shown on Terms and Privacy">
            <Input defaultValue={s.legalName} onBlur={(e) => e.target.value !== s.legalName && save({ legalName: e.target.value })} placeholder="Ghost Post" />
          </Field>
          <Field label="Governing law" hint="used in the Terms">
            <Input defaultValue={s.legalJurisdiction} onBlur={(e) => e.target.value !== s.legalJurisdiction && save({ legalJurisdiction: e.target.value })} placeholder="the State of Texas, USA" />
          </Field>
          <p className="text-xs text-white/45">
            Public pages: <a className="text-mint-300 hover:underline" href="/terms" target="_blank">Terms</a> ·{" "}
            <a className="text-mint-300 hover:underline" href="/privacy" target="_blank">Privacy</a> ·{" "}
            <a className="text-mint-300 hover:underline" href="/data-deletion" target="_blank">Data deletion</a> — use these links in Stripe and in the X, Meta, Google, LinkedIn and TikTok developer portals.
          </p>
        </div>
      </Card>
      <Card>
        <CardHeader title="Health check" subtitle="What's configured on the server" />
        <ul className="divide-y divide-white/[0.05]">
          {health.map(([label, ok, hint]) => (
            <li key={label} className="flex items-center gap-3 px-5 py-3 text-sm">
              <span className={cn("h-2 w-2 rounded-full", ok ? "bg-mint-400" : "bg-gold-400")} />
              <span className="text-white/85">{label}</span>
              <span className={cn("ml-auto text-right text-xs", ok ? "text-mint-300/80" : "text-white/45")}>{ok ? "Ready" : hint}</span>
            </li>
          ))}
        </ul>
      </Card>
      <MoveServerCard />
    </div>
  );
}

/** Makes the one-time code a new server uses to copy everything from this one (see src/lib/migrate.ts). */
function MoveServerCard() {
  const toast = useApp((s) => s.toast);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function make() {
    setBusy(true);
    try {
      setCode((await api<{ code: string }>("/api/admin/migrate", { method: "POST" })).code);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title="Move to a new server" subtitle="Copies every account, post, upload and setting to a new Ghost Post server, then sends everyone from this address to the new one." />
      <div className="grid grid-cols-1 gap-3 p-5 text-sm">
        <p className="text-white/65">On the new server, open <span className="font-mono text-white/85">/restore</span> and paste the code. It works once and only for 15 minutes. Keep it private: it lets the new server copy everything, including your keys.</p>
        {code ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-white/[0.05] px-3 py-2 font-mono text-xs text-white/90">{code}</code>
            <Button size="sm" onClick={() => copyToClipboard(code).then(() => toast("Code copied.", "success"))}>Copy</Button>
          </div>
        ) : null}
        <div><Button loading={busy} onClick={make}>{code ? "Make a new code" : "Make a move code"}</Button></div>
      </div>
    </Card>
  );
}

function Row({ title, desc, control }: { title: string; desc: string; control: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl bg-white/[0.03] p-3.5 ring-1 ring-white/[0.06]">
      <div>
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="text-xs text-white/45">{desc}</p>
      </div>
      {control}
    </div>
  );
}

/* ───────────── Integrations: paste keys in the app (stored encrypted on the server) ───────────── */

type TestResult = { ok: boolean; message: string };

function IntegrationsCard({ onChange }: { onChange: () => void }) {
  const toast = useApp((s) => s.toast);
  const [st, setSt] = useState<IntegrationStatus | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TestResult>>({});

  const load = useCallback(
    () => api<IntegrationStatus>("/api/admin/integrations").then(setSt).catch((e: Error) => toast(e.message, "error")),
    [toast],
  );
  useEffect(() => {
    load();
  }, [load]);

  const set = (k: string) => (e: { target: { value: string } }) => setVals((v) => ({ ...v, [k]: e.target.value }));

  async function run<T>(id: string, fn: () => Promise<T>, done?: (r: T) => void) {
    setBusy(id);
    try {
      const r = await fn();
      done?.(r);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  function save(fields: string[], label: string, test?: "anthropic" | "gemini" | "elevenlabs" | "pixabay" | "pexels" | "email" | "replicate" | "videoEngine" | "videoEngineGpu" | "ownWriter" | "uploadPost") {
    const patch = Object.fromEntries(fields.filter((f) => (vals[f] ?? "").trim()).map((f) => [f, vals[f].trim()]));
    if (!Object.keys(patch).length) return toast("Fill in a field first.", "error");
    run(`save:${label}`, () => api<IntegrationStatus>("/api/admin/integrations", { method: "PUT", body: patch }), async (next) => {
      setSt(next);
      setVals((v) => {
        const c = { ...v };
        fields.forEach((f) => delete c[f]);
        return c;
      });
      toast(`${label} saved`, "success");
      onChange();
      if (test) await check(test);
    });
  }

  function remove(field: string, label: string) {
    if (!confirm(`Remove the ${label} key saved in the app? If the server has its own key, the app goes back to using that one.`)) return;
    run(`rm:${field}`, () => api<IntegrationStatus>("/api/admin/integrations", { method: "PUT", body: { [field]: "" } }), (next) => {
      setSt(next);
      toast(`${label} key removed`, "success");
      onChange();
    });
  }

  function clearWorkspace() {
    run("rm:anthropicWorkspaceId", () => api<IntegrationStatus>("/api/admin/integrations", { method: "PUT", body: { anthropicWorkspaceId: "" } }), (next) => {
      setSt(next);
      toast("Workspace ID cleared", "success");
    });
  }

  function resetGeminiModel() {
    run("rm:geminiModel", () => api<IntegrationStatus>("/api/admin/integrations", { method: "PUT", body: { geminiModel: "" } }), (next) => {
      setSt(next);
      toast("Gemini model reset to the app's default", "success");
    });
  }

  function toggle(field: "geminiForTrials" | "geminiBackup", on: boolean) {
    run(`toggle:${field}`, () => api<IntegrationStatus>("/api/admin/integrations", { method: "PUT", body: { [field]: on } }), (next) => {
      setSt(next);
      toast(on ? "Turned on" : "Turned off", "success");
    });
  }

  async function check(which: "anthropic" | "gemini" | "elevenlabs" | "pixabay" | "pexels" | "stripe" | "email" | "replicate" | "videoEngine" | "videoEngineGpu" | "ownWriter" | "uploadPost") {
    await run(`test:${which}`, () => api<TestResult>("/api/admin/integrations", { body: { action: "test", which } }), (r) =>
      setResults((x) => ({ ...x, [which]: r })),
    );
  }

  function connectStripe() {
    const secretKey = (vals.stripeSecretKey ?? "").trim();
    if (!secretKey && !st?.stripe.set) return toast("Paste your Stripe secret key first.", "error");
    run(
      "stripe",
      () => api<{ mode: string; prices: number; status: IntegrationStatus }>("/api/admin/integrations", { body: { action: "stripe-connect", secretKey } }),
      (r) => {
        setSt(r.status);
        setVals((v) => ({ ...v, stripeSecretKey: "" }));
        toast(`Stripe connected in ${r.mode.toUpperCase()} mode — ${r.prices} prices, webhook and customer portal ready.`, "success");
        onChange();
      },
    );
  }

  function disconnectStripe() {
    if (!confirm("Disconnect Stripe? New checkouts stop working until you connect again. Your products and existing subscriptions stay in Stripe.")) return;
    run("stripe-off", () => api<IntegrationStatus>("/api/admin/integrations", { body: { action: "stripe-disconnect" } }), (next) => {
      setSt(next);
      toast("Stripe disconnected", "success");
      onChange();
    });
  }

  if (!st) return <div className="glass h-72 animate-pulse lg:col-span-2" />;
  const s = st.stripe;
  const stripeComplete = s.set && s.prices === s.pricesNeeded && s.webhook;

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Integrations"
        subtitle="Paste your service keys here. They're encrypted on the server and never shown again — only the first and last characters."
        icon={<KeyRound className="h-4 w-4" />}
      />
      <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
        <Service
          icon={<Bot className="h-4 w-4" />}
          title="Claude — AI writing"
          desc="Writes niches, posts, scripts, video plans and replies. Required."
          link={{ href: "https://console.anthropic.com/settings/keys", label: "Get a key" }}
          state={st.anthropic}
          result={results.anthropic}
        >
          {st.anthropic.source === "server" && <ServerNote />}
          <Input type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={vals.anthropicKey ?? ""} onChange={set("anthropicKey")} />
          <Input
            autoComplete="off"
            spellCheck={false}
            placeholder={st.anthropic.workspaceId ? `Workspace: ${st.anthropic.workspaceId}` : "Workspace ID (only if Test asks for it) — wrkspc_…"}
            value={vals.anthropicWorkspaceId ?? ""}
            onChange={set("anthropicWorkspaceId")}
          />
          <Actions>
            <Button size="sm" variant="primary" loading={busy === "save:Claude"} onClick={() => save(["anthropicKey", "anthropicWorkspaceId"], "Claude", "anthropic")}>Save</Button>
            <Button size="sm" loading={busy === "test:anthropic"} disabled={!st.anthropic.set} onClick={() => check("anthropic")}>Test</Button>
            {st.anthropic.set && st.anthropic.source === "app" && (
              <Button size="sm" variant="ghost" loading={busy === "rm:anthropicKey"} onClick={() => remove("anthropicKey", "Claude")}><Trash2 className="h-3.5 w-3.5" /></Button>
            )}
            {st.anthropic.workspaceId && (
              <Button size="sm" variant="ghost" loading={busy === "rm:anthropicWorkspaceId"} onClick={clearWorkspace}>Clear workspace</Button>
            )}
          </Actions>
        </Service>

        <Service
          icon={<Sparkles className="h-4 w-4" />}
          title="Gemini — free trials & backup"
          desc="Your own Google Gemini key. Free-trial accounts write with it, and it steps in automatically whenever Claude can't answer (no credits, overloaded), so subscribers never need an AI account of their own. It also powers Movie Studio: character portraits and scene pictures (Nano Banana) and animated scenes (Gemini Omni Flash), billed by Google on this key's project. Optional."
          link={{ href: "https://aistudio.google.com/apikey", label: "Get a key" }}
          state={st.gemini}
          result={results.gemini}
        >
          {st.gemini.source === "server" && <ServerNote />}
          <Input type="password" autoComplete="off" spellCheck={false} placeholder="Gemini API key (AIza…)" value={vals.geminiKey ?? ""} onChange={set("geminiKey")} />
          <Input
            autoComplete="off"
            spellCheck={false}
            placeholder={`Model: ${st.gemini.model} — leave blank to keep`}
            value={vals.geminiModel ?? ""}
            onChange={set("geminiModel")}
          />
          <label className="flex items-start gap-2 text-xs text-white/70">
            <input
              type="checkbox"
              className="mt-0.5 accent-emerald-400"
              checked={st.gemini.forTrials}
              disabled={busy === "toggle:geminiForTrials"}
              onChange={(e) => toggle("geminiForTrials", e.target.checked)}
            />
            <span>Free trials write with Gemini (keeps trial cost off your Claude balance). Posts that need live news checking still use Claude.</span>
          </label>
          <label className="flex items-start gap-2 text-xs text-white/70">
            <input
              type="checkbox"
              className="mt-0.5 accent-emerald-400"
              checked={st.gemini.backup}
              disabled={busy === "toggle:geminiBackup"}
              onChange={(e) => toggle("geminiBackup", e.target.checked)}
            />
            <span>Use Gemini as the backup when Claude is busy or down, so nobody is blocked. When Claude is out of credits or its key is rejected, Gemini always takes over (and goes first for 10 minutes), even with this off.</span>
          </label>
          <p className="text-[11px] leading-relaxed text-white/45">
            Use a key from a Google Cloud project with <b className="text-white/70">billing turned on</b>. On Google's free tier, prompts and answers may be used to improve Google's products, and daily limits are small. Gemini content is written by a different AI than Claude, so compare a few posts before relying on it for paying customers.
          </p>
          <Actions>
            <Button size="sm" variant="primary" loading={busy === "save:Gemini"} onClick={() => save(["geminiKey", "geminiModel"], "Gemini", "gemini")}>Save &amp; test</Button>
            <Button size="sm" loading={busy === "test:gemini"} disabled={!st.gemini.set} onClick={() => check("gemini")}>Test</Button>
            {st.gemini.set && st.gemini.source === "app" && (
              <Button size="sm" variant="ghost" loading={busy === "rm:geminiKey"} onClick={() => remove("geminiKey", "Gemini")}><Trash2 className="h-3.5 w-3.5" /></Button>
            )}
            {st.gemini.set && (
              <Button size="sm" variant="ghost" loading={busy === "rm:geminiModel"} onClick={resetGeminiModel}>Reset model</Button>
            )}
          </Actions>
        </Service>

        <Service
          icon={<Sparkles className="h-4 w-4" />}
          title="Replicate — Seedance 2.5 and Wan 2.2 video"
          desc="Adds two engines for animating Movie Studio scenes, next to Gemini Omni Flash: ByteDance's Seedance 2.5 ($0.2312 a second at 720p) and the open-weight Wan 2.2 (at most $0.145 a 5-second clip), prices as of Oct 2026. Replicate bills this token's account; subscribers pay in credits. Scene pictures still use the Gemini key. Optional."
          link={{ href: "https://replicate.com/account/api-tokens", label: "Get a token" }}
          state={st.replicate}
          result={results.replicate}
        >
          {st.replicate.source === "server" && <ServerNote />}
          <Input type="password" autoComplete="off" spellCheck={false} placeholder="Replicate API token (r8_…)" value={vals.replicateKey ?? ""} onChange={set("replicateKey")} />
          <p className="text-[11px] leading-relaxed text-white/45">Turn on billing at replicate.com → Account → Billing first; Seedance won't run on an account without it.</p>
          <Actions>
            <Button size="sm" variant="primary" loading={busy === "save:Replicate"} onClick={() => save(["replicateKey"], "Replicate", "replicate")}>Save &amp; test</Button>
            <Button size="sm" loading={busy === "test:replicate"} disabled={!st.replicate.set} onClick={() => check("replicate")}>Test</Button>
            {st.replicate.set && st.replicate.source === "app" && (
              <Button size="sm" variant="ghost" loading={busy === "rm:replicateKey"} onClick={() => remove("replicateKey", "Replicate")}><Trash2 className="h-3.5 w-3.5" /></Button>
            )}
          </Actions>
        </Service>

        <Service
          icon={<Share2 className="h-4 w-4" />}
          title="Social connect service (Upload-Post) — one tap for every network"
          desc="With this key, every user connects Instagram, Facebook, TikTok, YouTube, LinkedIn and X with one tap: they sign in on the network's own page and come straight back. No developer apps, testers or app reviews for you. Posts go out through Upload-Post. Plans: Basic $24/month (5 customers), Professional $50/month (25 customers). Automatic comment replies still need a network connected directly."
          link={{ href: "https://app.upload-post.com", label: "Get a key" }}
          state={st.uploadPost ?? { set: false }}
          result={results.uploadPost}
        >
          <Input type="password" autoComplete="off" spellCheck={false} placeholder="Upload-Post API key" value={vals.uploadPostKey ?? ""} onChange={set("uploadPostKey")} />
          <Actions>
            <Button size="sm" variant="primary" loading={busy === "save:Connect service"} onClick={() => save(["uploadPostKey"], "Connect service", "uploadPost")}>Save &amp; test</Button>
            <Button size="sm" loading={busy === "test:uploadPost"} disabled={!st.uploadPost?.set} onClick={() => check("uploadPost")}>Test</Button>
            {st.uploadPost?.set && st.uploadPost.source === "app" && (
              <Button size="sm" variant="ghost" loading={busy === "rm:uploadPostKey"} onClick={() => remove("uploadPostKey", "Connect service")}><Trash2 className="h-3.5 w-3.5" /></Button>
            )}
          </Actions>
        </Service>

        <Service
          icon={<Bot className="h-4 w-4" />}
          title="Ghost Post's own writer — no Claude or Gemini credits"
          desc="An open AI model (Qwen3-4B) running on your own Azure server, which writes posts, scripts, plans and replies before Claude or Gemini are asked. It costs nothing per use: it loads when someone writes and unloads after 30 quiet minutes. It's slower than Claude (a post takes about 30–90 seconds) and can't read pictures or search the web."
          link={{ href: "https://github.com/Lmtjfoundation/Video/blob/nexus-pulse-autopilot/README.md#go-live-on-an-azure-vm-what-ghost-post-runs-on", label: "Setup guide" }}
          state={st.ownWriter ?? { set: false }}
          result={results.ownWriter}
        >
          {st.ownWriter?.url && <p className="text-xs text-white/55">Writing with {st.ownWriter.model || "the default model"} at {st.ownWriter.url}.</p>}
          <Input autoComplete="off" spellCheck={false} placeholder={st.ownWriter?.url || "Writer address, e.g. https://writer.20-127-104-87.sslip.io/v1"} value={vals.ownWriterUrl ?? ""} onChange={set("ownWriterUrl")} />
          <Input type="password" autoComplete="off" spellCheck={false} placeholder="Writer key (OWN_WRITER_KEY)" value={vals.ownWriterKey ?? ""} onChange={set("ownWriterKey")} />
          <label className="flex items-center gap-3 text-sm text-white/80">
            <Switch
              checked={!!st.ownWriter?.only}
              disabled={!st.ownWriter?.url || busy === "only"}
              onChange={(v) => run("only", () => api<IntegrationStatus>("/api/admin/integrations", { method: "PUT", body: { ownWriterOnly: v } }), (next) => { setSt(next); toast(v ? "Only the own writer is used now." : "Claude and Gemini can step in again.", "success"); })}
              label="Only use the own writer (never Claude or Gemini)"
            />
            Only use the own writer (never Claude or Gemini)
          </label>
          <Actions>
            <Button size="sm" variant="primary" loading={busy === "save:Own writer"} onClick={() => save(["ownWriterUrl", "ownWriterKey"], "Own writer", "ownWriter")}>Save &amp; test</Button>
            <Button size="sm" loading={busy === "test:ownWriter"} disabled={!st.ownWriter?.url} onClick={() => check("ownWriter")}>Test</Button>
          </Actions>
        </Service>

        <Service
          icon={<Film className="h-4 w-4" />}
          title="Ghost Post Video Engine — your own video model"
          desc="Ghost Post's own filmmaking model (Wan 2.2 I2V-A14B, the strongest open video model; or TI2V-5B for smaller GPUs) on a GPU server you rent (Microsoft Azure in one command, using the nonprofit Azure credit, or RunPod). The Film Engine makes moving footage with it: no Seedance, no Replicate, no per-clip fee; you pay only for the GPU while it runs. Set it up from engine/README.md in the repo, then paste the server's address and its ENGINE_TOKEN here."
          link={{ href: "https://github.com/Lmtjfoundation/Video/blob/nexus-pulse-autopilot/engine/README.md", label: "Setup guide" }}
          state={st.videoEngine}
          result={results.videoEngine}
        >
          {st.videoEngine.source === "server" && <ServerNote />}
          <Input autoComplete="off" spellCheck={false} placeholder={st.videoEngine.url || "Engine address, e.g. https://abc123-8000.proxy.runpod.net"} value={vals.videoEngineUrl ?? ""} onChange={set("videoEngineUrl")} />
          <Input type="password" autoComplete="off" spellCheck={false} placeholder="ENGINE_TOKEN" value={vals.videoEngineToken ?? ""} onChange={set("videoEngineToken")} />
          <Actions>
            <Button size="sm" variant="primary" loading={busy === "save:Video engine"} onClick={() => save(["videoEngineUrl", "videoEngineToken"], "Video engine", "videoEngine")}>Save &amp; test</Button>
            <Button size="sm" loading={busy === "test:videoEngine"} disabled={!st.videoEngine.set} onClick={() => check("videoEngine")}>Test</Button>
            {st.videoEngine.set && st.videoEngine.source === "app" && (
              <Button size="sm" variant="ghost" loading={busy === "rm:videoEngineToken"} onClick={() => remove("videoEngineToken", "Video engine")}><Trash2 className="h-3.5 w-3.5" /></Button>
            )}
          </Actions>
        </Service>

        <Service
          icon={<Power className="h-4 w-4" />}
          title="Wake the engine's VM — start it when it's needed"
          desc="When the engine's machine is switched off (for example by its nightly shutdown), Ghost Post starts it through Azure the next time someone uses an engine tool, and waits for it (about 2–4 minutes). Paste the wake line you were given: tenant=…;client=…;secret=…;subscription=…;group=…;vm=…. It can only read and start that one VM."
          link={{ href: "https://github.com/Lmtjfoundation/Video/blob/nexus-pulse-autopilot/engine/README.md", label: "Setup guide" }}
          state={st.vmWake ?? { set: false }}
        >
          {st.vmWake?.set && <p className="text-xs text-white/55">Set for the VM “{st.vmWake.vm}”.</p>}
          <Input type="password" autoComplete="off" spellCheck={false} placeholder="tenant=…;client=…;secret=…;subscription=…;group=…;vm=…" value={vals.vmWake ?? ""} onChange={set("vmWake")} />
          <Actions>
            <Button size="sm" variant="primary" loading={busy === "save:Wake"} onClick={() => save(["vmWake"], "Wake")}>Save</Button>
            {st.vmWake?.set && st.vmWake.source === "app" && (
              <Button size="sm" variant="ghost" loading={busy === "rm:vmWake"} onClick={() => remove("vmWake", "Wake")}><Trash2 className="h-3.5 w-3.5" /></Button>
            )}
          </Actions>
        </Service>

        <Service
          icon={<Sparkles className="h-4 w-4" />}
          title="GPU engine — pictures, clips, voices and lip sync"
          desc="A second engine on a GPU machine (for example an Azure NV36ads A10 v5, billed only while it runs). Ghost Post sends it everything the engine above can't do, starts it when needed with its own wake line, and it stops itself after 20 idle minutes. Writing and pictures use it only while it's already on (otherwise Claude and Gemini are cheaper than starting a GPU)."
          link={{ href: "https://github.com/Lmtjfoundation/Video/blob/nexus-pulse-autopilot/engine/README.md", label: "Setup guide" }}
          state={st.videoEngineGpu ?? { set: false }}
          result={results.videoEngineGpu}
        >
          <Input autoComplete="off" spellCheck={false} placeholder={st.videoEngineGpu?.url || "GPU engine address, e.g. https://20-1-2-3.sslip.io"} value={vals.videoEngineGpuUrl ?? ""} onChange={set("videoEngineGpuUrl")} />
          <Input type="password" autoComplete="off" spellCheck={false} placeholder="ENGINE_TOKEN" value={vals.videoEngineGpuToken ?? ""} onChange={set("videoEngineGpuToken")} />
          <Input type="password" autoComplete="off" spellCheck={false} placeholder={st.vmWakeGpu?.set ? `Wake line set for “${st.vmWakeGpu.vm}”` : "Wake line: tenant=…;client=…;secret=…;subscription=…;group=…;vm=…"} value={vals.vmWakeGpu ?? ""} onChange={set("vmWakeGpu")} />
          <Actions>
            <Button size="sm" variant="primary" loading={busy === "save:GPU engine"} onClick={() => save(["videoEngineGpuUrl", "videoEngineGpuToken", "vmWakeGpu"].filter((k) => vals[k]), "GPU engine", "videoEngineGpu")}>Save &amp; test</Button>
            <Button size="sm" loading={busy === "test:videoEngineGpu"} disabled={!st.videoEngineGpu?.set} onClick={() => check("videoEngineGpu")}>Test</Button>
            {st.videoEngineGpu?.set && st.videoEngineGpu.source === "app" && (
              <Button size="sm" variant="ghost" loading={busy === "rm:videoEngineGpuToken"} onClick={() => remove("videoEngineGpuToken", "GPU engine")}><Trash2 className="h-3.5 w-3.5" /></Button>
            )}
          </Actions>
        </Service>

        <Service
          icon={<Mic className="h-4 w-4" />}
          title="ElevenLabs — voiceover"
          desc="Narrates rendered videos. Optional: without it videos render with captions and music only."
          link={{ href: "https://elevenlabs.io/app/settings/api-keys", label: "Get a key" }}
          state={st.elevenlabs}
          result={results.elevenlabs}
        >
          {st.elevenlabs.source === "server" && <ServerNote />}
          <Input type="password" autoComplete="off" spellCheck={false} placeholder="ElevenLabs API key" value={vals.elevenlabsKey ?? ""} onChange={set("elevenlabsKey")} />
          <Input
            autoComplete="off"
            spellCheck={false}
            placeholder={st.elevenlabs.voiceId ? `Voice ID: ${st.elevenlabs.voiceId}` : "Voice ID (optional — default narrator)"}
            value={vals.elevenlabsVoiceId ?? ""}
            onChange={set("elevenlabsVoiceId")}
          />
          <Actions>
            <Button size="sm" variant="primary" loading={busy === "save:ElevenLabs"} onClick={() => save(["elevenlabsKey", "elevenlabsVoiceId"], "ElevenLabs", "elevenlabs")}>Save</Button>
            <Button size="sm" loading={busy === "test:elevenlabs"} disabled={!st.elevenlabs.set} onClick={() => check("elevenlabs")}>Test</Button>
            {st.elevenlabs.set && st.elevenlabs.source === "app" && (
              <Button size="sm" variant="ghost" loading={busy === "rm:elevenlabsKey"} onClick={() => remove("elevenlabsKey", "ElevenLabs")}><Trash2 className="h-3.5 w-3.5" /></Button>
            )}
          </Actions>
        </Service>

        <Service
          icon={<Film className="h-4 w-4" />}
          title="Pixabay — stock footage"
          desc="Free HD video clips matched to each scene. Optional: without it scenes use your uploads or animated backgrounds."
          link={{ href: "https://pixabay.com/api/docs/", label: "Get a free key" }}
          state={st.pixabay}
          result={results.pixabay}
        >
          {st.pixabay.source === "server" && <ServerNote />}
          <Input type="password" autoComplete="off" spellCheck={false} placeholder="Pixabay API key (numbers-letters)" value={vals.pixabayKey ?? ""} onChange={set("pixabayKey")} />
          <p className="text-[11px] leading-relaxed text-white/45">
            Sign in at pixabay.com, open the API docs page, and copy the value shown in the <b className="text-white/70">key</b> row of the parameters table.
          </p>
          <Actions>
            <Button size="sm" variant="primary" loading={busy === "save:Pixabay"} onClick={() => save(["pixabayKey"], "Pixabay", "pixabay")}>Save</Button>
            <Button size="sm" loading={busy === "test:pixabay"} disabled={!st.pixabay.set} onClick={() => check("pixabay")}>Test</Button>
            {st.pixabay.set && st.pixabay.source === "app" && (
              <Button size="sm" variant="ghost" loading={busy === "rm:pixabayKey"} onClick={() => remove("pixabayKey", "Pixabay")}><Trash2 className="h-3.5 w-3.5" /></Button>
            )}
            {st.pexels.set && st.pexels.source === "app" && (
              <Button size="sm" variant="ghost" loading={busy === "rm:pexelsKey"} onClick={() => remove("pexelsKey", "Pexels")}>Remove old Pexels key</Button>
            )}
          </Actions>
        </Service>

        <Service
          icon={<Mail className="h-4 w-4" />}
          title="Email — password resets"
          desc="Sends “Forgot password?” links through Resend (free tier: 3,000 emails a month). Needs a domain you verify in Resend."
          link={{ href: "https://resend.com/api-keys", label: "Get a key" }}
          state={st.email}
          result={results.email}
        >
          {st.email.source === "server" && <ServerNote />}
          <Input type="password" autoComplete="off" spellCheck={false} placeholder="re_…" value={vals.resendKey ?? ""} onChange={set("resendKey")} />
          <Input
            autoComplete="off"
            spellCheck={false}
            placeholder={st.email.from ? `From: ${st.email.from}` : "From, e.g. Ghost Post <support@yourdomain.com>"}
            value={vals.emailFrom ?? ""}
            onChange={set("emailFrom")}
          />
          <Actions>
            <Button size="sm" variant="primary" loading={busy === "save:Email"} onClick={() => save(["resendKey", "emailFrom"], "Email", "email")}>Save &amp; send test</Button>
            <Button size="sm" loading={busy === "test:email"} disabled={!st.email.set || !st.email.from} onClick={() => check("email")}>Send test</Button>
            {st.email.set && st.email.source === "app" && (
              <Button size="sm" variant="ghost" loading={busy === "rm:resendKey"} onClick={() => remove("resendKey", "Resend")}><Trash2 className="h-3.5 w-3.5" /></Button>
            )}
          </Actions>
        </Service>

        <Service
          icon={<CreditCard className="h-4 w-4" />}
          title="Stripe — subscriptions"
          desc="One click creates your 3 paid plans (monthly + yearly), the payment webhook and the customer billing portal in your Stripe account."
          link={{ href: "https://dashboard.stripe.com/apikeys", label: "API keys" }}
          state={s}
          result={results.stripe}
          extra={
            s.set ? (
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={s.mode === "live" ? "mint" : "gold"}>{s.mode === "live" ? "LIVE — real payments" : "TEST mode — test cards only"}</Badge>
                <Badge tone={s.prices === s.pricesNeeded ? "mint" : "gold"}>{s.prices}/{s.pricesNeeded} prices</Badge>
                <Badge tone={s.webhook ? "mint" : "gold"}>{s.webhook ? "Webhook ✓" : "No webhook"}</Badge>
                <Badge tone={s.portal ? "mint" : "neutral"}>{s.portal ? "Portal ✓" : "Default portal"}</Badge>
              </div>
            ) : null
          }
        >
          {s.source === "server" && <ServerNote />}
          <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={s.set ? "Paste a new key to switch (e.g. sk_live_…)" : "sk_test_… or sk_live_…"}
              value={vals.stripeSecretKey ?? ""}
              onChange={set("stripeSecretKey")}
            />
          <Actions>
            <Button size="sm" variant={stripeComplete ? "secondary" : "gold"} loading={busy === "stripe"} onClick={connectStripe}>
              {s.set ? <RefreshCw className="h-3.5 w-3.5" /> : <CircleDollarSign className="h-3.5 w-3.5" />}
              {s.set ? (vals.stripeSecretKey ? "Switch key & sync plans" : "Re-sync plans") : "Connect Stripe & create plans"}
            </Button>
            <Button size="sm" loading={busy === "test:stripe"} disabled={!s.set} onClick={() => check("stripe")}>Test</Button>
            {s.set && s.source === "app" && (
              <Button size="sm" variant="ghost" loading={busy === "stripe-off"} onClick={disconnectStripe}><Trash2 className="h-3.5 w-3.5" /></Button>
            )}
          </Actions>
          {s.mode === "test" && (
            <p className="text-[11px] leading-relaxed text-white/45">
              Test mode: pay with card 4242 4242 4242 4242, any future date, any CVC. To take real money, activate your Stripe account, then paste your <b className="text-white/70">sk_live_</b> key here and press the button again.
            </p>
          )}
        </Service>
      </div>
    </Card>
  );
}

function Service({
  icon,
  title,
  desc,
  link,
  state,
  result,
  extra,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  link: { href: string; label: string };
  state: KeyState;
  result?: TestResult;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 content-start gap-2.5 rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/[0.06]">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid grid-cols-1 h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-white/80">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">{title}</p>
            {state.set ? (
              <Badge tone="mint">
                <Check className="h-3 w-3" /> {state.source === "server" ? "Set on server" : "Connected"} · {state.preview}
              </Badge>
            ) : (
              <Badge tone="neutral">Not connected</Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-white/50">{desc}</p>
        </div>
        <a href={link.href} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-[11px] text-mint-300 hover:underline">
          {link.label} <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      {extra}
      {children}
      {result && (
        <p className={cn("rounded-lg px-3 py-2 text-xs", result.ok ? "bg-mint-400/10 text-mint-200" : "bg-red-500/10 text-red-200")}>
          {result.ok ? "✓ " : "✕ "}
          {result.message}
        </p>
      )}
    </div>
  );
}

const Actions = ({ children }: { children: React.ReactNode }) => <div className="flex flex-wrap items-center gap-2">{children}</div>;

const ServerNote = () => (
  <p className="rounded-lg bg-white/[0.04] px-3 py-2 text-xs text-white/55">Using the key set on the server. Paste a key here to replace it — a key saved here takes priority.</p>
);
