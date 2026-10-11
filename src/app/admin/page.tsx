"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, CircleDollarSign, KeyRound, Pencil, RotateCcw, Search, ShieldCheck, Users, X } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
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
  aiCostCeiling: number;
  postsPublishedThisMonth: number;
  awaitingReview: number;
}
interface AppSettingsPayload {
  settings: { allowSignups: boolean; requireApprovalForNewUsers: boolean; supportEmail: string };
  env: { stripe: boolean; webhook: boolean; storage: string; llm: boolean; appUrl: string; cron: boolean };
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
      {tab === "overview" && <Overview stats={stats} />}
      {tab === "review" && <Review onChange={loadStats} />}
      {tab === "users" && <UsersTab onChange={loadStats} />}
      {tab === "settings" && <AppSettingsTab />}
    </>
  );
}

function Overview({ stats }: { stats: Stats | null }) {
  if (!stats) return <div className="glass h-64 animate-pulse" />;
  const margin = stats.mrr > 0 ? Math.round(((stats.mrr - stats.aiCostCeiling) / stats.mrr) * 100) : null;
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Monthly recurring revenue" value={<span className="text-gradient">{usd(stats.mrr)}</span>} sub={`From active Stripe subscriptions`} icon={<CircleDollarSign className="h-4 w-4" />} accent="gold" />
        <Stat label="Users" value={stats.users} sub={`${stats.active} active · ${stats.newThisMonth} new this month`} icon={<Users className="h-4 w-4" />} accent="violet" />
        <Stat label="AI cost this month" value={`≤ ${usd(stats.aiCostCeiling)}`} sub={`${stats.creditsUsed.toLocaleString()} credits used${margin !== null ? ` · ≥${margin}% gross margin` : ""}`} accent="mint" />
        <Stat label="Waiting for review" value={stats.awaitingReview} sub={`${stats.postsPublishedThisMonth.toLocaleString()} posts published this month`} accent={stats.awaitingReview ? "red" : "mint"} />
      </div>
      <Card>
        <CardHeader title="Users by plan" />
        <div className="grid gap-3 p-5">
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
        <p className="mt-1">Connect buttons for X, Facebook, Instagram, LinkedIn, YouTube and TikTok are set up once by you in <Link className="text-mint-300 hover:underline" href="/settings?tab=accounts">Settings → Accounts</Link>. Every user then links their own accounts with one click.</p>
      </Card>
    </div>
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
    <div className="grid gap-4">
      <Card className="grid gap-3 p-4 sm:grid-cols-[220px_1fr]">
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
    <Card className="grid gap-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <PlatformChip platform={p.platform} />
        <StatusBadge status={p.status} />
        {p.mature && <Badge tone="red">18+ mature</Badge>}
        <span className="text-sm text-white/70">{row.email}</span>
        <span className="ml-auto text-xs text-white/45">{p.scheduledAt ? new Date(p.scheduledAt).toLocaleString() : "No date"}</span>
      </div>
      {edit ? (
        <div className="grid gap-2">
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
                    <p className="font-medium text-white">{u.name} {u.role === "admin" && <Badge tone="gold">admin</Badge>}</p>
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
                      {u.id !== me && (
                        <>
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
  useEffect(() => {
    api<AppSettingsPayload>("/api/admin/settings").then(setData).catch(() => {});
  }, []);
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
  const health: [string, boolean, string][] = [
    ["Claude API key", data.env.llm, "ANTHROPIC_API_KEY"],
    ["Public app URL", !!data.env.appUrl, "APP_URL"],
    ["Scheduler secret", data.env.cron, "CRON_SECRET"],
    ["Stripe payments", data.env.stripe, "STRIPE_SECRET_KEY + price IDs"],
    ["Stripe webhook", data.env.webhook, "STRIPE_WEBHOOK_SECRET"],
    ["Database", data.env.storage === "supabase", data.env.storage === "supabase" ? "Supabase" : "Local file — use Supabase in production"],
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Sign-ups and approval" />
        <div className="grid gap-3 p-5">
          <Row title="Allow new sign-ups" desc="Turn off to make the app invite-only." control={<Switch checked={s.allowSignups} onChange={(v) => save({ allowSignups: v })} label="Allow sign-ups" />} />
          <Row title="New users need approval" desc="Their scheduled posts wait in Content review until you approve them." control={<Switch checked={s.requireApprovalForNewUsers} onChange={(v) => save({ requireApprovalForNewUsers: v })} label="Require approval for new users" />} />
          <Field label="Support email" hint="shown to users">
            <Input defaultValue={s.supportEmail} onBlur={(e) => e.target.value !== s.supportEmail && save({ supportEmail: e.target.value })} placeholder="support@yourdomain.com" />
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Health check" subtitle="What's configured on the server" />
        <ul className="divide-y divide-white/[0.05]">
          {health.map(([label, ok, hint]) => (
            <li key={label} className="flex items-center gap-3 px-5 py-3 text-sm">
              <span className={cn("h-2 w-2 rounded-full", ok ? "bg-mint-400" : "bg-gold-400")} />
              <span className="text-white/85">{label}</span>
              <span className="ml-auto text-xs text-white/45">{ok ? "Ready" : hint}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
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
