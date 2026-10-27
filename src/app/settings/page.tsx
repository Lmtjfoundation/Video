"use client";
import { useEffect, useState } from "react";
import { AiProviderTab } from "@/components/ai-provider";
import { Brain, CircleDollarSign, KeyRound, Plus, Save, ShieldCheck, SlidersHorizontal, Trash2, UserRound } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import type { Offer, Pillar, Platform, Settings } from "@/lib/types";
import { PILLARS, PLATFORMS, REPLY_MODES } from "@/lib/types";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";
import { MODE_LABEL, PILLAR_LABEL, cn, uid } from "@/lib/utils";
import { Button, Card, CardHeader, Field, Input, PageHeader, PlatformChip, Select, Switch, Textarea } from "@/components/ui";

const TABS = [
  { key: "general", label: "General", icon: SlidersHorizontal },
  { key: "ai", label: "AI", icon: Brain },
  { key: "safety", label: "Limits & safety", icon: ShieldCheck },
  { key: "money", label: "Revenue & offers", icon: CircleDollarSign },
  { key: "voice", label: "Voice & mature mode", icon: UserRound },
  { key: "account", label: "Account", icon: KeyRound },
] as const;

export default function SettingsPage() {
  const { status, toast, refresh } = useApp();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("general");
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (status && !s) setS(status.settings);
  }, [status, s]);

  // Old links to ?tab=accounts go to the Platforms tab; other ?tab= values open that tab.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // Linking social accounts moved to its own Platforms tab; keep old links (and sign-in returns) working.
    if (q.get("tab") === "accounts") {
      q.delete("tab");
      window.location.replace(`/platforms${q.toString() ? `?${q}` : ""}`);
      return;
    }
    const t = q.get("tab");
    if (t && TABS.some((x) => x.key === t)) setTab(t as (typeof TABS)[number]["key"]);
    const connected = q.get("connected");
    const error = q.get("error");
    if (connected === "facebook" && q.get("mode") === "profile") toast("Facebook profile linked. Posts will be ready at their time for you to post with one tap.", "success");
    else if (connected && connected in PLATFORM_SPECS) toast(`${PLATFORM_SPECS[connected as Platform].name} account linked`, "success");
    if (q.get("pick") === "facebook") toast("Facebook will post to your Page automatically. To use another Page or your own profile, choose it on the Facebook card.", "info");
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
        subtitle="Schedule, AI, safety limits, revenue model and voice. Social accounts are on the Platforms tab."
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
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <CardHeader title="Post automatically" subtitle="New posts publish the moment they're written, and videos as soon as they're rendered — Reels, feed posts, carousels and Stories. You can still turn it off for any single post in Content Studio." />
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
              <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06] sm:col-span-3">
                <div>
                  <p className="text-sm text-white">Post new content automatically</p>
                  <p className="text-xs text-white/45">The kill switch, safety filter, rate limits and quiet hours still apply. Mature posts are always posted by hand.</p>
                </div>
                <Switch checked={s.autoPost.enabled} onChange={(v) => set("autoPost", { ...s.autoPost, enabled: v })} label="Post automatically" />
              </div>
              {(["instagram", "facebook"] as const).map((p) => (
                <Field key={p} label={`${PLATFORM_SPECS[p].name} posts as`} hint={p === "facebook" ? "Auto: Reels up to 90 s, longer videos to the feed; pictures as photo posts" : "Auto: videos as Reels (also in the feed), pictures as posts or carousels"}>
                  <Select value={s.autoPost[p]} onChange={(e) => set("autoPost", { ...s.autoPost, [p]: e.target.value as Settings["autoPost"]["instagram"] })}>
                    <option value="auto">Auto (best fit)</option>
                    <option value="reel">Reel</option>
                    <option value="feed">Feed post{p === "instagram" ? " / carousel" : ""}</option>
                    <option value="story">Story (up to 60 s)</option>
                  </Select>
                </Field>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Schedule" subtitle="Default cadence: 3 posts per day per platform." />
            <div className="grid grid-cols-1 gap-4 p-5">
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
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
                <div>
                  <p className="text-sm text-white">Quiet hours</p>
                  <p className="text-xs text-white/45">No posts or replies in this window</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input type="time" value={s.quietHours.start} onChange={(e) => set("quietHours", { ...s.quietHours, start: e.target.value })} className="w-[8.5rem]" />
                  <span className="text-white/40">–</span>
                  <Input type="time" value={s.quietHours.end} onChange={(e) => set("quietHours", { ...s.quietHours, end: e.target.value })} className="w-[8.5rem]" />
                  <Switch checked={s.quietHours.enabled} onChange={(v) => set("quietHours", { ...s.quietHours, enabled: v })} label="Quiet hours" />
                </div>
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Posting slots" subtitle="Local times, comma-separated. The first N are used." />
            <div className="grid grid-cols-1 gap-3 p-5">
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
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-5">
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

      {tab === "ai" && <AiProviderTab />}

      {tab === "safety" && (
        <div className="grid grid-cols-1 gap-5">
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
            <ul className="grid grid-cols-1 gap-2 text-[13px] text-white/65 sm:grid-cols-2">
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
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.4fr]">
          <Card>
            <CardHeader title="Revenue model" subtitle="Used only for estimates. Plug in your real numbers from platform analytics." />
            <div className="grid grid-cols-1 gap-4 p-5">
              <div className="grid grid-cols-3 gap-3">
                <Field label="RPM ($/1k views)"><Input type="number" step="0.1" value={s.rpmUsd} onChange={(e) => set("rpmUsd", Number(e.target.value))} /></Field>
                <Field label="Link CTR"><Input type="number" step="0.001" value={s.affiliateCtr} onChange={(e) => set("affiliateCtr", Number(e.target.value))} /></Field>
                <Field label="Conversion"><Input type="number" step="0.005" value={s.affiliateConversion} onChange={(e) => set("affiliateConversion", Number(e.target.value))} /></Field>
              </div>
              <div className="grid grid-cols-1 gap-2">
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
            <div className="grid grid-cols-1 gap-3 p-5">
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
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
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
            <div className="grid grid-cols-1 gap-3 p-5">
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
              <ul className="grid grid-cols-1 gap-1.5 text-xs text-white/55">
                <li>• Mature posts are always published by hand (Post now), so a person checks every one.</li>
                <li>• Never put adult content in your X profile photo, header, Lists, Communities or live video.</li>
                <li>• X restricts creator monetization for sexual or overly suggestive content, so these posts earn less.</li>
                <li>• The app never writes explicit sexual content or anything involving minors, on any setting.</li>
              </ul>
            </div>
          </Card>
          <Card>
            <CardHeader title="Replies" />
            <div className="grid grid-cols-1 gap-4 p-5">
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
    <div className="grid grid-cols-1 gap-2 rounded-xl bg-white/[0.02] p-3 ring-1 ring-white/[0.06] sm:grid-cols-[1.2fr_1.6fr_1fr_90px_auto]">
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

function AccountTab() {
  const { status, toast, logout } = useApp();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  if (!status) return null;
  const me = status.me;
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Your account" />
        <div className="grid grid-cols-1 gap-3 p-5 text-sm">
          <p><span className="text-white/50">Email</span><br /><span className="text-white">{me.user.email}</span></p>
          <p><span className="text-white/50">Plan</span><br /><span className="text-white">{me.plan.name}</span> · <a href="/plans" className="text-mint-300 hover:underline">Change plan</a></p>
          <p><span className="text-white/50">Role</span><br /><span className="text-white">{me.user.role === "admin" ? "Admin" : "Member"}</span>{me.user.requireApproval ? <span className="text-gold-300"> · posts need admin approval</span> : null}</p>
          <Button variant="ghost" className="w-fit" onClick={logout}>Sign out</Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="Change password" subtitle="Signs you out on every other device." />
        <form
          className="grid grid-cols-1 gap-3 p-5"
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
      <div className="grid grid-cols-1 gap-3 p-5">
        {!open ? (
          <Button variant="danger" className="w-fit" onClick={() => setOpen(true)}>Delete my account…</Button>
        ) : (
          <div className="grid grid-cols-1 max-w-md gap-3">
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
