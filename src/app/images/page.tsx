"use client";
import { useCallback, useEffect, useState } from "react";
import { Download, ImagePlus, Palette, SlidersHorizontal, UsersRound, Wand2 } from "lucide-react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { Badge, Button, Card, CardHeader, Empty, Field, PageHeader, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { IMAGE_TOOLS, type ImageToolId } from "@/lib/image-tools";

type Pic = { id: string; name: string; url: string };
type Data = {
  engine: "own" | "gemini" | null;
  lookGroups: { label: string; looks: string[] }[];
  credits: number;
  toolCredits: { image: number; upscale: number; removeBg: number };
  toolsReady?: { upscale: boolean; removeBg: boolean };
  made: Pic[];
  pictures: Pic[];
  characters: { id: string; name: string; imageUrl: string }[];
};
type Mode = "create" | "edit" | "scene" | "tools";

const MODES: { id: Mode; title: string; text: string; icon: typeof Palette; placeholder: string }[] = [
  { id: "create", title: "Create", text: "A new picture from a description.", icon: Palette, placeholder: "e.g. A Houston street corner at night in the rain, red and blue lights far away" },
  { id: "edit", title: "Edit a picture", text: "Change one of your pictures by describing the change.", icon: Wand2, placeholder: "e.g. Make it night time and add rain on the window" },
  { id: "scene", title: "Characters in a scene", text: "Put up to three of your characters into a new scene, faces kept.", icon: UsersRound, placeholder: "e.g. Marcus and Tasha arguing at the kitchen table, bills spread out between them" },
  { id: "tools", title: "Tools", text: "Erase, expand, new background, cut-out, restyle, relight, camera angle, restore, retouch, headshots, character swap and 4K upscale.", icon: SlidersHorizontal, placeholder: "" },
];

