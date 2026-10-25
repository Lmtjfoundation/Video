"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AudioLines, Clapperboard, Languages, Library, Mic, Music, Palette, Sparkles, UserRound, Wand2 } from "lucide-react";
import { AvatarPanel, DubPanel, useRunTool, useVoiceInfo, useVoices, VoicesPanel } from "@/components/voice-tools";
import { SPEECH_LANGUAGES } from "@/lib/languages";
import { TemplatePanel } from "@/components/template-panel";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { jobStarted } from "@/lib/jobs-client";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Spinner, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { FOOTAGE_CATEGORIES, GENRES, MOODS, SFX_CATEGORIES } from "@/lib/library-tags";
import { fillSubject, presetsFor, type Preset } from "@/lib/presets";

type Tab = "music" | "sfx" | "footage" | "voice" | "voices" | "dub" | "avatar" | "templates";
const ALL_TABS: Tab[] = ["music", "sfx", "footage", "voice", "voices", "dub", "avatar", "templates"];
type Info = { engine: boolean; credits: { music: number; sfx: number; footageSecond: number; autoPrompt: number } };
type Voices = { voices: { id: string; label: string }[]; maxChars: number; creditsPer1000: number; enabled: boolean };

const TABS: { id: Tab; label: string; icon: typeof Music; text: string }[] = [
  { id: "music", label: "Music", icon: Music, text: "Songs and instrumentals in any style, 10 seconds to 4 minutes." },
  { id: "sfx", label: "Sound effects", icon: AudioLines, text: "Any sound from a description, up to 30 seconds." },
  { id: "footage", label: "Footage", icon: Clapperboard, text: "Stock-style video clips from a description or a picture." },
  { id: "voice", label: "Voiceover", icon: Mic, text: "Your script read aloud by a natural voice." },
  { id: "voices", label: "My Voices", icon: UserRound, text: "Voice cloning with consent, and the voice changer." },
  { id: "dub", label: "Dubbing", icon: Languages, text: "Your video in 23 languages." },
  { id: "avatar", label: "Avatars & lip sync", icon: UserRound, text: "Pictures that speak; new words on any face." },
  { id: "templates", label: "Templates", icon: Clapperboard, text: "Titles, lower thirds, end screens and more." },
];

export default function CreatePage() {
  return (
    <Suspense fallback={<div className="grid place-items-center py-20"><Spinner /></div>}>
      <AiStudio />
    </Suspense>
  );
}

function AiStudio() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((ALL_TABS.includes(params.get("kind") as Tab) ? params.get("kind") : "music") as Tab);
  const [info, setInfo] = useState<Info | null>(null);
  const { toast } = useApp();
  useEffect(() => {
    api<Info>("/api/library?kind=music&limit=1").then(setInfo).catch((e) => toast((e as Error).message, "error"));
  }, [toast]);

  return (
    <>
      <PageHeader
        title="AI Studio"
        subtitle="Make music, sound effects, footage and voiceovers on Ghost Post's own models. Everything lands in your Library with a title, tags and a commercial license."
        actions={<Link href="/library"><Button><Library className="h-4 w-4" /> Open Library</Button></Link>}
      />
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn("flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition", tab === t.id ? "bg-mint-400 text-ink-950" : "bg-white/5 text-white/70 hover:bg-white/10")}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
        <Link href="/images" className="flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2.5 text-sm font-medium text-white/70 hover:bg-white/10"><Palette className="h-4 w-4" /> Pictures</Link>
      </div>
      {info && !info.engine && tab !== "templates" && (
        <Card className="mb-5 p-4 text-sm text-white/70">
          {tab === "voice"
            ? "English voiceovers work now. Other languages and My Voices need Ghost Post's engine, which the admin connects in Admin → App settings → Integrations."
            : "These tools run on Ghost Post's own engine. The admin connects it in Admin → App settings → Integrations → Ghost Post Video Engine."}
        </Card>
      )}
      {tab === "voice" ? <VoiceForm /> : tab === "voices" ? <VoicesPanel /> : tab === "dub" ? <DubPanel /> : tab === "avatar" ? <AvatarPanel /> : tab === "templates" ? <TemplatePanel /> : <GenForm key={tab} kind={tab} info={info} />}
    </>
  );
}

