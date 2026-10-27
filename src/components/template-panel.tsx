"use client";
import { useState } from "react";
import { Clapperboard, Download } from "lucide-react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/client";
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { TEMPLATE_DEFS, type TemplateDef } from "@/lib/template-defs";
import { useMedia } from "@/components/voice-tools";

/** Video templates: fill in the words and colors, render free on the server. */
export function TemplatePanel() {
  const { toast } = useApp();
  const { items } = useMedia();
  const [def, setDef] = useState<TemplateDef>(TEMPLATE_DEFS[0]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [aspect, setAspect] = useState("9:16");
  const [accent, setAccent] = useState("#36e2b4");
  const [textColor, setTextColor] = useState("#ffffff");
  const [bg, setBg] = useState<"color" | "media" | "transparent">("color");
  const [bgColor, setBgColor] = useState("#0b0b10");
  const [bgMedia, setBgMedia] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ name: string; url: string; type: string } | null>(null);
  const visuals = items.filter((m) => m.kind === "image" || m.kind === "video");

  function pick(d: TemplateDef) {
    setDef(d);
    setValues({});
    setBg(d.overlay ? "transparent" : "color");
  }
  async function render() {
    setBusy(true);
    try {
      const background = bg === "transparent" ? { type: "transparent" } : bg === "media" ? { type: "media", mediaId: bgMedia } : { type: "color", color: bgColor };
      setOut(await api<{ name: string; url: string; type: string }>("/api/templates", { body: { template: def.id, values, aspect, accent, textColor, background } }));
      toast("Rendered and saved to your Media Library", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader title="Video templates" subtitle="Titles, lower thirds, end screens and more, with your words and colors. Free: drawn on Ghost Post's server." icon={<Clapperboard className="h-4 w-4" />} />
        <div className="grid grid-cols-1 gap-4 p-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TEMPLATE_DEFS.map((d) => (
              <button key={d.id} onClick={() => pick(d)} className={cn("rounded-xl border px-3 py-2.5 text-left", def.id === d.id ? "border-mint-400 bg-mint-400/10" : "border-white/10 hover:border-white/25")}>
                <div className="text-sm font-medium">{d.name}</div>
                <div className="text-xs text-white/50">{d.blurb}</div>
              </button>
            ))}
          </div>
          {def.fields.map((f) => (
            <Field key={f.key} label={f.label}>
              {f.long ? (
                <Textarea rows={3} maxLength={f.max} value={values[f.key] ?? ""} placeholder={f.example} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
              ) : (
                <Input maxLength={f.max} value={values[f.key] ?? ""} placeholder={f.example} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
              )}
            </Field>
          ))}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="Shape">
              <Select value={aspect} onChange={(e) => setAspect(e.target.value)}>
                <option value="9:16">9:16</option><option value="16:9">16:9</option><option value="1:1">1:1</option>
              </Select>
            </Field>
            <Field label="Accent"><input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-10 w-full cursor-pointer rounded-lg bg-transparent" /></Field>
            <Field label="Text"><input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="h-10 w-full cursor-pointer rounded-lg bg-transparent" /></Field>
            <Field label="Background">
              <Select value={bg} onChange={(e) => setBg(e.target.value as typeof bg)}>
                <option value="color">A color</option>
                <option value="media">My picture or video</option>
                <option value="transparent">See-through (overlay .mov)</option>
              </Select>
            </Field>
          </div>
          {bg === "color" && <Field label="Background color"><input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="h-10 w-28 cursor-pointer rounded-lg bg-transparent" /></Field>}
          {bg === "media" && (
            <Select value={bgMedia} onChange={(e) => setBgMedia(e.target.value)}>
              <option value="">{visuals.length ? "Choose…" : "Upload a picture or video first"}</option>
              {visuals.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          )}
          {bg === "transparent" && <p className="text-xs text-white/50">A ProRes 4444 .mov with a see-through background, to lay over your footage in Premiere Pro, DaVinci Resolve, Final Cut Pro or CapCut.</p>}
          <Button variant="primary" size="lg" onClick={render} loading={busy} disabled={bg === "media" && !bgMedia}>Render · free</Button>
        </div>
      </Card>
      <Card className="h-fit">
        <CardHeader title="Result" />
        <div className="grid grid-cols-1 gap-3 p-4">
          {!out && <div className="text-sm text-white/50">Your render plays here and is saved to the Media Library.</div>}
          {out && (
            <>
              {out.type === "video/mp4" ? <video src={out.url} controls autoPlay loop muted playsInline className="w-full rounded-lg bg-black" /> : <div className="rounded-lg bg-white/5 p-4 text-sm text-white/70">Overlays with a see-through background don&apos;t preview in browsers; download it and drop it on your timeline.</div>}
              <a href={`${out.url}&dl=${out.name}`}><Button className="w-full"><Download className="h-4 w-4" /> Download</Button></a>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