export default function ImageStudio() {
  const { toast, refresh } = useApp();
  const [data, setData] = useState<Data | null>(null);
  const [mode, setMode] = useState<Mode>("create");
  const [prompt, setPrompt] = useState("");
  const [look, setLook] = useState("");
  const [aspect, setAspect] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [mediaId, setMediaId] = useState("");
  const [cast, setCast] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState<Pic | null>(null);
  const [tool, setTool] = useState<ImageToolId>("erase");
  const [swapWith, setSwapWith] = useState("");
  const [angle, setAngle] = useState<{ rotate: number; tilt: number; lens: "wide" | "normal" | "close" }>({ rotate: 30, tilt: 0, lens: "normal" });
  const [scale, setScale] = useState<2 | 4>(4);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>("/api/images"));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);

  const m = MODES.find((x) => x.id === mode)!;
  const t = IMAGE_TOOLS.find((x) => x.id === tool)!;
  const ready = mode === "edit" ? !!mediaId : mode === "scene" ? cast.length > 0 : mode === "tools" ? !!mediaId && (!t.ask?.required || !!prompt.trim()) && (tool !== "swap" || !!swapWith) : true;
  const cost = mode !== "tools" ? data?.credits ?? 4 : data ? data.toolCredits[t.cost] : 0;
  const engineOk = mode === "tools" && t.cost !== "image" ? !!data?.toolsReady?.[t.cost] : !!data?.engine;

  async function make() {
    setBusy(true);
    try {
      const pic = await api<Pic>("/api/images", {
        body: mode === "tools"
          ? { tool, mediaId, prompt, aspect, characterId: swapWith || undefined, angle, scale }
          : { mode, prompt, look: look || undefined, aspect, mediaId: mediaId || undefined, characterIds: mode === "scene" ? cast : undefined },
      });
      setLatest(pic);
      setData((d) => (d ? { ...d, made: [pic, ...d.made], pictures: [pic, ...d.pictures] } : d));
      toast("Picture saved to your Media Library", "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Image Studio" subtitle="Make pictures, change them by describing the change, and put your characters into any scene. Everything is saved to your Media Library." />
      {data && !data.engine && (
        <Card className="mb-6 p-4 text-sm text-white/70">
          Pictures need Ghost Post&apos;s own engine. The admin connects it in Admin → App settings → Integrations → Ghost Post Video Engine.
        </Card>
      )}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[400px_1fr]">
        <Card className="h-fit xl:sticky xl:top-10">
          <CardHeader title="Make a picture" subtitle={m.text} icon={<ImagePlus className="h-4 w-4" />} action={data?.engine === "own" ? <Badge tone="mint">Ghost Post engine</Badge> : undefined} />
          <div className="grid grid-cols-1 gap-4 p-5">
            <div className="grid grid-cols-4 gap-1.5">
              {MODES.map((x) => (
                <button
                  key={x.id}
                  onClick={() => {
                    setMode(x.id);
                    setMediaId("");
                  }}
                  className={cn("focus-ring flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-[11px] font-semibold ring-1", mode === x.id ? "bg-mint-400/15 text-mint-200 ring-mint-400/40" : "bg-white/[0.03] text-white/55 ring-white/10 hover:text-white")}
                >
                  <x.icon className="h-4 w-4" />
                  {x.title}
                </button>
              ))}
            </div>

            {mode === "scene" && (
              <div>
                <span className="mb-1.5 block text-[13px] font-medium text-white/80">Characters <span className="font-normal text-white/40">· up to 3</span></span>
                {data?.characters.length ? (
                  <div className="flex flex-wrap gap-2">
                    {data.characters.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setCast((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id].slice(0, 3)))}
                        className={cn("focus-ring flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-xs ring-1", cast.includes(c.id) ? "bg-mint-400/15 text-mint-100 ring-mint-400/50" : "bg-white/[0.03] text-white/60 ring-white/10")}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={c.imageUrl} alt="" className="h-7 w-7 rounded-full object-cover object-top" />
                        {c.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-white/50">
                    No characters yet. Make them in <Link href="/movies" className="text-mint-300 hover:underline">Movie Studio → Characters</Link>.
                  </p>
                )}
              </div>
            )}

            {mode === "tools" && (
              <div className="grid grid-cols-3 gap-1.5">
                {IMAGE_TOOLS.map((x) => (
                  <button key={x.id} onClick={() => { setTool(x.id); setPrompt(""); }} title={x.text} className={cn("focus-ring rounded-lg px-2 py-2 text-[11px] font-semibold ring-1", tool === x.id ? "bg-mint-400/15 text-mint-200 ring-mint-400/40" : "bg-white/[0.03] text-white/60 ring-white/10 hover:text-white")}>
                    {x.name}
                  </button>
                ))}
              </div>
            )}
            {mode === "tools" && <p className="-mt-2 text-xs text-white/55">{t.text}</p>}

            {mode !== "create" && (
              <div>
                <span className="mb-1.5 block text-[13px] font-medium text-white/80">
                  {mode === "edit" || mode === "tools" ? "Picture to change" : "Setting"} <span className="font-normal text-white/40">{mode === "scene" ? "· optional, a place from your pictures" : ""}</span>
                </span>
                {data?.pictures.length ? (
                  <div className="grid max-h-48 grid-cols-6 gap-1.5 overflow-y-auto">
                    {data.pictures.map((p) => (
                      <button key={p.id} onClick={() => setMediaId((v) => (v === p.id ? "" : p.id))} title={p.name} className={cn("focus-ring aspect-square overflow-hidden rounded-lg ring-2", mediaId === p.id ? "ring-mint-400" : "ring-transparent opacity-60 hover:opacity-100")}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt={p.name} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-white/50">No pictures yet. Upload some in the <Link href="/media" className="text-mint-300 hover:underline">Media Library</Link>.</p>
                )}
              </div>
            )}

            {mode === "tools" ? (
              <>
                {t.presets && (
                  <div className="flex flex-wrap gap-1.5">
                    {t.presets.map((p) => <button key={p} onClick={() => setPrompt(p)} className={cn("rounded-lg px-2.5 py-1 text-[11px]", prompt === p ? "bg-mint-400/20 text-mint-100" : "bg-white/5 text-white/65 hover:bg-white/10")}>{p.split(":")[0]}</button>)}
                  </div>
                )}
                {t.ask && (
                  <Field label={t.ask.label}>
                    <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value.slice(0, 600))} placeholder={t.ask.placeholder} className="min-h-[80px]" />
                  </Field>
                )}
                {tool === "expand" && (
                  <Field label="New shape">
                    <Select value={aspect} onChange={(e) => setAspect(e.target.value as typeof aspect)}>
                      <option value="16:9">16:9 (wide)</option>
                      <option value="9:16">9:16 (tall)</option>
                      <option value="1:1">1:1 (square)</option>
                    </Select>
                  </Field>
                )}
                {tool === "angle" && (
                  <div className="grid grid-cols-1 gap-3 rounded-xl bg-white/[0.03] p-3 text-xs text-white/70">
                    <label className="grid grid-cols-1 gap-1">Orbit left / right: {angle.rotate}°<input type="range" min={-90} max={90} step={5} value={angle.rotate} onChange={(e) => setAngle({ ...angle, rotate: Number(e.target.value) })} className="accent-mint-400" /></label>
                    <label className="grid grid-cols-1 gap-1">Look up / down: {angle.tilt}°<input type="range" min={-60} max={60} step={5} value={angle.tilt} onChange={(e) => setAngle({ ...angle, tilt: Number(e.target.value) })} className="accent-mint-400" /></label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(["wide", "normal", "close"] as const).map((l) => <button key={l} onClick={() => setAngle({ ...angle, lens: l })} className={cn("rounded-lg py-1.5", angle.lens === l ? "bg-mint-400/20 text-mint-100" : "bg-white/5")}>{l === "wide" ? "Wider" : l === "close" ? "Closer" : "Same"}</button>)}
                    </div>
                  </div>
                )}
                {tool === "swap" && (
                  <Field label="Put this character in">
                    <Select value={swapWith} onChange={(e) => setSwapWith(e.target.value)}>
                      <option value="">{data?.characters.length ? "Choose…" : "Make characters in Movie Studio first"}</option>
                      {data?.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  </Field>
                )}
                {tool === "upscale" && (
                  <div className="grid grid-cols-2 gap-1.5">
                    {([2, 4] as const).map((n) => <button key={n} onClick={() => setScale(n)} className={cn("rounded-lg py-2 text-sm", scale === n ? "bg-mint-400/20 text-mint-100" : "bg-white/5 text-white/65")}>{n}× {n === 4 ? "(up to 4K)" : ""}</button>)}
                  </div>
                )}
              </>
            ) : (
            <>
            <Field label={mode === "edit" ? "What to change" : "Describe the picture"}>
              <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value.slice(0, 1500))} placeholder={m.placeholder} className="min-h-[110px]" />
            </Field>
            <div className="grid grid-cols-[1fr_110px] gap-3">
              <Field label="Art style">
                <Select value={look} onChange={(e) => setLook(e.target.value)}>
                  <option value="">{mode === "edit" ? "Keep the picture's style" : "Any (from the description)"}</option>
                  {data?.lookGroups.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.looks.map((l) => <option key={l} value={l}>{l.split(",")[0]}</option>)}
                    </optgroup>
                  ))}
                </Select>
              </Field>
              <Field label="Shape">
                <Select value={aspect} onChange={(e) => setAspect(e.target.value as typeof aspect)}>
                  <option value="9:16">9:16</option>
                  <option value="16:9">16:9</option>
                  <option value="1:1">1:1</option>
                </Select>
              </Field>
            </div>
            </>
            )}
            <Button variant="primary" size="lg" loading={busy} disabled={busy || (mode !== "tools" && !prompt.trim()) || !ready || !engineOk} onClick={make}>
              <ImagePlus className="h-4 w-4" /> {busy ? "Working on it…" : `${mode === "tools" ? t.name : "Make it"} · ${cost} credit${cost === 1 ? "" : "s"}`}
            </Button>
            <p className="-mt-1 text-[11px] text-white/40">The first picture after the engine starts loads the picture model, which takes a few minutes. After that each picture takes under a minute.</p>
          </div>
        </Card>

        <div className="min-w-0">
          {latest && (
            <Card className="mb-6 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={latest.url} alt={latest.name} className="mx-auto max-h-[70vh] w-auto bg-[conic-gradient(#ffffff14_25%,transparent_0_50%,#ffffff14_0_75%,transparent_0)] bg-[length:20px_20px]" />
              <div className="flex justify-end p-3">
                <a href={latest.url} download={latest.name}>
                  <Button size="sm"><Download className="h-3.5 w-3.5" /> Download</Button>
                </a>
              </div>
            </Card>
          )}
          {data?.made.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {data.made.map((p) => (
                <button key={p.id} onClick={() => setLatest(p)} className="focus-ring overflow-hidden rounded-xl ring-1 ring-white/10 hover:ring-mint-400/50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.name} className="aspect-[9/16] w-full object-cover" />
                </button>
              ))}
            </div>
          ) : (
            !latest && (
              <Card>
                <Empty icon={<Palette className="h-6 w-6" />} title="No pictures yet" body="Describe a picture on the left. Pictures you make here also work as scenes in Movie Studio, Film Engine and your posts." />
              </Card>
            )
          )}
        </div>
      </div>
    </>
  );
}
