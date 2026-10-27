"use client";
import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { Button, Card, CardHeader, Input, PageHeader } from "@/components/ui";

type Key = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt?: string };

const Code = ({ children }: { children: string }) => <pre className="overflow-x-auto whitespace-pre rounded-lg bg-black/50 p-3 text-xs text-white/80">{children}</pre>;

export default function Developers() {
  const { toast } = useApp();
  const [keys, setKeys] = useState<Key[]>([]);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  // The examples show this site's own address (read after the first render, so the server and browser match).
  const [origin, setOrigin] = useState("https://your-app");
  useEffect(() => setOrigin(window.location.origin), []);
  const load = useCallback(() => api<{ keys: Key[] }>("/api/developers").then((d) => setKeys(d.keys)).catch((e) => toast((e as Error).message, "error")), [toast]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <PageHeader title="Developers" subtitle="Ghost Post's API: search the Library and make music, sound effects and footage from your own code. Requests use your plan's credits." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader title="API keys" subtitle="Keep keys secret: anyone with one can spend your credits." icon={<KeyRound className="h-4 w-4" />} />
          <div className="grid grid-cols-1 gap-3 p-4">
            <form className="flex gap-2" onSubmit={async (e) => {
              e.preventDefault();
              try {
                const r = await api<{ key: string }>("/api/developers", { body: { action: "create", name } });
                setFresh(r.key);
                setName("");
                load();
              } catch (err) {
                toast((err as Error).message, "error");
              }
            }}>
              <Input placeholder="Key name, e.g. My website" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
              <Button type="submit" variant="primary">Create</Button>
            </form>
            {fresh && (
              <div className="rounded-xl border border-gold-300/40 bg-gold-300/10 p-3 text-sm">
                <div className="mb-1 font-medium">Copy your key now: it won&apos;t be shown again.</div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-black/40 px-2 py-1 text-xs">{fresh}</code>
                  <Button size="sm" onClick={() => { void navigator.clipboard.writeText(fresh); toast("Copied", "success"); }}><Copy className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            )}
            {!keys.length && <div className="text-sm text-white/50">No keys yet.</div>}
            {keys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 rounded-lg bg-white/[0.03] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{k.name}</div>
                  <div className="text-xs text-white/50">{k.prefix}… · made {k.createdAt.slice(0, 10)}{k.lastUsedAt ? ` · last used ${k.lastUsedAt.slice(0, 10)}` : " · never used"}</div>
                </div>
                <button className="text-white/50 hover:text-red-300" aria-label={`Revoke ${k.name}`} onClick={async () => {
                  if (!confirm(`Revoke “${k.name}”? Apps using it stop working at once.`)) return;
                  await api("/api/developers", { body: { action: "revoke", id: k.id } });
                  load();
                }}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Reference" subtitle="JSON over HTTPS. Send the key as a Bearer token. 60 requests a minute per key." />
          <div className="grid grid-cols-1 gap-5 p-5 text-sm text-white/80">
            <section className="grid grid-cols-1 gap-2">
              <div className="font-semibold text-white">Search the Library</div>
              <div>GET <code>/api/v1/library</code> with <code>kind</code> (music, sfx, footage), <code>q</code>, <code>genres</code>, <code>moods</code>, <code>themes</code>, <code>instruments</code>, <code>categories</code>, <code>vocals</code> (instrumental, vocals), <code>tempo</code> (slow, medium, fast, very-fast), <code>length</code> (short, mid, long), <code>shelf</code> (catalog, mine), <code>sort</code> (new, popular, short, long), <code>similar</code> (an item id) and <code>limit</code> (up to 100). Each item has a <code>preview_url</code> that plays for six hours.</div>
              <Code>{`curl "${origin}/api/v1/library?kind=music&moods=Tense&tempo=slow" \\\n  -H "Authorization: Bearer gp_live_…"`}</Code>
            </section>
            <section className="grid grid-cols-1 gap-2">
              <div className="font-semibold text-white">Make music, a sound effect or footage</div>
              <div>POST <code>/api/v1/generate</code> answers <code>202</code> with a job right away; the credits are taken then and given back if it fails. Fields as in AI Studio: <code>kind</code>, <code>prompt</code>, <code>seconds</code>, and for music <code>lyrics</code>, <code>bpm</code>, <code>key</code>, <code>genres</code>, <code>moods</code>; for footage <code>aspect</code>.</div>
              <Code>{`curl -X POST "${origin}/api/v1/generate" \\\n  -H "Authorization: Bearer gp_live_…" -H "Content-Type: application/json" \\\n  -d '{"kind":"music","prompt":"Warm lo-fi with Rhodes and vinyl crackle","seconds":90,"bpm":82}'`}</Code>
            </section>
            <section className="grid grid-cols-1 gap-2">
              <div className="font-semibold text-white">Check a job</div>
              <div>GET <code>/api/v1/jobs/&#123;id&#125;</code> until <code>status</code> is <code>done</code> (or <code>failed</code>, with the reason in <code>message</code>). <code>item_id</code> is the new Library item.</div>
              <Code>{`curl "${origin}/api/v1/jobs/job_…" -H "Authorization: Bearer gp_live_…"`}</Code>
            </section>
            <section className="grid grid-cols-1 gap-2">
              <div className="font-semibold text-white">Download with the license</div>
              <div>POST <code>/api/v1/library/download</code> with <code>&#123;&quot;id&quot;&#125;</code> returns a 15-minute <code>url</code> to the full-quality file and the <code>license</code> text (paid plans).</div>
            </section>
            <section className="grid grid-cols-1 gap-1 text-xs text-white/50">
              <div>Errors are JSON <code>&#123;&quot;error&quot;&#125;</code> with 400 (bad request), 401 (key), 402 (credits or plan), 404, 429 (rate limit) or 503 (engine not connected).</div>
            </section>
          </div>
        </Card>
      </div>
    </>
  );
}
