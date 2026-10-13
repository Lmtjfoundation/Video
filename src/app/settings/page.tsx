"use client";
import { useEffect, useState } from "react";
import { Check, CircleDollarSign, Copy, ExternalLink, KeyRound, Link2, Plus, Save, ShieldCheck, SlidersHorizontal, Trash2, UserRound } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import type { CredentialStatus, Offer, Pillar, Platform, Settings } from "@/lib/types";
import { PILLARS, PLATFORMS, REPLY_MODES } from "@/lib/types";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";
import { OAUTH, type OAuthPlatform } from "@/lib/oauth-config";
import { COPY_LABELS, SETUP_GUIDES, type CopyKey } from "@/lib/setup-guides";
import { copyToClipboard } from "@/lib/client";
import { MODE_LABEL, PILLAR_LABEL, cn, uid } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, PlatformChip, Select, Switch, Textarea } from "@/components/ui";

const TABS = [
  { key: "general", label: "General", icon: SlidersHorizontal },
  { key: "accounts", label: "Accounts", icon: Link2 },
  { key: "safety", label: "Limits & safety", icon: ShieldCheck },
  { key: "money", label: "Revenue & offers", icon: CircleDollarSign },
  { key: "voice", label: "Voice & mature mode", icon: UserRound },
  { key: "account", label: "Account", icon: KeyRound },
] as const;

const CRED_FIELDS: Record<Platform, { key: "accessToken" | "refreshToken" | "accountId" | "handle"; label: string; secret?: boolean; placeholder?: string }[]> = {
  x: [
    { key: "accessToken", label: "OAuth 2.0 user access token", secret: true, placeholder: "scopes: tweet.read tweet.write users.read offline.access" },
    { key: "refreshToken", label: "Refresh token", secret: true, placeholder: "enables auto-refresh (needs X_CLIENT_ID)" },
    { key: "accountId", label: "Your numeric user ID", placeholder: "used to skip your own replies" },
    { key: "handle", label: "Handle", placeholder: "@yourhandle" },
  ],
  facebook: [
    { key: "accessToken", label: "Page access token", secret: true, placeholder: "pages_manage_posts, pages_manage_engagement, pages_read_user_content" },
    { key: "accountId", label: "Page ID", placeholder: "numeric Page ID" },
    { key: "handle", label: "Page name", placeholder: "Your Page" },
  ],
  linkedin: [
    { key: "accessToken", label: "Access token (w_member_social)", secret: true },
    { key: "accountId", label: "Author URN", placeholder: "urn:li:person:XXXX or urn:li:organization:123" },
  ],
  instagram: [
    { key: "accessToken", label: "Long-lived access token", secret: true, placeholder: "instagram_basic, instagram_content_publish, instagram_manage_comments" },
    { key: "accountId", label: "Instagram Business/Creator account ID" },
    { key: "handle", label: "Username", placeholder: "yourname" },
  ],
  youtube: [
    { key: "accessToken", label: "Access token (youtube.force-ssl)", secret: true },
    { key: "refreshToken", label: "Refresh token", secret: true, placeholder: "enables auto-refresh (needs GOOGLE_CLIENT_ID/SECRET)" },
    { key: "accountId", label: "Channel ID", placeholder: "UC…" },
  ],
  tiktok: [{ key: "accessToken", label: "Access token (optional — publishing is copy-ready)", secret: true }],
  webhook: [
    { key: "accessToken", label: "Webhook URL", secret: true, placeholder: "https://hooks.zapier.com/… or your Make / n8n / Slack / Discord URL" },
    { key: "refreshToken", label: "Signing secret (optional)", secret: true, placeholder: "lets your receiver verify posts came from Nexus Pulse" },
  ],
};

