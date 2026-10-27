"use client";
import { useEffect, useState } from "react";
import { ArrowRightLeft, CheckCircle2, CircleAlert } from "lucide-react";
import { Button, Card, CardHeader, Field, Input } from "@/components/ui";

type Status = { state: "idle" | "copying" | "done" | "failed"; copied: number; total: number; bytes: number; message?: string; from?: string; error?: string };

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(b > 100 * 1024 * 1024 ? 0 : 1)} MB`;

/** New server: receive everything from the old one with the owner's one-time code. */
export default function RestorePage() {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/migrate/status", { cache: "no-store" });
        const j = (await r.json()) as Status;
        if (!stop) setStatus(r.ok ? j : { state: "failed", copied: 0, total: 0, bytes: 0, error: j.error });
        // Not set up for a move: nothing will change, so stop asking.
        if (r.status === 404) return;
      } catch {
        /* the server restarts at the end of a move */
      }
      if (!stop) setTimeout(tick, 2000);
    };
    tick();
    return () => {
      stop = true;
    };
  }, []);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/migrate/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) setError(j.error || "The move couldn't start.");
    } finally {
      setBusy(false);
    }
  }

  const s = status;
  return (
    <div className="mx-auto grid grid-cols-1 max-w-xl gap-6 py-10">
      <Card>
        <CardHeader title="Move Ghost Post to this server" subtitle={s?.from ? `Copies every account, post, upload and setting from ${s.from}.` : "Copies every account, post, upload and setting from your old server."} icon={<ArrowRightLeft className="h-4 w-4" />} />
        <div className="grid grid-cols-1 gap-4 p-5 text-sm">
          {s?.error && <p className="text-white/70">{s.error}</p>}
          {s?.state === "done" ? (
            <div className="grid grid-cols-1 gap-3">
              <p className="flex items-center gap-2 text-mint-300"><CheckCircle2 className="h-4 w-4" /> {s.message ?? "Moved."}</p>
              <p className="text-white/65">The server restarts with your settings in a few seconds. Sign in with your usual email and password. Your old address now sends everyone here.</p>
              <a href="/login"><Button variant="primary">Sign in</Button></a>
            </div>
          ) : s?.state === "copying" ? (
            <div className="grid grid-cols-1 gap-2">
              <p>Copying… {s.copied.toLocaleString()} of {s.total.toLocaleString()} files ({mb(s.bytes)})</p>
              <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-mint-400 transition-all" style={{ width: `${s.total ? (s.copied / s.total) * 100 : 5}%` }} /></div>
              <p className="text-xs text-white/50">Keep this page open. Large media libraries take a few minutes.</p>
            </div>
          ) : (
            <>
              <ol className="list-decimal space-y-1 pl-5 text-white/70">
                <li>Sign in to your old Ghost Post as the owner.</li>
                <li>Open Admin → App settings → Move to a new server and press <b>Make a move code</b>.</li>
                <li>Paste the code here within 15 minutes.</li>
              </ol>
              {s?.state === "failed" && s.message && <p className="flex items-start gap-2 text-red-300"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> The last try stopped: {s.message}</p>}
              <Field label="Move code"><Input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} placeholder="Paste the code from the old server" /></Field>
              {error && <p className="text-red-300">{error}</p>}
              <Button variant="primary" loading={busy} disabled={code.trim().length < 20 || !!s?.error} onClick={start}>Move everything here</Button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