function GenForm({ kind, info }: { kind: "music" | "sfx" | "footage"; info: Info | null }) {
  const { toast, refresh } = useApp();
  const [prompt, setPrompt] = useState("");
  const [subject, setSubject] = useState("");
  const [preset, setPreset] = useState<Preset | null>(null);
  const [lyrics, setLyrics] = useState("");
  const [vocals, setVocals] = useState(false);
  const [seconds, setSeconds] = useState(kind === "music" ? 90 : kind === "sfx" ? 5 : 5);
  const [bpm, setBpm] = useState("");
  const [key, setKey] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [moods, setMoods] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [aspect, setAspect] = useState("16:9");
  const [startId, setStartId] = useState("");
  const [pictures, setPictures] = useState<{ id: string; name: string; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const meta = TABS.find((t) => t.id === kind)!;

  useEffect(() => {
    if (kind === "footage") api<{ pictures: { id: string; name: string; url: string }[] }>("/api/images").then((d) => setPictures(d.pictures)).catch(() => {});
  }, [kind]);

  function usePreset(p: Preset) {
    setPreset(p);
    setPrompt(p.needsSubject ? fillSubject(p, subject) : p.prompt);
    if (p.seconds) setSeconds(p.seconds);
    if (p.bpm) setBpm(String(p.bpm));
    if (p.genres) setGenres(p.genres);
    if (p.moods) setMoods(p.moods);
    if (p.category) setCategory(p.category);
    if (p.aspect) setAspect(p.aspect);
  }

  async function polish() {
    setPolishing(true);
    try {
      const r = await api<{ prompt: string }>("/api/library/auto-prompt", { body: { kind, idea: prompt } });
      setPrompt(r.prompt);
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setPolishing(false);
    }
  }

  async function make() {
    setBusy(true);
    try {
      const r = await api<{ credits: number }>("/api/library/generate", {
        body: { kind, prompt, seconds, lyrics: vocals ? lyrics : "", bpm: bpm ? Number(bpm) : undefined, key: key || undefined, genres, moods, category: category || undefined, aspect, startMediaId: startId || undefined },
      });
      jobStarted();
      toast(`Started (${r.credits} credits). It appears in your Library when it's ready; you can keep working.`, "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const cost = !info ? null : kind === "music" ? info.credits.music : kind === "sfx" ? info.credits.sfx : info.credits.footageSecond * seconds;
  const chip = (on: boolean) => cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-mint-400 bg-mint-400/15 text-mint-200" : "border-white/10 text-white/60 hover:border-white/30");
  const toggle = (list: string[], set: (v: string[]) => void, t: string) => set(list.includes(t) ? list.filter((x) => x !== t) : [...list, t].slice(0, 3));

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader title={`Make ${kind === "music" ? "music" : kind === "sfx" ? "a sound effect" : "footage"}`} subtitle={meta.text} icon={<meta.icon className="h-4 w-4" />} action={<Badge tone="mint">Ghost Post engine</Badge>} />
        <div className="grid gap-4 p-5">
          {kind === "footage" && preset?.needsSubject && (
            <Field label="Subject" hint="Goes into the preset">
              <Input value={subject} placeholder="e.g. a downtown Houston skyline" onChange={(e) => { setSubject(e.target.value); setPrompt(fillSubject(preset, e.target.value)); }} />
            </Field>
          )}
          <Field label="Describe it" hint={kind === "sfx" ? "Name the sound, its texture and the space it's in" : kind === "music" ? "Genre, mood, instruments, how it builds" : "Subject, action, light, camera move"}>
            <Textarea rows={4} value={prompt} maxLength={500} onChange={(e) => setPrompt(e.target.value)}
              placeholder={kind === "music" ? "e.g. Dark cinematic trap with haunting piano, slow build to a heavy drop" : kind === "sfx" ? "e.g. Glass bottle shattering on concrete, sharp bright transient" : "e.g. Rain on a car windshield at night, city lights blurred behind, slow push in"} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={polish} loading={polishing} disabled={!prompt.trim()}>
              <Sparkles className="h-3.5 w-3.5" /> Auto-prompt{info ? ` (${info.credits.autoPrompt} credit)` : ""}
            </Button>
            <span className="text-xs text-white/40">Turns a short idea into a detailed prompt.</span>
          </div>

          {kind === "music" && (
            <>
              <div>
                <div className="mb-1.5 text-xs uppercase tracking-wide text-white/40">Genre (up to 3)</div>
                <div className="flex flex-wrap gap-1.5">{GENRES.map((g) => <button key={g} className={chip(genres.includes(g))} onClick={() => toggle(genres, setGenres, g)}>{g}</button>)}</div>
              </div>
              <div>
                <div className="mb-1.5 text-xs uppercase tracking-wide text-white/40">Mood (up to 3)</div>
                <div className="flex flex-wrap gap-1.5">{MOODS.map((m) => <button key={m} className={chip(moods.includes(m))} onClick={() => toggle(moods, setMoods, m)}>{m}</button>)}</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={`Length: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}>
                  <input type="range" min={10} max={240} step={5} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className="w-full accent-mint-400" />
                </Field>
                <Field label="Tempo (BPM)" hint="Blank = auto">
                  <Input type="number" min={30} max={300} value={bpm} onChange={(e) => setBpm(e.target.value)} placeholder="e.g. 90" />
                </Field>
                <Field label="Key" hint="Optional">
                  <Input value={key} maxLength={12} onChange={(e) => setKey(e.target.value)} placeholder="e.g. A minor" />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input type="checkbox" checked={vocals} onChange={(e) => setVocals(e.target.checked)} className="accent-mint-400" /> Sung vocals (write the lyrics)
              </label>
              {vocals && (
                <Field label="Lyrics" hint="Use [Verse], [Chorus] and [Bridge] lines to shape the song">
                  <Textarea rows={6} maxLength={4000} value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder={"[Verse]\nTwelve years of keys and promises…\n\n[Chorus]\n…"} />
                </Field>
              )}
            </>
          )}

          {kind === "sfx" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`Length: ${seconds.toFixed(1)} s`}>
                <input type="range" min={0.5} max={30} step={0.5} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className="w-full accent-mint-400" />
              </Field>
              <Field label="Category" hint="Optional: filed automatically">
                <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Automatic</option>
                  {SFX_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </Select>
              </Field>
            </div>
          )}

          {kind === "footage" && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Shape">
                <Select value={aspect} onChange={(e) => setAspect(e.target.value)}>
                  <option value="16:9">16:9 landscape</option>
                  <option value="9:16">9:16 vertical</option>
                  <option value="1:1">1:1 square</option>
                </Select>
              </Field>
              <Field label={`Length: ${seconds} s`}>
                <input type="range" min={1} max={5} step={1} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className="w-full accent-mint-400" />
              </Field>
              <Field label="Category" hint="Optional">
                <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Automatic</option>
                  {FOOTAGE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </Select>
              </Field>
              {!!pictures.length && (
                <div className="sm:col-span-3">
                  <div className="mb-1.5 text-xs uppercase tracking-wide text-white/40">Start from a picture (optional)</div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    <button onClick={() => setStartId("")} className={cn("grid h-20 w-16 shrink-0 place-items-center rounded-lg border text-xs", !startId ? "border-mint-400 text-mint-200" : "border-white/10 text-white/50")}>None</button>
                    {pictures.slice(0, 30).map((p) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={p.id} src={p.url} alt={p.name} onClick={() => setStartId(p.id)} className={cn("h-20 w-16 shrink-0 cursor-pointer rounded-lg object-cover", startId === p.id ? "ring-2 ring-mint-400" : "opacity-70 hover:opacity-100")} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-4">
            <Button variant="primary" size="lg" onClick={make} loading={busy} disabled={!prompt.trim() || (info !== null && !info.engine)}>
              <Wand2 className="h-4 w-4" /> Generate{cost !== null ? ` · ${cost} credits` : ""}
            </Button>
            <span className="text-xs text-white/50">Runs in the background; the tray at the top says when it&apos;s ready.</span>
          </div>
        </div>
      </Card>

      <Card className="h-fit xl:sticky xl:top-10">
        <CardHeader title="Presets" subtitle="Start from a proven recipe, then change anything." icon={<Sparkles className="h-4 w-4" />} />
        <div className="grid gap-2 p-4">
          {presetsFor(kind).map((p) => (
            <button key={p.id} onClick={() => usePreset(p)} className={cn("rounded-xl border px-3 py-2.5 text-left transition", preset?.id === p.id ? "border-mint-400 bg-mint-400/10" : "border-white/10 hover:border-white/25")}>
              <div className="text-sm font-medium">{p.title}</div>
              <div className="text-xs text-white/50">{p.blurb}</div>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

function VoiceForm() {
  const { toast, refresh } = useApp();
  const [v, setV] = useState<Voices | null>(null);
  const { data: mine } = useVoices();
  const info = useVoiceInfo();
  const tool = useRunTool();
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("en");
  const [voice, setVoice] = useState("af_heart");
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ id: string; name: string; url: string }[]>([]);
  useEffect(() => {
    api<Voices>("/api/library/voiceover").then(setV).catch((e) => toast((e as Error).message, "error"));
  }, [toast]);
  // English stock voices run free on Ghost Post's server; any other language, or one of My Voices, uses the engine.
  const free = language === "en" && !!v?.voices.some((x) => x.id === voice);
  useEffect(() => {
    if (language !== "en" && v?.voices.some((x) => x.id === voice)) setVoice("standard");
  }, [language, voice, v]);

  async function make() {
    if (!free) {
      await tool.run({ tool: "speech", text, language, voiceId: voice === "standard" ? undefined : voice });
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ id: string; name: string; url: string; credits: number }>("/api/library/voiceover", { body: { text, voice, speed } });
      setMade((m) => [r, ...m]);
      toast(`Voiceover saved to your Media Library (${r.credits} credits)`, "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  const per = free ? v?.creditsPer1000 : info?.credits.speech;
  const credits = per !== undefined ? per * Math.max(1, Math.ceil(text.length / 1000)) : null;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader title="Voiceover" subtitle="Natural narration from your script in 23 languages, in a stock voice or one of My Voices. Saved to your Media Library." icon={<Mic className="h-4 w-4" />} />
        <div className="grid gap-4 p-5">
          <Field label="Script" hint={v ? `${text.length.toLocaleString()} / ${v.maxChars.toLocaleString()} characters` : undefined}>
            <Textarea rows={8} maxLength={v?.maxChars ?? 5000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Every marriage has a settlement. Most people just never see the bill." />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Language">
              <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
                {Object.entries(SPEECH_LANGUAGES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
              </Select>
            </Field>
            <Field label="Voice">
              <Select value={voice} onChange={(e) => setVoice(e.target.value)}>
                {language === "en" && <optgroup label="Free English voices">{v?.voices.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</optgroup>}
                <optgroup label="Engine voices">
                  <option value="standard">Standard voice</option>
                  {mine?.voices.map((x) => <option key={x.id} value={x.id}>{x.name} (My Voices)</option>)}
                </optgroup>
              </Select>
            </Field>
            {free && (
              <Field label={`Speed: ${speed.toFixed(2)}×`}>
                <input type="range" min={0.7} max={1.3} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-full accent-mint-400" />
              </Field>
            )}
          </div>
          <div className="flex items-center gap-3 border-t border-white/5 pt-4">
            <Button variant="primary" size="lg" onClick={make} loading={busy || tool.busy} disabled={!text.trim() || (free ? v !== null && !v.enabled : info?.engine === false)}>
              <Mic className="h-4 w-4" /> Make voiceover{credits !== null ? ` · ${credits} credit${credits === 1 ? "" : "s"}` : ""}
            </Button>
            {busy && <span className="text-xs text-white/50">About a second of work per sentence…</span>}
            {!free && <span className="text-xs text-white/50">Made on the engine in the background.</span>}
          </div>
        </div>
      </Card>
      <Card className="h-fit">
        <CardHeader title="Made just now" />
        <div className="grid gap-3 p-4">
          {!made.length && <div className="text-sm text-white/50">Your voiceovers play here, and stay in the Media Library.</div>}
          {made.map((m) => (
            <div key={m.id}>
              <div className="mb-1 truncate text-xs text-white/60">{m.name}</div>
              <audio src={m.url} controls className="w-full" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
