"use client";
import { useState } from "react";
import { Check, KeyRound, Link2, RefreshCw, Zap } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import type { MetricoolStatus, McPlatform } from "@/lib/metricool";
import type { CredentialStatus, Platform } from "@/lib/types";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, Field, Input, PlatformChip, Switch } from "@/components/ui";

const MC: McPlatform[] = ["facebook", "instagram", "x", "linkedin", "youtube", "tiktok"];
type Reply = { metricool: MetricoolStatus; credentials: CredentialStatus[]; skipped?: Platform[] };

/** Same rule as the server: blogId=… and userId=… anywhere in a pasted link. */
const idsIn = (s: string) => ({ userId: s.match(/userId=(\d{3,15})/i)?.[1], blogId: s.match(/blogId=(\d{3,15})/i)?.[1] });

/**
 * Quick connect: every account the person already connected in Metricool is used by Ghost Post,
 * with no developer setup. Posts go to Metricool at their time and Metricool publishes them.
 */
export function MetricoolCard({ status, credentials }: { status?: MetricoolStatus; credentials: CredentialStatus[] }) {
  const { toast, refresh } = useApp();
  const [token, setToken] = useState("");
  const [link, setLink] = useState("");
  const [ids, setIds] = useState({ userId: "", blogId: "" });
  const [showIds, setShowIds] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const connected = !!status?.connected;
  const parsed = idsIn(link);

  function after(r: Reply, msg: string) {
    const skipped = (r.skipped ?? []).map((p) => PLATFORM_SPECS[p]?.name ?? p);
    toast(skipped.length ? `${msg} ${skipped.join(", ")} stayed off: your plan's platform limit is reached.` : msg, skipped.length ? "info" : "success");
    refresh();
  }

  async function connect() {
    setBusy("connect");
    try {
      const r = await api<Reply>("/api/metricool", { body: { token, link, userId: ids.userId || parsed.userId, blogId: ids.blogId || parsed.blogId } });
      setToken("");
      setEditing(false);
      const n = r.metricool.found.length;
      after(r, n ? `Metricool connected: ${r.metricool.found.map((p) => PLATFORM_SPECS[p].name).join(", ")}.` : "Metricool connected, but no accounts were found in that brand yet.");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }
  async function setUse(p: McPlatform, v: boolean) {
    setBusy(p);
    try {
      const r = await api<Reply>("/api/metricool", { method: "PATCH", body: { use: { [p]: v } } });
      after(r, v ? `${PLATFORM_SPECS[p].name} now posts through Metricool.` : `${PLATFORM_SPECS[p].name} no longer posts through Metricool.`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }
  async function recheck() {
    setBusy("refresh");
    try {
      const r = await api<Reply>("/api/metricool", { body: { action: "refresh" } });
      after(r, r.metricool.found.length ? `Found in Metricool: ${r.metricool.found.map((p) => PLATFORM_SPECS[p].name).join(", ")}.` : "No accounts found in that Metricool brand yet.");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }
  async function disconnect() {
    if (!confirmOff) {
      setConfirmOff(true);
      setTimeout(() => setConfirmOff(false), 4000);
      return;
    }
    try {
      await api("/api/metricool", { method: "DELETE" });
      toast("Metricool disconnected", "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const form = (
    <div className="grid gap-3">
      <Field label="Metricool API token" hint="Account settings → API">
        <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} placeholder={connected ? "•••••••• (leave blank to keep)" : "Paste your API token"} />
      </Field>
      <Field label="Your brand's Metricool link" hint={parsed.blogId && parsed.userId ? <Badge tone="mint"><Check className="h-3 w-3" /> IDs found</Badge> : "address bar"}>
        <Input value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://app.metricool.com/…?blogId=…&userId=…" />
      </Field>
      {showIds ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="User ID"><Input value={ids.userId} onChange={(e) => setIds({ ...ids, userId: e.target.value.replace(/\D/g, "") })} inputMode="numeric" placeholder="userId" /></Field>
          <Field label="Brand ID"><Input value={ids.blogId} onChange={(e) => setIds({ ...ids, blogId: e.target.value.replace(/\D/g, "") })} inputMode="numeric" placeholder="blogId" /></Field>
        </div>
      ) : (
        <button className="focus-ring w-fit text-xs text-white/50 hover:text-white" onClick={() => setShowIds(true)}>Type the user ID and brand ID instead</button>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="lg" className="flex-1 sm:flex-none" loading={busy === "connect"} disabled={!token.trim() && !connected} onClick={connect}>
          <Link2 className="h-4 w-4" /> {connected ? "Save" : "Connect Metricool"}
        </Button>
        {connected && <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
      </div>
    </div>
  );

  return (
    <Card className="mb-5 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet-500/[0.07] via-transparent to-mint-400/[0.06]" />
      <div className="relative grid gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-400 to-mint-400 text-ink-950 shadow-glow">
              <Zap className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-white">Quick connect with Metricool</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-white/55">
                {connected
                  ? `Using the accounts connected in ${status?.brand ? `“${status.brand}”` : "your Metricool brand"}. Each post goes to Metricool at its time and Metricool publishes it about 2 minutes later.`
                  : "Already connected your accounts in Metricool? Link it once and Ghost Post posts to all of them — no developer setup."}
              </p>
            </div>
          </div>
          {connected && <Badge tone="mint">Connected</Badge>}
        </div>

        {!connected && (
          <>
            <ol className="grid gap-1.5 text-[13px] leading-relaxed text-white/65">
              <li><b className="text-white/90">1.</b> In Metricool, open <b className="text-white/90">Account settings → API</b> and copy your token (Metricool's Advanced or Custom plan).</li>
              <li><b className="text-white/90">2.</b> Open your brand in Metricool and copy the link in the address bar — it has your brand and user IDs.</li>
            </ol>
            {form}
          </>
        )}

        {connected && (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {MC.map((p) => {
                const found = status!.found.includes(p);
                const on = status!.use[p];
                const direct = credentials.find((c) => c.platform === p)?.direct;
                return (
                  <div key={p} className={cn("flex items-center gap-3 rounded-xl p-3 ring-1", on ? "bg-mint-400/[0.05] ring-mint-400/20" : "bg-white/[0.02] ring-white/[0.06]")}>
                    <PlatformChip platform={p} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-white">{PLATFORM_SPECS[p].name}</p>
                      <p className="truncate text-[11.5px] text-white/45">
                        {on ? "Posts through Metricool" : found ? (direct ? "In Metricool · posting directly" : "In Metricool · off") : "Not found in Metricool"}
                      </p>
                    </div>
                    <Switch checked={on} disabled={busy === p} onChange={(v) => setUse(p, v)} label={`Post ${PLATFORM_SPECS[p].name} through Metricool`} />
                  </div>
                );
              })}
            </div>
            {status!.found.length === 0 && (
              <p className="rounded-xl bg-gold-400/[0.06] p-3 text-[13px] leading-relaxed text-gold-100/90 ring-1 ring-gold-400/20">
                No accounts were found in this brand. Connect them in Metricool (Brand → Connections), then press <b>Check again</b>. If they are connected already, switch them on above.
              </p>
            )}
            {editing ? form : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" loading={busy === "refresh"} onClick={recheck}><RefreshCw className="h-3.5 w-3.5" /> Check again</Button>
                <Button size="sm" onClick={() => setEditing(true)}><KeyRound className="h-3.5 w-3.5" /> Update token or brand</Button>
                <Button size="sm" variant="danger" className="ml-auto" onClick={disconnect}>{confirmOff ? "Confirm disconnect" : "Disconnect"}</Button>
              </div>
            )}
            <p className="text-[11.5px] leading-relaxed text-white/40">
              Platforms you connected directly below keep posting directly unless you switch them to Metricool here. Instagram needs a photo or video on every post. Replies to comments only work for accounts connected directly.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
