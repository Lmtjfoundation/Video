"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Compass, ExternalLink, Lock } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { NICHES, NICHE_SOURCES, TT_US_RPM } from "@/lib/niches";
import { builtInNiches } from "@/lib/niche-picks";
import { CREDIT_COST } from "@/lib/plans";
import type { NicheReport } from "@/lib/types";
import { cn, usd } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";

export default function NicheLab() {
  const { status, toast, refresh } = useApp();
  const [sort, setSort] = useState<"rpm" | "fit">("rpm");
  const [calcId, setCalcId] = useState("edu");
  const [views, setViews] = useState(100_000);
  const [reports, setReports] = useState<NicheReport[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [form, setForm] = useState({ interests: "", platform: "YouTube long-form", hours: "3–8 hours", goal: "Highest revenue per view" });
  const [busy, setBusy] = useState(false);
  const allowed = status?.me.plan.features.nicheResearch ?? false;

  useEffect(() => {
    api<NicheReport[]>("/api/niche").then((r) => {
      setReports(r); // results stay hidden until the user presses Generate (or opens a past result)
    }).catch(() => {});
  }, []);

  const sorted = useMemo(
    () => [...NICHES].sort((a, b) => (sort === "fit" ? Number(b.fit.startsWith("High")) - Number(a.fit.startsWith("High")) || b.rpm - a.rpm : b.rpm - a.rpm)),
    [sort],
  );
  const calc = NICHES.find((n) => n.id === calcId) ?? NICHES[0];
  const rep = current ? reports.find((r) => r.id === current) ?? null : null;

  function showResults(r: NicheReport) {
    setReports((x) => [r, ...x.filter((y) => y.id !== r.id)]);
    setCurrent(r.id);
    setTimeout(() => document.getElementById("niche-results")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  function builtIn(note: string) {
    const b = builtInNiches(form.interests);
    showResults({ id: `local_${Date.now()}`, createdAt: new Date().toISOString(), input: { ...form }, source: "builtin", note, summary: b.summary, niches: b.niches });
  }

  async function research() {
    if (!allowed) {
      builtIn("Built-in picks from the sourced data (free). Upgrade to Creator for Claude-researched niches tailored to you.");
      return;
    }
    setBusy(true);
    try {
      const r = await api<NicheReport>("/api/niche", { body: form });
      showResults({ ...r, source: "claude" });
      toast("Niches ready", "success");
      refresh();
    } catch (e) {
      const msg = (e as Error).message;
      if (/credit|quota/i.test(msg)) toast(msg, "error");
      else { builtIn(`${msg} Showing built-in picks instead (no credits used).`); toast("Showing built-in picks", "info"); }
    } finally {
      setBusy(false);
    }
  }

  const storyHref = (params: Record<string, string>) => `/stories?${new URLSearchParams(params)}`;

  return (
    <>
      <PageHeader title="Niche Lab" subtitle="The niches that earn the most per view, with specific, true story ideas that hold attention — no filler." />

        <Card className="mb-6">
          <CardHeader title="Generate niches" subtitle="Leave it blank for the highest-earning niches overall, or add your interests for picks that fit you. Results appear only after you press Generate." />
          <div className="grid grid-cols-1 gap-4 p-5">
            <Field label="What you know or enjoy" hint="optional">
              <Textarea value={form.interests} onChange={(e) => setForm({ ...form, interests: e.target.value })} placeholder="e.g. aviation, true crime documentaries, personal finance, ancient history" />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Main platform">
                <Select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>{["YouTube long-form", "YouTube Shorts", "TikTok", "All of them"].map((x) => <option key={x}>{x}</option>)}</Select>
              </Field>
              <Field label="Time per week">
                <Select value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })}>{["Under 3 hours", "3–8 hours", "8–20 hours", "20+ hours"].map((x) => <option key={x}>{x}</option>)}</Select>
              </Field>
              <Field label="Goal">
                <Select value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })}>{["Highest revenue per view", "Fastest growth", "Lowest competition", "Easiest to produce"].map((x) => <option key={x}>{x}</option>)}</Select>
              </Field>
            </div>
            <Button variant="primary" size="lg" loading={busy} onClick={research}>
              {allowed ? `Generate niches · ${CREDIT_COST.niche} credits` : "Generate niches · free picks"}
            </Button>
            {!allowed && (
              <Link href="/plans" className="text-xs text-gold-300 hover:underline"><Lock className="mr-1 inline h-3 w-3" />Claude-researched niches tailored to you are included from Creator</Link>
            )}
          </div>
        </Card>
      {!rep && (
        <Card className="mb-6 p-8 text-center">
          <p className="font-medium text-white">No results yet</p>
          <p className="mt-1 text-sm text-white/55">Press <b>Generate niches</b>. Leave the box blank for the highest-earning niches overall.</p>
          {reports.length > 0 && (
            <Select value="" onChange={(e) => e.target.value && setCurrent(e.target.value)} className="mx-auto mt-4 w-72" aria-label="Past results">
              <option value="">Open a past result ({reports.length})</option>
              {reports.map((r) => <option key={r.id} value={r.id}>{new Date(r.createdAt).toLocaleDateString()} · {r.niches[0]?.name}</option>)}
            </Select>
          )}
        </Card>
      )}
      {rep && (
        <Card className="mb-6" id="niche-results">
          <CardHeader
            title="Your niches"
            subtitle={`${new Date(rep.createdAt).toLocaleString()} · ${rep.input.interests ? `for: ${rep.input.interests.slice(0, 60)}` : "highest-earning overall"} · ${rep.source === "builtin" ? "built-in picks" : "researched by Claude"}`}
            action={<Button size="sm" variant="ghost" onClick={() => setCurrent(null)}>Clear</Button>}
          />
          <div className="grid grid-cols-1 gap-4 p-5">
            {rep.note && <p className="rounded-xl bg-sky-400/[0.06] p-3 text-sm text-sky-100/90 ring-1 ring-sky-300/20">{rep.note}</p>}
            {rep.summary && <p className="max-w-3xl text-white/80">{rep.summary}</p>}
            {rep.niches.map((n, i) => {
              const match = NICHES.find((x) => x.name === n.dataNiche);
              return (
                <div key={i} className="grid grid-cols-1 gap-4 rounded-2xl bg-ink-900/70 p-5 ring-1 ring-white/[0.06]">
                  <div className="flex items-start gap-3">
                    <span className="grid grid-cols-1 h-8 w-8 shrink-0 place-items-center rounded-lg bg-mint-400/10 font-semibold text-mint-300 ring-1 ring-mint-400/30">{i + 1}</span>
                    <div>
                      <h3 className="text-[17px] font-semibold text-white">{n.name}</h3>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {n.dataNiche && <Badge>{n.dataNiche}</Badge>}
                        {n.competition && <Badge tone={n.competition === "low" ? "mint" : n.competition === "high" ? "red" : "gold"}>{n.competition} competition</Badge>}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                    <div className="grid grid-cols-1 gap-2 text-white/75">
                      <p><span className="font-medium text-white">Why it earns.</span> {n.whyItEarns}</p>
                      {n.rpmBasis && <p className="text-white/45">{n.rpmBasis}</p>}
                      <p><span className="font-medium text-white">Format.</span> {n.facelessFormat}</p>
                      <p><span className="font-medium text-white">Audience.</span> {n.audience}</p>
                    </div>
                    <div className="grid grid-cols-1 gap-2 text-white/75">
                      <p className="font-medium text-white">Money stack</p>
                      <ul className="list-disc pl-5">{(n.monetization ?? []).map((m) => <li key={m}>{m}</li>)}</ul>
                      <p className="font-medium text-white">Risks</p>
                      <ul className="list-disc pl-5">{(n.risks ?? []).map((m) => <li key={m}>{m}</li>)}</ul>
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-medium text-white">Story ideas</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {(n.storyIdeas ?? []).map((s, k) => (
                        <div key={k} className="grid grid-cols-1 gap-2 rounded-xl bg-ink-850 p-3 ring-1 ring-white/[0.06]">
                          <Badge tone={s.type === "fiction" ? "violet" : s.type === "true" ? "mint" : s.type === "funny" ? "gold" : "sky"}>{s.type === "funny" ? "funny history" : s.type ?? "idea"}</Badge>
                          <p className="text-sm font-medium text-white">{s.title}</p>
                          {s.hook && <p className="text-xs text-white/50">{s.hook}</p>}
                          <Link href={storyHref({ niche: match?.id ?? "custom", custom: match ? "" : n.name, topic: `${s.title}${s.hook ? ` — hook: ${s.hook}` : ""} (sub-niche: ${n.name})`, type: ["true", "funny", "explainer", "fiction"].includes(s.type ?? "") ? s.type! : "explainer" })}>
                            <Button size="sm">Write it</Button>
                          </Link>
                        </div>
                      ))}
                    </div>
                  </div>
                  {n.first30Days?.length ? <p className="text-sm text-white/70"><span className="font-medium text-white">First 30 days.</span> {n.first30Days.join(" · ")}</p> : null}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {rep && (
        <>
      <Card className="mb-6">
        <CardHeader
          title="What niches earn per 1,000 views"
          subtitle="YouTube long-form RPM (your share after YouTube's cut). Median, with the middle-half range. Directional rows have small samples."
          icon={<Compass className="h-4 w-4" />}
          action={
            <Select value={sort} onChange={(e) => setSort(e.target.value as "rpm" | "fit")} className="w-44" aria-label="Sort">
              <option value="rpm">Highest RPM</option>
              <option value="fit">Best for faceless</option>
            </Select>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-white/40">
              <tr><th className="px-5 py-3">Niche</th><th className="px-3 py-3">Median RPM</th><th className="px-3 py-3">Middle half</th><th className="px-3 py-3">Faceless fit</th><th className="px-3 py-3">Story formats</th><th className="px-5 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {sorted.map((n) => (
                <tr key={n.id} className={n.dir ? "[&>td]:border-dashed" : ""}>
                  <td className="px-5 py-3 align-top">
                    <p className="font-medium text-white">{n.name}</p>
                    {n.dir && <p className="text-xs text-white/40">Directional · {n.dir}</p>}
                    {n.note && <p className="mt-0.5 max-w-xs text-xs text-gold-300/90">{n.note}</p>}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <span className={cn("font-mono font-semibold tabular-nums", n.rpm >= 5 ? "text-mint-300" : n.rpm >= 2 ? "text-white" : "text-red-300")}>${n.rpm.toFixed(2)}</span>
                    <div className="mt-1.5 h-1 w-24 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-gradient-to-r from-mint-400 to-gold-400" style={{ width: `${Math.min(100, (n.rpm / 10.22) * 100)}%` }} /></div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 align-top font-mono text-white/50">${n.lo.toFixed(2)}–${n.hi.toFixed(2)}</td>
                  <td className="px-3 py-3 align-top text-white/80">{n.fit}</td>
                  <td className="px-3 py-3 align-top text-white/55">{n.formats}</td>
                  <td className="px-5 py-3 align-top">{n.id !== "kids" && <Link href={storyHref({ niche: n.id })}><Button size="sm">Write a story</Button></Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-4 text-xs text-white/45">Shorts pay far less than long-form: measured Shorts RPMs in the same study range from $0.02 to $1.48. TikTok's Creator Rewards benchmark is about ${TT_US_RPM} per 1,000 qualified US views, and only videos over one minute earn.</p>
      </Card>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Revenue calculator" subtitle="Ad revenue only. Sponsors and affiliates come on top." />
          <div className="grid grid-cols-1 gap-4 p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Niche">
                <Select value={calcId} onChange={(e) => setCalcId(e.target.value)}>
                  {NICHES.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                </Select>
              </Field>
              <Field label="Monthly views">
                <Input type="number" min={0} step={1000} value={views} onChange={(e) => setViews(Math.max(0, Number(e.target.value) || 0))} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <CalcTile label="YouTube long-form" value={usd((views / 1000) * calc.rpm)} sub={`${usd((views / 1000) * calc.lo)}–${usd((views / 1000) * calc.hi)}`} accent />
              <CalcTile label="TikTok (US, >1 min)" value={usd((views / 1000) * TT_US_RPM * calc.tt)} sub={`${calc.tt}× niche multiplier`} />
              <CalcTile label="Per year (YouTube)" value={usd((views / 1000) * calc.rpm * 12)} sub="at median RPM" />
            </div>
            <p className="text-xs text-white/40">Real RPM depends on audience country, season, video length and how many views are monetized.</p>
          </div>
        </Card>

      </div>
      <Card className="p-5 text-sm">
        <p className="font-medium text-white">Sources</p>
        <ul className="mt-2 grid grid-cols-1 gap-1.5">
          {NICHE_SOURCES.map(([t, u]) => (
            <li key={u}><a href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:underline">{t} <ExternalLink className="h-3 w-3" /></a></li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-white/45">No outside tool can see another channel's RPM; it appears only in that creator's YouTube Studio. That's why this table uses a study of channels' own Studio data rather than advertiser-price estimates.</p>
      </Card>
        </>
      )}
    </>
  );
}

function CalcTile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-ink-900/80 p-3 ring-1 ring-white/[0.06]">
      <p className="label">{label}</p>
      <p className={cn("mt-2 text-xl font-semibold tabular-nums", accent ? "text-gold-300" : "text-white")}>{value}</p>
      <p className="mt-1 text-xs text-white/45">{sub}</p>
    </div>
  );
}