export default function SettingsPage() {
  const { status, toast, refresh } = useApp();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("general");
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (status && !s) setS(status.settings);
  }, [status, s]);

  // Returning from a platform sign-in: ?tab=accounts&connected=x or &error=…
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get("tab");
    if (t && TABS.some((x) => x.key === t)) setTab(t as (typeof TABS)[number]["key"]);
    const connected = q.get("connected");
    const error = q.get("error");
    if (connected && connected in PLATFORM_SPECS) toast(`${PLATFORM_SPECS[connected as Platform].name} account linked`, "success");
    if (q.get("pick") === "facebook") toast("You manage several Facebook Pages. Choose which one to post as on the Facebook card.", "info");
    if (error) toast(error, "error");
    if (t || connected || error) {
      window.history.replaceState(null, "", "/settings");
      refresh();
    }
  }, [toast, refresh]);

  if (!s || !status) return <div className="glass h-96 animate-pulse" />;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setS({ ...s, [k]: v });
    setDirty(true);
  };

  async function save() {
    setSaving(true);
    try {
      // Toggles are owned by the Command Center; don't overwrite them from a stale copy.
      const { autopilot, killSwitch, autoReply, ...rest } = s!;
      void autopilot; void killSwitch; void autoReply;
      const next = await api<Settings>("/api/settings", { method: "PUT", body: rest });
      setS(next);
      setDirty(false);
      toast("Settings saved", "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Accounts, schedule, safety limits, revenue model and voice."
        actions={<Button variant="primary" onClick={save} loading={saving} disabled={!dirty}><Save className="h-4 w-4" /> {dirty ? "Save changes" : "Saved"}</Button>}
      />

      <div className="mb-5 flex gap-1 overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn("focus-ring flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors", tab === key ? "bg-white/10 text-white" : "text-white/50 hover:text-white")}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "general" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Schedule" subtitle="Default cadence: 3 posts per day per platform." />
            <div className="grid gap-4 p-5">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Timezone" hint="IANA name">
                  <Input value={s.timezone} onChange={(e) => set("timezone", e.target.value)} />
                </Field>
                <Field label="Posts per day / platform" hint={status.me.plan.maxPostsPerDay === null ? "you decide" : `up to ${status.me.plan.maxPostsPerDay} on ${status.me.plan.name}`}>
                  {status.me.plan.maxPostsPerDay === null ? (
                    <Input type="number" min={1} max={50} value={s.postsPerDay} onChange={(e) => set("postsPerDay", Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
                  ) : (
                    <Select value={s.postsPerDay} onChange={(e) => set("postsPerDay", Number(e.target.value))}>
                      {Array.from({ length: status.me.plan.maxPostsPerDay }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                    </Select>
                  )}
                </Field>
              </div>
              {s.postsPerDay > 10 && <p className="rounded-lg bg-gold-400/[0.06] px-3 py-2 text-xs text-gold-300 ring-1 ring-gold-400/20">More than 10 posts a day on one account often gets flagged as spam and lowers reach. Raise it gradually and watch your analytics. Extra slots are spread evenly through the day.</p>}
              <div className="flex items-center justify-between rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
                <div>
                  <p className="text-sm text-white">Quiet hours</p>
                  <p className="text-xs text-white/45">No posts or replies in this window</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input type="time" value={s.quietHours.start} onChange={(e) => set("quietHours", { ...s.quietHours, start: e.target.value })} className="w-28" />
                  <span className="text-white/40">–</span>
                  <Input type="time" value={s.quietHours.end} onChange={(e) => set("quietHours", { ...s.quietHours, end: e.target.value })} className="w-28" />
                  <Switch checked={s.quietHours.enabled} onChange={(v) => set("quietHours", { ...s.quietHours, enabled: v })} label="Quiet hours" />
                </div>
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Posting slots" subtitle="Local times, comma-separated. The first N are used." />
            <div className="grid gap-3 p-5">
              {PLATFORMS.map((p) => (
                <div key={p} className="grid grid-cols-[34px_1fr] items-center gap-3">
                  <PlatformChip platform={p} />
                  <Input
                    defaultValue={s.slots[p].join(", ")}
                    onBlur={(e) => set("slots", { ...s.slots, [p]: e.target.value.split(/[,\s]+/).filter(Boolean) })}
                    placeholder="08:30, 12:15, 18:45"
                  />
                </div>
              ))}
              <p className="text-[11px] text-white/40">Starting points from public engagement studies — replace with your own analytics after a few weeks.</p>
            </div>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Content mix" subtitle="Relative weights used when the agent picks pillars. Finance & AI carry the highest advertiser demand." />
            <div className="grid gap-4 p-5 sm:grid-cols-5">
              {PILLARS.map((p) => (
                <Field key={p} label={PILLAR_LABEL[p]} hint={`${s.pillarMix[p]}`}>
                  <input
                    type="range"
                    min={0}
                    max={50}
                    value={s.pillarMix[p]}
                    onChange={(e) => set("pillarMix", { ...s.pillarMix, [p]: Number(e.target.value) })}
                    className="w-full accent-[#3ef0a8]"
                  />
                </Field>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "accounts" && <Accounts settings={s} setSettings={(p) => set("platforms", p)} statuses={status.credentials} />}

      {tab === "safety" && (
        <div className="grid gap-5">
          <Card>
            <CardHeader title="Rate limits per platform" subtitle="Conservative app defaults. Platforms don't publish exact anti-spam thresholds — staying well under them is the safest approach." />
            <div className="overflow-x-auto p-5">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wider text-white/40">
                  <tr>
                    <th className="pb-3">Platform</th>
                    <th className="pb-3">Posts / day</th>
                    <th className="pb-3">Replies / hour</th>
                    <th className="pb-3">Replies / day</th>
                    <th className="pb-3">Min gap (sec)</th>
                  </tr>
                </thead>
                <tbody>
                  {PLATFORMS.map((p) => (
                    <tr key={p}>
                      <td className="py-1.5"><PlatformChip platform={p} /></td>
                      {(["postsPerDay", "repliesPerHour", "repliesPerDay", "minGapSec"] as const).map((k) => (
                        <td key={k} className="py-1.5 pr-3">
                          <Input
                            type="number"
                            min={0}
                            value={s.limits[p][k]}
                            onChange={(e) => set("limits", { ...s.limits, [p]: { ...s.limits[p], [k]: Math.max(0, Number(e.target.value)) } })}
                            className="w-24"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card className="p-5">
            <p className="mb-3 text-sm font-semibold text-white">Built-in protections (always on)</p>
            <ul className="grid gap-2 text-[13px] text-white/65 sm:grid-cols-2">
              <li>• Kill switch stops every post and reply instantly</li>
              <li>• Exponential back-off (15 min → 6 h) after any rate-limit response</li>
              <li>• Randomised spacing between actions — never exact intervals</li>
              <li>• Spam, abusive and emoji-only comments are skipped, not answered</li>
              <li>• Self-harm signals and possible minors are escalated to you, never auto-answered</li>
              <li>• Outputs with financial guarantees, medical claims, trade calls, explicit content or unapproved links are blocked</li>
              <li>• Near-duplicate replies are flagged so the account doesn't look botted</li>
              <li>• Posts older than 12 h past their slot are not published late</li>
            </ul>
          </Card>
        </div>
      )}

      {tab === "money" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
          <Card>
            <CardHeader title="Revenue model" subtitle="Used only for estimates. Plug in your real numbers from platform analytics." />
            <div className="grid gap-4 p-5">
              <div className="grid grid-cols-3 gap-3">
                <Field label="RPM ($/1k views)"><Input type="number" step="0.1" value={s.rpmUsd} onChange={(e) => set("rpmUsd", Number(e.target.value))} /></Field>
                <Field label="Link CTR"><Input type="number" step="0.001" value={s.affiliateCtr} onChange={(e) => set("affiliateCtr", Number(e.target.value))} /></Field>
                <Field label="Conversion"><Input type="number" step="0.005" value={s.affiliateConversion} onChange={(e) => set("affiliateConversion", Number(e.target.value))} /></Field>
              </div>
              <div className="grid gap-2">
                <span className="text-[13px] font-medium text-white/80">Audience per platform</span>
                {PLATFORMS.map((p) => (
                  <div key={p} className="grid grid-cols-[34px_1fr_1fr] items-center gap-2">
                    <PlatformChip platform={p} />
                    <Input type="number" value={s.audience[p].followers} onChange={(e) => set("audience", { ...s.audience, [p]: { ...s.audience[p], followers: Number(e.target.value) } })} placeholder="followers" />
                    <Input type="number" step="0.01" value={s.audience[p].reachRate} onChange={(e) => set("audience", { ...s.audience, [p]: { ...s.audience[p], reachRate: Number(e.target.value) } })} placeholder="reach rate 0–1" />
                  </div>
                ))}
                <p className="text-[11px] text-white/40">Columns: followers · share of followers who typically see a post (0–1).</p>
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader
              title="Affiliate offers"
              subtitle="The agent only attaches an offer when it genuinely fits the post, and always appends your disclosure."
              action={
                <Button size="sm" onClick={() => set("offers", [...s.offers, { id: uid("offer"), name: "", url: "https://", pillar: "any", commissionUsd: 20 }])}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              }
            />
            <div className="grid gap-3 p-5">
              {s.offers.map((o, i) => (
                <OfferRow
                  key={o.id}
                  offer={o}
                  onChange={(next) => set("offers", s.offers.map((x, j) => (j === i ? next : x)))}
                  onRemove={() => set("offers", s.offers.filter((_, j) => j !== i))}
                />
              ))}
              {!s.offers.length && <p className="py-6 text-center text-sm text-white/40">No offers yet. Add products you genuinely recommend (tools, books, courses).</p>}
              <Field label="Disclosure appended to every promoted post" hint="FTC requires clear disclosure">
                <Input value={s.disclosure} onChange={(e) => set("disclosure", e.target.value)} />
              </Field>
            </div>
          </Card>
        </div>
      )}

      {tab === "account" && <AccountTab />}

      {tab === "voice" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Creator notes" subtitle="Added to every generation on top of the locked personality." />
            <div className="p-5">
              <Textarea
                value={s.brandVoiceNotes}
                onChange={(e) => set("brandVoiceNotes", e.target.value)}
                className="min-h-[220px]"
                placeholder={"Who you are, who you write for, opinions you hold, words you never use.\ne.g. Former banker turned founder. Writes for ambitious 25–40 year-olds. Skeptical of hustle culture. Never uses the word 'grind'."}
              />
            </div>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Mature (18+) mode for X" subtitle="Frank, flirtatious, adult-perspective posts about dating, attraction and relationships. Never explicit, never on other platforms, never auto-published." />
            <div className="grid gap-3 p-5">
              <div className="flex items-start justify-between gap-4 rounded-xl bg-white/[0.03] p-3.5 ring-1 ring-white/[0.06]">
                <div>
                  <p className="text-sm font-medium text-white">Allow mature posts on X</p>
                  <p className="text-xs text-white/50">Adds an 18+ switch when you write X posts.</p>
                </div>
                <Switch checked={s.matureX} onChange={(v) => set("matureX", v)} label="Mature mode" tone="red" />
              </div>
              <div className="flex items-start justify-between gap-4 rounded-xl bg-white/[0.03] p-3.5 ring-1 ring-white/[0.06]">
                <div>
                  <p className="text-sm font-medium text-white">My X account marks media as sensitive</p>
                  <p className="text-xs text-white/50">In X: Settings → Privacy and safety → Your posts → “Mark media you post as having material that may be sensitive”. X requires this for adult content; mature posts stay blocked until you confirm.</p>
                </div>
                <Switch checked={s.xSensitiveConfirmed} onChange={(v) => set("xSensitiveConfirmed", v)} label="X sensitive setting confirmed" />
              </div>
              <ul className="grid gap-1.5 text-xs text-white/55">
                <li>• Mature posts are always published by hand (Post now), so a person checks every one.</li>
                <li>• Never put adult content in your X profile photo, header, Lists, Communities or live video.</li>
                <li>• X restricts creator monetization for sexual or overly suggestive content, so these posts earn less.</li>
                <li>• The app never writes explicit sexual content or anything involving minors, on any setting.</li>
              </ul>
            </div>
          </Card>
          <Card>
            <CardHeader title="Replies" />
            <div className="grid gap-4 p-5">
              <Field label="Default reply mode">
                <Select value={s.defaultReplyMode} onChange={(e) => set("defaultReplyMode", e.target.value as Settings["defaultReplyMode"])}>
                  {REPLY_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                </Select>
              </Field>
              <div className="rounded-xl bg-white/[0.03] p-4 text-[13px] leading-relaxed text-white/60 ring-1 ring-white/[0.06]">
                <p className="mb-2 font-medium text-white/85">Personality lock (always applied)</p>
                Sharp, slightly irreverent, genuinely helpful. Every output must teach something concrete and respect the reader. Bans AI-slop phrases, empty motivation, invented stats or anecdotes, financial guarantees, medical claims, explicit content and dunking on people. Relationship topics are frank, never explicit. The agent never claims to be human. Edit <code className="text-mint-300">src/lib/personality.ts</code> to change the core voice.
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function OfferRow({ offer, onChange, onRemove }: { offer: Offer; onChange: (o: Offer) => void; onRemove: () => void }) {
  return (
    <div className="grid gap-2 rounded-xl bg-white/[0.02] p-3 ring-1 ring-white/[0.06] sm:grid-cols-[1.2fr_1.6fr_1fr_90px_auto]">
      <Input value={offer.name} onChange={(e) => onChange({ ...offer, name: e.target.value })} placeholder="Name" />
      <Input value={offer.url} onChange={(e) => onChange({ ...offer, url: e.target.value })} placeholder="https://affiliate-link" />
      <Select value={offer.pillar} onChange={(e) => onChange({ ...offer, pillar: e.target.value as Pillar | "any" })}>
        <option value="any">Any pillar</option>
        {PILLARS.map((p) => <option key={p} value={p}>{PILLAR_LABEL[p]}</option>)}
      </Select>
      <Input type="number" value={offer.commissionUsd} onChange={(e) => onChange({ ...offer, commissionUsd: Number(e.target.value) })} placeholder="$/sale" title="Average commission per sale (USD)" />
      <Button size="icon" variant="danger" onClick={onRemove} aria-label="Remove offer"><Trash2 className="h-4 w-4" /></Button>
      <Input value={offer.notes ?? ""} onChange={(e) => onChange({ ...offer, notes: e.target.value })} placeholder="What it does / who it's for (helps the agent judge fit)" className="sm:col-span-5" />
    </div>
  );
}

function Accounts({ settings, setSettings, statuses }: { settings: Settings; setSettings: (p: Settings["platforms"]) => void; statuses: CredentialStatus[] }) {
  const { toast, refresh } = useApp();
  const isAdmin = useApp((x) => x.status?.me.user.role === "admin");
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const [confirmOff, setConfirmOff] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  async function saveCred(p: Platform) {
    setBusy(p);
    try {
      await api("/api/credentials", { body: { platform: p, ...(forms[p] ?? {}) } });
      setForms({ ...forms, [p]: {} });
      toast(`${PLATFORM_SPECS[p].name} token saved (encrypted)`, "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }
  async function disconnect(p: Platform) {
    if (confirmOff !== p) {
      setConfirmOff(p);
      setTimeout(() => setConfirmOff((c) => (c === p ? null : c)), 4000);
      return;
    }
    setConfirmOff(null);
    try {
      await api(`/api/credentials?platform=${p}`, { method: "DELETE" });
      toast(`${PLATFORM_SPECS[p].name} disconnected. You can also revoke access in that platform's security settings.`, "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const expiryNote = (st: CredentialStatus) => {
    if (!st.expiresAt) return null;
    const d = new Date(st.expiresAt);
    const autoRenew = st.method === "oauth" && (st.platform !== "linkedin" || st.fields.includes("refreshToken"));
    if (autoRenew) return "Renews automatically";
    const days = Math.round((d.getTime() - Date.now()) / 86400_000);
    return days < 0 ? "Token expired — reconnect" : `Reconnect by ${d.toLocaleDateString()} (${days} days)`;
  };

  return (
    <div className="grid gap-5">
      <Card className="p-4 text-[13px] leading-relaxed text-white/65">
        <span className="font-medium text-white">How linking works.</span> “Connect” sends you to the platform's own sign-in page. You approve the permissions there, and you're brought back here. Your password is never seen by this app; only an access token is stored, encrypted. You can disconnect here at any time, or revoke access from the platform's security settings.
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        {PLATFORMS.map((p) => {
          const spec = PLATFORM_SPECS[p];
          if (p === "webhook") {
            const st = statuses.find((x) => x.platform === p) ?? { platform: p, connected: false, fields: [], oauthReady: false };
            return (
              <Card key={p}>
                <CardHeader
                  title={<span className="flex items-center gap-2"><PlatformChip platform={p} /> {spec.name}</span>}
                  subtitle={st.connected ? <span className="text-mint-300">Connected</span> : "Not connected"}
                  action={<Switch checked={settings.platforms[p]} onChange={(v) => setSettings({ ...settings.platforms, [p]: v })} label={`Use ${spec.name}`} />}
                />
                <div className="grid gap-3 p-5">
                  <p className="text-[13px] leading-relaxed text-white/65">
                    Works with any app that can receive a webhook: Zapier, Make, n8n, Slack, Discord, Buffer or Notion automations, or your own server. Create a “catch webhook” in that tool, paste its URL here, and every post you schedule for this connection is sent there as JSON.
                  </p>
                  {CRED_FIELDS.webhook.map((f) => (
                    <Field key={f.key} label={f.label} hint={st.fields.includes(f.key) ? <Badge tone="mint">stored</Badge> : undefined}>
                      <Input
                        type="password"
                        autoComplete="off"
                        value={forms[p]?.[f.key] ?? ""}
                        onChange={(e) => setForms({ ...forms, [p]: { ...(forms[p] ?? {}), [f.key]: e.target.value } })}
                        placeholder={st.fields.includes(f.key) ? "•••••••• (leave blank to keep)" : f.placeholder}
                      />
                    </Field>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" loading={busy === p} onClick={() => saveCred(p)}><KeyRound className="h-3.5 w-3.5" /> Save connection</Button>
                    {st.connected && (
                      <>
                        <Button size="sm" variant="secondary" loading={busy === "webhook-test"} onClick={async () => {
                          setBusy("webhook-test");
                          try {
                            await api("/api/webhook-test", { body: {} });
                            toast("Test message sent. Check your app.", "success");
                          } catch (e) {
                            toast((e as Error).message, "error");
                          } finally {
                            setBusy(null);
                          }
                        }}>Send test message</Button>
                        <Button size="sm" variant="danger" onClick={() => disconnect(p)}>{confirmOff === p ? "Confirm disconnect" : "Disconnect"}</Button>
                      </>
                    )}
                  </div>
                  <div className="grid gap-1 text-[12px]">
                    <p className="text-white/60"><span className="text-white/85">Sends:</span> {spec.publish}</p>
                    <p className="text-white/60"><span className="text-white/85">Security:</span> https addresses only. Internal addresses are blocked. With a signing secret, each request carries an HMAC signature (X-Nexus-Signature) over “timestamp.body”.</p>
                  </div>
                  <p className="text-[11px] text-white/35">The switch above turns this connection on or off for posting. Press “Save changes” at the top after changing it.</p>
                </div>
              </Card>
            );
          }
          const o = OAUTH[p];
          const st = statuses.find((x) => x.platform === p) ?? { platform: p, connected: false, fields: [], oauthReady: false };
          const note = st.connected ? expiryNote(st) : null;
          return (
            <Card key={p}>
              <CardHeader
                title={<span className="flex items-center gap-2"><PlatformChip platform={p} /> {spec.name}</span>}
                subtitle={st.connected ? <span className="text-mint-300">Connected as {st.handle || "your account"}</span> : "Not connected"}
                action={<Switch checked={settings.platforms[p]} onChange={(v) => setSettings({ ...settings.platforms, [p]: v })} label={`Use ${spec.name}`} />}
              />
              <div className="grid gap-3 p-5">
                {st.connected ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl bg-mint-400/[0.05] p-3 ring-1 ring-mint-400/20">
                    <Badge tone="mint">{st.method === "oauth" ? "Linked with " + o.label : "Manual token"}</Badge>
                    {note && <span className={cn("text-xs", /expired|Reconnect/.test(note) ? "text-gold-300" : "text-white/55")}>{note}</span>}
                    <div className="ml-auto flex gap-2">
                      {st.oauthReady && (
                        <a href={`/api/connect/${p}`}><Button size="sm">Reconnect</Button></a>
                      )}
                      <Button size="sm" variant="danger" onClick={() => disconnect(p)}>{confirmOff === p ? "Confirm disconnect" : "Disconnect"}</Button>
                    </div>
                  </div>
                ) : null}
                {st.connected && st.choices && st.choices.length > 1 && (
                  <Field label="Post as this Page" hint={`${st.choices.length} Pages available`}>
                    <Select
                      value={st.choices.find((c) => c.name === st.handle)?.id ?? st.choices[0].id}
                      onChange={async (e) => {
                        try {
                          await api("/api/facebook-page", { body: { pageId: e.target.value } });
                          toast("Facebook Page updated", "success");
                          refresh();
                        } catch (err) {
                          toast((err as Error).message, "error");
                        }
                      }}
                    >
                      {st.choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  </Field>
                )}
                <AccountTypeNote platform={p} />
                {st.connected ? null : st.oauthReady ? (
                  <a href={`/api/connect/${p}`} className="block">
                    <Button variant="primary" size="lg" className="w-full"><Link2 className="h-4 w-4" /> Connect with {o.label}</Button>
                  </a>
                ) : isAdmin ? (
                  <SetupWizard platform={p} origin={origin} onSaved={refresh} />
                ) : (
                  <p className="rounded-xl bg-white/[0.03] p-3 text-[13px] text-white/60 ring-1 ring-white/[0.06]">{o.label} linking isn't switched on yet. The workspace admin enables it once for everyone.</p>
                )}

                {st.oauthReady && isAdmin && (
                  <AppKeysLine platform={p} source={st.keySource} preview={st.keyPreview} origin={origin} onChanged={refresh} />
                )}
                <div className="grid gap-1 text-[12px]">
                  <p className="text-white/60"><span className="text-white/85">Asks permission to:</span> {o.permissions.join(" · ")}</p>
                  <p className="text-white/60"><span className="text-white/85">Publishing:</span> {spec.publish}</p>
                  <p className="text-white/60"><span className="text-white/85">Engagement:</span> {spec.engage}</p>
                </div>

                <button className="focus-ring w-fit text-left text-xs text-white/45 hover:text-white" onClick={() => setManual({ ...manual, [p]: !manual[p] })}>
                  {manual[p] ? "Hide manual token entry" : "Advanced: paste a token instead"}
                </button>
                {manual[p] && (
                  <div className="grid gap-3 rounded-xl bg-white/[0.02] p-3 ring-1 ring-white/[0.06]">
                    {CRED_FIELDS[p].map((f) => (
                      <Field key={f.key} label={f.label} hint={st.fields.includes(f.key) ? <Badge tone="mint">stored</Badge> : undefined}>
                        <Input
                          type={f.secret ? "password" : "text"}
                          autoComplete="off"
                          value={forms[p]?.[f.key] ?? ""}
                          onChange={(e) => setForms({ ...forms, [p]: { ...(forms[p] ?? {}), [f.key]: e.target.value } })}
                          placeholder={st.fields.includes(f.key) ? "•••••••• (leave blank to keep)" : f.placeholder}
                        />
                      </Field>
                    ))}
                    <Button size="sm" variant="secondary" className="w-fit" loading={busy === p} onClick={() => saveCred(p)}>
                      <KeyRound className="h-3.5 w-3.5" /> Save token
                    </Button>
                  </div>
                )}
                <p className="text-[11px] text-white/35">The switch above turns {spec.name} on or off for posting. Press “Save changes” at the top after changing it.</p>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function CopyBox({ value }: { value: string }) {
  const toast = useApp((x) => x.toast);
  return (
    <div className="mt-1.5 flex items-stretch gap-1.5">
      <code className="min-w-0 flex-1 break-all rounded-lg bg-ink-950 px-2.5 py-1.5 font-mono text-[12px] text-mint-300 ring-1 ring-white/[0.06]">{value}</code>
      <Button size="sm" onClick={async () => toast((await copyToClipboard(value)) ? "Copied" : "Copy blocked — select the text instead", "success")}>
        <Copy className="h-3.5 w-3.5" /> Copy
      </Button>
    </div>
  );
}

/** One-time owner setup: guided steps, then paste the app ID and secret — no file editing. */
function SetupWizard({ platform, origin, onSaved }: { platform: OAuthPlatform; origin: string; onSaved: () => void }) {
  const toast = useApp((x) => x.toast);
  const g = SETUP_GUIDES[platform];
  const o = OAUTH[platform];
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Record<number, boolean>>({});
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const redirect = `${origin}/api/connect/${platform}/callback`;
  const values: Record<CopyKey, string> = {
    redirect,
    site: origin,
    scopes: o.scopes.join(o.scopeSeparator === "," ? "," : " "),
    privacy: `${origin}/privacy`,
    terms: `${origin}/terms`,
    deletion: `${origin}/data-deletion`,
  };
  const finished = Object.values(done).filter(Boolean).length;

  async function save() {
    setSaving(true);
    try {
      await api("/api/app-keys", { body: { platform, id, secret } });
      setId("");
      setSecret("");
      toast(`${o.label} is set up. Press “Connect with ${o.label}” to link your account.`, "success");
      onSaved();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="grid gap-2 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
        <p className="text-[13px] text-white/80">
          <span className="font-medium text-white">One-time setup needed</span> · about {g.minutes}. After this, linking is one click for you and your subscribers.
        </p>
        <Button variant="gold" className="w-full" onClick={() => setOpen(true)}>Set up {o.label} step by step</Button>
      </div>
    );
  }

  return (
    <div className="grid gap-3 rounded-xl bg-ink-900/80 p-4 ring-1 ring-gold-400/25">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">Set up {o.label}</p>
          <p className="text-xs text-white/50">You need: {g.needs}</p>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-white/45">{finished}/{g.steps.length} done</span>
      </div>
      <ol className="grid gap-2.5">
        {g.steps.map((st, i) => (
          <li key={i} className={cn("flex gap-3 rounded-lg p-2.5 ring-1", done[i] ? "bg-mint-400/[0.04] ring-mint-400/20" : "bg-white/[0.02] ring-white/[0.06]")}>
            <button
              onClick={() => setDone({ ...done, [i]: !done[i] })}
              aria-label={done[i] ? `Mark step ${i + 1} not done` : `Mark step ${i + 1} done`}
              className={cn("focus-ring mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md text-[11px] font-semibold ring-1", done[i] ? "bg-mint-400 text-ink-950 ring-mint-400" : "text-white/60 ring-white/20")}
            >
              {done[i] ? <Check className="h-3 w-3" /> : i + 1}
            </button>
            <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-white/80">
              {st.text}
              {typeof st.copy === "string" && <CopyBox value={values[st.copy]} />}
              {Array.isArray(st.copy) &&
                st.copy.map((k) => (
                  <div key={k} className="mt-2">
                    <p className="text-[11px] uppercase tracking-wide text-white/40">{COPY_LABELS[k]}</p>
                    <CopyBox value={values[k]} />
                  </div>
                ))}
              {st.note && <p className="mt-1 text-xs text-gold-300/90">{st.note}</p>}
              {st.link && (
                <a href={st.link.href} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs text-mint-300 hover:underline">
                  {st.link.label} <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={g.idLabel}>
          <Input value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" spellCheck={false} placeholder={`Paste ${g.idLabel}`} />
        </Field>
        <Field label={g.secretLabel}>
          <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" placeholder={`Paste ${g.secretLabel}`} />
        </Field>
      </div>
      <p className="text-xs text-white/45">Stored encrypted on your server. Never shown again in the browser.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={saving} disabled={!id.trim() || !secret.trim()} onClick={save}>
          <KeyRound className="h-4 w-4" /> Save and enable Connect
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
      </div>
      <div className="grid gap-1 border-t border-white/[0.06] pt-3 text-xs leading-relaxed text-white/55">
        <p><span className="text-white/80">Testing:</span> {g.testing}</p>
        <p><span className="text-white/80">Before subscribers can connect:</span> {g.review}</p>
      </div>
    </div>
  );
}

function AppKeysLine({ platform, source, preview, origin, onChanged }: { platform: Platform; source?: "env" | "app"; preview?: string; origin: string; onChanged: () => void }) {
  const toast = useApp((x) => x.toast);
  const [confirm, setConfirm] = useState(false);
  const [show, setShow] = useState(false);
  return (
    <div className="grid gap-1.5 text-[12px] text-white/50">
      <p>
        App keys: <span className="font-mono text-white/70">{preview}</span> · {source === "env" ? "from environment variables" : "saved in the app"}
        {" · "}
        <button className="text-white/60 underline-offset-2 hover:text-white hover:underline" onClick={() => setShow((v) => !v)}>{show ? "Hide" : "Show"} redirect URL</button>
        {source === "app" && (
          <>
            {" · "}
            <button
              className="text-red-300/80 underline-offset-2 hover:underline"
              onClick={async () => {
                if (!confirm) {
                  setConfirm(true);
                  setTimeout(() => setConfirm(false), 4000);
                  return;
                }
                try {
                  await api(`/api/app-keys?platform=${platform}`, { method: "DELETE" });
                  toast("App keys removed", "success");
                  onChanged();
                } catch (e) {
                  toast((e as Error).message, "error");
                }
              }}
            >
              {confirm ? "Confirm remove keys" : "Remove keys"}
            </button>
          </>
        )}
      </p>
      {show && <CopyBox value={`${origin}/api/connect/${platform}/callback`} />}
    </div>
  );
}

function AccountTab() {
  const { status, toast, logout } = useApp();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  if (!status) return null;
  const me = status.me;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Your account" />
        <div className="grid gap-3 p-5 text-sm">
          <p><span className="text-white/50">Email</span><br /><span className="text-white">{me.user.email}</span></p>
          <p><span className="text-white/50">Plan</span><br /><span className="text-white">{me.plan.name}</span> · <a href="/plans" className="text-mint-300 hover:underline">Change plan</a></p>
          <p><span className="text-white/50">Role</span><br /><span className="text-white">{me.user.role === "admin" ? "Admin" : "Member"}</span>{me.user.requireApproval ? <span className="text-gold-300"> · posts need admin approval</span> : null}</p>
          <Button variant="ghost" className="w-fit" onClick={logout}>Sign out</Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="Change password" subtitle="Signs you out on every other device." />
        <form
          className="grid gap-3 p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api("/api/auth/password", { body: { current: cur, next } });
              setCur("");
              setNext("");
              toast("Password changed", "success");
            } catch (err) {
              toast((err as Error).message, "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Current password"><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
          <Field label="New password" hint="10+ characters with a number"><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
          <Button type="submit" variant="primary" className="w-fit" loading={busy} disabled={!cur || next.length < 10}>Update password</Button>
        </form>
      </Card>
      <DeleteAccount />
    </div>
  );
}

function DeleteAccount() {
  const toast = useApp((x) => x.toast);
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Card className="border-red-400/20 lg:col-span-2">
      <CardHeader title="Delete account" subtitle="Cancels your subscription and permanently deletes your posts, stories, uploads, linked accounts and logs. This can't be undone." />
      <div className="grid gap-3 p-5">
        {!open ? (
          <Button variant="danger" className="w-fit" onClick={() => setOpen(true)}>Delete my account…</Button>
        ) : (
          <div className="grid max-w-md gap-3">
            <Field label="Password"><Input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <Field label='Type "DELETE" to confirm'><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" /></Field>
            <div className="flex gap-2">
              <Button
                variant="danger"
                loading={busy}
                disabled={!pw || confirm !== "DELETE"}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api("/api/auth/delete", { body: { password: pw, confirm } });
                    window.location.href = "/signup";
                  } catch (e) {
                    toast((e as Error).message, "error");
                    setBusy(false);
                  }
                }}
              >
                Permanently delete
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}


/** Tells users up front which account types each platform lets apps post to. */
function AccountTypeNote({ platform }: { platform: string }) {
  if (platform === "facebook")
    return (
      <div className="rounded-xl bg-amber-400/[0.06] p-3 text-[13px] leading-relaxed text-amber-100/90 ring-1 ring-amber-300/25">
        <b className="text-amber-200">Facebook only lets apps post to Pages.</b> Personal profiles — including profiles in professional mode — can't be connected for auto-posting.
        {" "}No Page yet? <a className="underline hover:text-white" href="https://www.facebook.com/pages/create" target="_blank" rel="noreferrer">Create a free Page</a> with the same name and photo, then connect it here.
        {" "}You can still use your profile: posts for it are marked <b>Copy-ready</b> so you can paste them in one tap.
      </div>
    );
  if (platform === "instagram")
    return (
      <div className="rounded-xl bg-white/[0.03] p-3 text-[13px] leading-relaxed text-white/65 ring-1 ring-white/[0.06]">
        Needs an Instagram <b className="text-white/85">professional account</b> (Business or Creator): Instagram → Settings → Account type and tools. Link it to your Facebook Page so replies and insights work.
      </div>
    );
  return null;
}
