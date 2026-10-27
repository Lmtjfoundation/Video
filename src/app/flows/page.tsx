"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Play, Plus, Save, Trash2, Workflow } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { jobStarted } from "@/lib/jobs-client";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { FLOW_STEP_TYPES, flowCredits, STEP_LABEL, type Flow, type FlowStep, type FlowStepType } from "@/lib/flow-types";
import { SPEECH_LANGUAGES } from "@/lib/languages";
import { useVoices } from "@/components/voice-tools";

type Listed = Omit<Flow, "id" | "createdAt"> & { id?: string; createdAt?: string; credits: number };
type Data = { flows: Listed[]; templates: Listed[]; engine: boolean };

export default function FlowsPage() {
  const { toast, refresh } = useApp();
  const { data: voices } = useVoices();
  const [data, setData] = useState<Data | null>(null);
  const [edit, setEdit] = useState<Listed | null>(null);
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<Data>("/api/flows");
      setData(d);
      setEdit((e) => e ?? d.flows[0] ?? d.templates[0]);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);

  const setStep = (i: number, patch: Partial<FlowStep>) => setEdit((e) => e && { ...e, steps: e.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i: number, d: -1 | 1) => setEdit((e) => {
    if (!e) return e;
    const steps = [...e.steps];
    const j = i + d;
    if (j < 0 || j >= steps.length) return e;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    return { ...e, steps };
  });

  async function save() {
    if (!edit) return;
    try {
      const r = await api<{ flow: Flow }>("/api/flows", { body: { action: "save", flow: edit } });
      toast("Flow saved", "success");
      setEdit({ ...r.flow, credits: edit.credits });
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  async function run() {
    if (!edit) return;
    setBusy(true);
    try {
      const r = await api<{ credits: number }>("/api/flows", { body: { action: "run", id: edit.id, flow: edit.id ? undefined : edit, idea } });
      jobStarted();
      toast(`Running (${r.credits} credits). The finished video lands in your Media Library.`, "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Flows" subtitle="Chain the AI tools into one pipeline you can run again with any idea: pictures, footage, music, sound, voice, and a finished video at the end." />
      {data && !data.engine && <Card className="mb-5 p-4 text-sm text-white/70">Flows run on Ghost Post&apos;s own engine. The admin connects it in Admin → App settings → Integrations → Ghost Post Video Engine.</Card>}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader title="Your flows" icon={<Workflow className="h-4 w-4" />} action={<Button size="sm" onClick={() => setEdit({ name: "New flow", steps: [{ type: "image" }, { type: "footage" }, { type: "music" }, { type: "finish" }], credits: 0 })}><Plus className="h-3.5 w-3.5" /> New</Button>} />
          <div className="grid grid-cols-1 gap-1.5 p-3">
            {!data?.flows.length && <div className="px-2 text-sm text-white/50">None saved yet. Start from a ready-made one:</div>}
            {data?.flows.map((f) => (
              <button key={f.id} onClick={() => setEdit(f)} className={cn("rounded-lg px-3 py-2 text-left text-sm", edit?.id === f.id ? "bg-white/10" : "hover:bg-white/5")}>
                {f.name} <span className="text-xs text-white/40">· {f.steps.length} steps</span>
              </button>
            ))}
            <div className="mt-2 px-2 text-xs uppercase tracking-wide text-white/40">Ready-made</div>
            {data?.templates.map((t) => (
              <button key={t.name} onClick={() => setEdit({ ...t, id: undefined })} className={cn("rounded-lg px-3 py-2 text-left text-sm", !edit?.id && edit?.name === t.name ? "bg-white/10" : "hover:bg-white/5")}>
                {t.name} <span className="text-xs text-white/40">· {t.credits} credits</span>
              </button>
            ))}
          </div>
        </Card>

        {edit && (
          <div className="grid grid-cols-1 gap-4">
            <Card className="p-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Input value={edit.name} maxLength={60} onChange={(e) => setEdit({ ...edit, name: e.target.value })} aria-label="Flow name" />
                <div className="flex gap-2">
                  <Button onClick={save}><Save className="h-4 w-4" /> Save</Button>
                  {edit.id && <Button variant="ghost" onClick={async () => { if (confirm(`Delete “${edit.name}”?`)) { await api("/api/flows", { body: { action: "delete", id: edit.id } }); setEdit(null); load(); } }}><Trash2 className="h-4 w-4" /></Button>}
                </div>
              </div>
            </Card>
            {edit.steps.map((s, i) => (
              <Card key={i} className="p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Badge tone="mint">{i + 1}</Badge>
                  <Select className="w-auto" value={s.type} onChange={(e) => setStep(i, { type: e.target.value as FlowStepType })}>
                    {FLOW_STEP_TYPES.map((t) => <option key={t} value={t}>{STEP_LABEL[t].title}</option>)}
                  </Select>
                  <span className="hidden text-xs text-white/50 md:inline">{STEP_LABEL[s.type].hint}</span>
                  <div className="ml-auto flex gap-1">
                    <button className="grid grid-cols-1 h-8 w-8 place-items-center rounded-lg text-white/60 hover:bg-white/10" aria-label="Move up" onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></button>
                    <button className="grid grid-cols-1 h-8 w-8 place-items-center rounded-lg text-white/60 hover:bg-white/10" aria-label="Move down" onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></button>
                    <button className="grid grid-cols-1 h-8 w-8 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-red-300" aria-label="Remove step" onClick={() => setEdit({ ...edit, steps: edit.steps.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                {s.type !== "finish" && (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                    <Textarea rows={2} value={s.prompt ?? ""} maxLength={600} onChange={(e) => setStep(i, { prompt: e.target.value })}
                      placeholder={s.type === "voiceover" ? "{idea} (the words to read)" : s.type === "prompt" ? "{idea}" : "Blank uses {text}, or {idea}"} />
                    <div className="flex flex-wrap gap-2 md:w-56 md:flex-col">
                      {(s.type === "image" || s.type === "footage") && (
                        <Select value={s.aspect ?? ""} onChange={(e) => setStep(i, { aspect: (e.target.value || undefined) as FlowStep["aspect"] })}>
                          <option value="">Same shape as before</option><option value="9:16">9:16</option><option value="16:9">16:9</option><option value="1:1">1:1</option>
                        </Select>
                      )}
                      {(s.type === "footage" || s.type === "music" || s.type === "sfx") && (
                        <Input type="number" min={1} max={s.type === "footage" ? 5 : s.type === "sfx" ? 30 : 240} value={s.seconds ?? ""} placeholder="Seconds" onChange={(e) => setStep(i, { seconds: Number(e.target.value) || undefined })} />
                      )}
                      {s.type === "prompt" && (
                        <Select value={s.kind ?? "footage"} onChange={(e) => setStep(i, { kind: e.target.value as FlowStep["kind"] })}>
                          <option value="footage">For footage</option><option value="image">For a picture</option><option value="music">For music</option><option value="sfx">For a sound</option>
                        </Select>
                      )}
                      {s.type === "voiceover" && (
                        <>
                          <Select value={s.language ?? "en"} onChange={(e) => setStep(i, { language: e.target.value })}>
                            {Object.entries(SPEECH_LANGUAGES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                          </Select>
                          <Select value={s.voiceId ?? ""} onChange={(e) => setStep(i, { voiceId: e.target.value || undefined })}>
                            <option value="">Standard voice</option>
                            {voices?.voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                          </Select>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            ))}
            <Button variant="ghost" onClick={() => setEdit({ ...edit, steps: [...edit.steps, { type: "footage" }] })}><Plus className="h-4 w-4" /> Add a step</Button>
            <Card className="p-5">
              <Field label="Run it with an idea" hint="Fills {idea} in every step">
                <Textarea rows={3} value={idea} maxLength={2000} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. A cold brew coffee brand called Midnight, for night-shift workers" />
              </Field>
              <Button variant="primary" size="lg" className="mt-3" loading={busy} disabled={!idea.trim() || !edit.steps.length || data?.engine === false} onClick={run}>
                <Play className="h-4 w-4" /> Run the flow · about {flowCredits(edit, idea.length)} credits
              </Button>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
