"use client";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Copy, Lightbulb, Send } from "lucide-react";
import { useApp } from "@/lib/store";
import { api, copyToClipboard, EXPLAIN_HANDOFF } from "@/lib/client";
import { CREDIT_COST } from "@/lib/plans";
import { PLATFORM_SPECS } from "@/lib/platforms/specs";
import { PLATFORMS, type Platform, type Post } from "@/lib/types";
import { Button, Card, CardHeader, Empty, Field, PageHeader, Select, Textarea } from "@/components/ui";

/* Mirrors src/lib/explain.ts (server-only). */
interface Explanation {
  title: string;
  summary: string;
  explanation: string[];
  keyPoints: string[];
  glossary: { term: string; meaning: string }[];
  example: string;
  caveats: string[];
}
const LEVELS = [
  { id: "simple", label: "Simple — a curious 12-year-old" },
  { id: "general", label: "Everyday — no background needed" },
  { id: "expert", label: "Detailed — precise, terms defined" },
];
const MAX_CHARS = 20_000;

export default function ExplainPage() {
  const router = useRouter();
  const { status, toast, refresh } = useApp();
  const [text, setText] = useState("");
  const [level, setLevel] = useState("general");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ explanation: Explanation; text: string } | null>(null);
  const [platform, setPlatform] = useState<Platform>("facebook");
  const [saving, setSaving] = useState(false);
  const cost = CREDIT_COST.explain * (text.length > 8000 ? 2 : 1);
  const admin = status?.me.user.role === "admin";

  async function explain() {
    setBusy(true);
    try {
      setResult(await api("/api/explain", { body: { action: "explain", text, level } }));
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!result) return;
    setSaving(true);
    try {
      const p = await api<Post>("/api/explain", { body: { action: "save", explanation: result.explanation, platform } });
      toast(`Saved as a ${PLATFORM_SPECS[platform].name} draft.`, "success");
      router.push(`/post/${p.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  function toVideo() {
    if (!result) return;
    try {
      sessionStorage.setItem(EXPLAIN_HANDOFF, result.text);
    } catch {
      /* storage unavailable: Movie Studio opens empty */
    }
    router.push("/movies");
  }

  const e = result?.explanation;
  return (
    <div>
      <PageHeader title="Explain" subtitle="Paste any text — an article, a contract clause, a school lesson, a policy — and get a clear explanation you can read, post, or turn into an explainer video." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader title="Text to explain" subtitle={admin ? "Owner account · no credits used" : `${status ? `${status.me.creditsLeft.toLocaleString()} credits left · ` : ""}this costs ${cost} credit${cost > 1 ? "s" : ""}`} icon={<Lightbulb className="h-4 w-4" />} />
          <div className="grid gap-4 p-5">
            <Field label="Text" hint={`${text.length.toLocaleString()} / ${MAX_CHARS.toLocaleString()} characters`}>
              <Textarea rows={14} maxLength={MAX_CHARS} value={text} onChange={(ev) => setText(ev.target.value)} placeholder="Paste the text here…" />
            </Field>
            <Field label="Explain it for">
              <Select value={level} onChange={(ev) => setLevel(ev.target.value)}>
                {LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </Select>
            </Field>
            <div className="flex justify-end">
              <Button variant="primary" size="lg" loading={busy} disabled={text.trim().length < 20} onClick={explain}>
                <Lightbulb className="h-4 w-4" /> Explain it
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title={e?.title ?? "Explanation"}
            subtitle={e ? "Check the points under “Worth checking” before you share it." : undefined}
            action={e && <Button size="sm" onClick={async () => { await copyToClipboard(result!.text); toast("Copied.", "success"); }}><Copy className="h-3.5 w-3.5" /> Copy</Button>}
          />
          <div className="p-5">
            {e ? (
              <div className="grid gap-5 text-[14px] leading-relaxed text-white/80">
                {e.summary && <p className="rounded-xl bg-mint-400/[0.07] p-4 text-[15px] text-white ring-1 ring-mint-300/20">{e.summary}</p>}
                <div className="grid gap-3">{e.explanation.map((p, i) => <p key={i}>{p}</p>)}</div>
                {e.keyPoints.length > 0 && (
                  <Section title="Key points">
                    <ul className="grid list-disc gap-1.5 pl-5">{e.keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul>
                  </Section>
                )}
                {e.example && <Section title="Example"><p>{e.example}</p></Section>}
                {e.glossary.length > 0 && (
                  <Section title="Terms">
                    <dl className="grid gap-2">
                      {e.glossary.map((g) => (
                        <div key={g.term}>
                          <dt className="font-medium text-white">{g.term}</dt>
                          <dd className="text-white/65">{g.meaning}</dd>
                        </div>
                      ))}
                    </dl>
                  </Section>
                )}
                {e.caveats.length > 0 && (
                  <Section title="Worth checking">
                    <ul className="grid list-disc gap-1.5 pl-5 text-gold-300/90">{e.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
                  </Section>
                )}
                <div className="grid gap-3 border-t border-white/[0.06] pt-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                  <Field label="Save as a post for">
                    <Select value={platform} onChange={(ev) => setPlatform(ev.target.value as Platform)}>
                      {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_SPECS[p].name}</option>)}
                    </Select>
                  </Field>
                  <Button loading={saving} onClick={save}><Send className="h-4 w-4" /> Save as draft</Button>
                  <Button variant="primary" onClick={toVideo}><Clapperboard className="h-4 w-4" /> Make an explainer video</Button>
                </div>
              </div>
            ) : (
              <Empty icon={<Lightbulb className="h-5 w-5" />} title="Nothing explained yet" body="Paste text on the left and press Explain it. You'll get a summary, a plain-language explanation, key points, an example, the terms defined, and anything worth double-checking." />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/45">{title}</p>
      {children}
    </div>
  );
}
