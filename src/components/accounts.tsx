"use client";
import { useState } from "react";
import { Check, Copy, ExternalLink, KeyRound, Link2, UserRound, Zap } from "lucide-react";
import { useApp } from "@/lib/store";
import { api, copyToClipboard } from "@/lib/client";
import type { CredentialStatus, Platform, Settings } from "@/lib/types";
import { PLATFORMS } from "@/lib/types";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";
import { OAUTH, type OAuthPlatform } from "@/lib/oauth-config";
import { COPY_LABELS, SETUP_GUIDES, type CopyKey } from "@/lib/setup-guides";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, Field, Input, PlatformChip, Select, Switch } from "@/components/ui";

/* Linking social accounts: shared by the Platforms tab and Settings. */
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
    { key: "refreshToken", label: "Signing secret (optional)", secret: true, placeholder: "lets your receiver verify posts came from Ghost Post" },
  ],
};


export function Accounts({ settings, setSettings, statuses, saveHint = "Press “Save changes” at the top after changing it." }: { settings: Settings; setSettings: (p: Settings["platforms"]) => void; statuses: CredentialStatus[]; saveHint?: string }) {
  const { toast, refresh } = useApp();
  const isAdmin = useApp((x) => x.status?.me.user.role === "admin");
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const [confirmOff, setConfirmOff] = useState<string | null>(null);
  const [directOpen, setDirectOpen] = useState<Record<string, boolean>>({});
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
                  <p className="text-[11px] text-white/35">The switch above turns this connection on or off for posting. {saveHint}</p>
                </div>
              </Card>
            );
          }
          const o = OAUTH[p];
          const st = statuses.find((x) => x.platform === p) ?? { platform: p, connected: false, fields: [], oauthReady: false };
          const direct = !!st.direct;
          const viaMc = st.via === "metricool";
          const note = direct ? expiryNote(st) : null;
          return (
            <Card key={p}>
              <CardHeader
                title={<span className="flex items-center gap-2"><PlatformChip platform={p} /> {spec.name}</span>}
                subtitle={
                  direct ? (
                    <span className="text-mint-300">Connected as {st.handle || "your account"}{p === "facebook" ? (st.mode === "profile" ? " · your profile" : " · Page") : ""}</span>
                  ) : viaMc ? (
                    <span className="text-mint-300">Connected through Metricool</span>
                  ) : (
                    "Not connected"
                  )
                }
                action={<Switch checked={settings.platforms[p]} onChange={(v) => setSettings({ ...settings.platforms, [p]: v })} label={`Use ${spec.name}`} />}
              />
              <div className="grid gap-3 p-5">
                {direct ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl bg-mint-400/[0.05] p-3 ring-1 ring-mint-400/20">
                    <Badge tone="mint">{st.mode === "profile" ? "Profile · one-tap posting" : st.method === "oauth" ? "Linked with " + o.label : "Manual token"}</Badge>
                    {note && <span className={cn("text-xs", /expired|Reconnect/.test(note) ? "text-gold-300" : "text-white/55")}>{note}</span>}
                    <div className="ml-auto flex gap-2">
                      {st.oauthReady && (
                        <a href={`/api/connect/${p}`}><Button size="sm">{st.mode === "profile" ? "Connect a Page" : "Reconnect"}</Button></a>
                      )}
                      <Button size="sm" variant="danger" onClick={() => disconnect(p)}>{confirmOff === p ? "Confirm disconnect" : "Disconnect"}</Button>
                    </div>
                  </div>
                ) : null}
                {viaMc && !direct && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl bg-violet-500/[0.06] p-3 ring-1 ring-violet-400/20">
                    <Badge tone="violet">Through Metricool</Badge>
                    <span className="text-xs text-white/60">Posts go out through your Metricool brand. No setup needed here.</span>
                    {!directOpen[p] && (
                      <button className="focus-ring ml-auto text-xs text-white/50 hover:text-white" onClick={() => setDirectOpen({ ...directOpen, [p]: true })}>
                        Connect directly instead
                      </button>
                    )}
                  </div>
                )}
                {p === "facebook" && direct && <FacebookTargets st={st} handoffEmail={settings.handoffEmail} igConnected={!!statuses.find((x) => x.platform === "instagram")?.direct} onChanged={refresh} />}
                <AccountTypeNote platform={p} />
                {direct || (viaMc && !directOpen[p]) ? null : p === "facebook" ? (
                  <FacebookChoice
                    oauthReady={st.oauthReady}
                    isAdmin={isAdmin}
                    origin={origin}
                    onSaved={() => {
                      refresh();
                      // Adding a profile means "use Facebook": switch it on (the plan's platform limit still applies).
                      if (!settings.platforms.facebook) setSettings({ ...settings.platforms, facebook: true });
                    }}
                  />
                ) : st.oauthReady ? (
                  <a href={`/api/connect/${p}`} className="block">
                    <Button variant="primary" size="lg" className="w-full"><Link2 className="h-4 w-4" /> Connect with {o.label}</Button>
                  </a>
                ) : isAdmin ? (
                  <SetupWizard platform={p} origin={origin} onSaved={refresh} />
                ) : (
                  <p className="rounded-xl bg-white/[0.03] p-3 text-[13px] text-white/60 ring-1 ring-white/[0.06]">{o.label} sign-in isn't switched on yet. Use <b className="text-white/80">Quick connect with Metricool</b> at the top of this page instead, or ask the workspace admin.</p>
                )}
                {isAdmin && st.oauthReady && !direct && (!viaMc || directOpen[p]) && (
                  <p className="text-[12px] leading-relaxed text-white/45">
                    <span className="text-white/70">If {o.label} shows an error instead of its sign-in page:</span> {SETUP_GUIDES[p].testing} Or use Quick connect with Metricool at the top.
                  </p>
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
                <p className="text-[11px] text-white/35">The switch above turns {spec.name} on or off for posting. {saveHint}</p>
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


function AccountTypeNote({ platform }: { platform: string }) {
  if (platform === "facebook")
    return (
      <div className="rounded-xl bg-blue-500/[0.06] p-3 text-[13px] leading-relaxed text-blue-50/85 ring-1 ring-blue-400/20">
        <b className="text-white">Pages and profiles both work.</b> A <b className="text-white">Page</b> posts automatically. A <b className="text-white">profile</b> — including a monetized profile in professional mode — can't be posted to by any app (Facebook's rule), so Ghost Post gets each post ready at its time, HD video and caption included, and you post it from your phone with one tap.
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



/** Not connected yet: pick a Page (automatic posting) or your own profile (one-tap posting, no Facebook Login needed). */
function FacebookChoice({ oauthReady, isAdmin, origin, onSaved }: { oauthReady: boolean; isAdmin: boolean; origin: string; onSaved: () => void }) {
  const [form, setForm] = useState(false);
  return (
    <div className="grid gap-3">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div className="grid content-between gap-3 rounded-xl bg-white/[0.03] p-3.5 ring-1 ring-white/[0.07]">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-medium text-white"><Zap className="h-4 w-4 text-mint-300" /> Facebook Page</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-white/55">Posts automatically at your time slots, and replies to comments.</p>
          </div>
          {oauthReady ? (
            <a href="/api/connect/facebook" className="block">
              <Button variant="primary" className="w-full"><Link2 className="h-4 w-4" /> Connect a Page</Button>
            </a>
          ) : (
            <p className="text-[12px] text-white/40">{isAdmin ? "Set up Facebook below first." : "The workspace admin switches this on once for everyone."}</p>
          )}
        </div>
        <div className="grid content-between gap-3 rounded-xl bg-gold-400/[0.04] p-3.5 ring-1 ring-gold-400/20">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-medium text-white"><UserRound className="h-4 w-4 text-gold-300" /> Your profile</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-white/55">Monetized or not. Each post is ready at its time with the HD video and caption — you post it with one tap.</p>
          </div>
          <Button variant="gold" className="w-full" onClick={() => setForm((v) => !v)}>{form ? "Close" : "Use my profile"}</Button>
        </div>
      </div>
      {form && <ProfileForm onSaved={() => { setForm(false); onSaved(); }} />}
      {!oauthReady && isAdmin && <SetupWizard platform="facebook" origin={origin} onSaved={onSaved} />}
    </div>
  );
}

/** Connected: switch between a Page and your profile, edit the profile, and choose whether to get an email when a post is ready. */
function FacebookTargets({ st, handoffEmail, igConnected, onChanged }: { st: CredentialStatus; handoffEmail: boolean; igConnected: boolean; onChanged: () => void }) {
  const toast = useApp((x) => x.toast);
  const [viaIg, setViaIg] = useState(!!st.viaInstagram);
  const [form, setForm] = useState(false);
  const [email, setEmail] = useState(handoffEmail);
  const pages = st.choices ?? [];
  const options = [
    ...pages.map((c) => ({ value: c.id, label: `${c.name} — Page, posts automatically` })),
    ...(st.profileName ? [{ value: "__profile", label: `${st.profileName} — your profile, one-tap posting` }] : []),
  ];
  const value = st.mode === "profile" ? "__profile" : pages.find((c) => c.name === st.handle)?.id ?? pages[0]?.id ?? "";

  async function choose(v: string) {
    try {
      await api("/api/facebook-page", { body: v === "__profile" ? { target: "profile" } : { pageId: v } });
      toast(v === "__profile" ? "Facebook posts will be ready for you to post on your profile" : "Facebook now posts to your Page automatically", "success");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  async function setNotify(v: boolean) {
    setEmail(v);
    try {
      await api("/api/settings", { method: "PUT", body: { handoffEmail: v } });
      toast(v ? "You'll get an email when a post is ready" : "Ready-post emails off", "success");
      onChanged();
    } catch (e) {
      setEmail(!v);
      toast((e as Error).message, "error");
    }
  }

  async function setAutopilot(v: boolean) {
    setViaIg(v);
    try {
      await api("/api/facebook-profile", { method: "PATCH", body: { viaInstagram: v } });
      toast(v ? "Facebook profile on autopilot through Instagram" : "Back to one-tap posting", "success");
      onChanged();
    } catch (e) {
      setViaIg(!v);
      toast((e as Error).message, "error");
    }
  }

  return (
    <div className="grid gap-3">
      {options.length > 1 && (
        <Field label="Post to" hint={`${pages.length} Page${pages.length === 1 ? "" : "s"}${st.profileName ? " + your profile" : ""}`}>
          <Select value={value} onChange={(e) => choose(e.target.value)}>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
      )}
      {st.mode === "profile" && (
        <div className="grid gap-2.5 rounded-xl bg-mint-400/[0.04] p-3 ring-1 ring-mint-400/20">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-white"><Zap className="h-4 w-4 text-mint-300" /> Autopilot through Instagram</span>
            <Switch checked={viaIg} onChange={setAutopilot} label="Post to my Facebook profile automatically through Instagram" />
          </div>
          <p className="text-[12.5px] leading-relaxed text-white/60">
            Facebook doesn't let any app post to a profile, but Instagram can share to it. Ghost Post posts each video or picture to your Instagram, and Instagram puts it on your Facebook profile — no taps.
            Text-only posts still come to you for one tap.
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-[12.5px] leading-relaxed text-white/60">
            <li className={igConnected ? "text-mint-300" : ""}>{igConnected ? "Instagram is connected." : "Connect Instagram above (professional account)."}</li>
            <li>
              Once, in Instagram: Profile → ☰ → Accounts Center → <b className="text-white/80">Sharing across profiles</b> → your Instagram → your Facebook profile → turn on automatic sharing for posts and reels.{" "}
              <a className="inline-flex items-center gap-1 text-mint-300 underline" href="https://accountscenter.instagram.com/" target="_blank" rel="noreferrer">Open Accounts Center <ExternalLink className="h-3 w-3" /></a>
            </li>
            <li>Switch this on. Check your Facebook profile after the first post — if it didn't appear, Instagram's sharing setting is off.</li>
          </ol>
        </div>
      )}
      {st.mode === "profile" && !viaIg && (
        <div className="grid gap-2.5 rounded-xl bg-gold-400/[0.04] p-3 ring-1 ring-gold-400/20">
          <p className="text-[13px] leading-relaxed text-white/70">
            At each post's time it's marked <b className="text-white">Ready for you</b> on your dashboard. Open it on your phone, tap <b className="text-white">Share to Facebook</b>, paste the caption (already copied), done.
          </p>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-white/80">Email me when a post is ready</span>
            <Switch checked={email} onChange={setNotify} label="Email me when a Facebook post is ready" />
          </div>
        </div>
      )}
      {form ? (
        <ProfileForm initialName={st.profileName ?? ""} onSaved={() => { setForm(false); onChanged(); }} onCancel={() => setForm(false)} />
      ) : (
        <button className="focus-ring w-fit text-left text-xs text-white/50 hover:text-white" onClick={() => setForm(true)}>
          {st.mode === "profile" ? "Edit profile name or link" : st.profileName ? "Edit your profile details" : "Post on my profile instead"}
        </button>
      )}
    </div>
  );
}

function ProfileForm({ initialName = "", onSaved, onCancel }: { initialName?: string; onSaved: () => void; onCancel?: () => void }) {
  const toast = useApp((x) => x.toast);
  const [name, setName] = useState(initialName);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await api("/api/facebook-profile", { body: { name, url } });
      toast("Profile added. Facebook posts will be ready for you to post with one tap.", "success");
      onSaved();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="grid gap-3 rounded-xl bg-ink-900/80 p-3.5 ring-1 ring-white/[0.08]">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name on your profile">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" placeholder="Your name as it shows on Facebook" />
        </Field>
        <Field label="Profile link (optional)" hint="Profile → … → Copy link">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoComplete="off" spellCheck={false} placeholder="facebook.com/yourname" />
        </Field>
      </div>
      <p className="text-[12px] leading-relaxed text-white/45">No Facebook password or login needed. Nothing is posted without you: you make the final tap on every post.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={saving} disabled={!name.trim()} onClick={save}><UserRound className="h-4 w-4" /> Save profile</Button>
        {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  );
}
