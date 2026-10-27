"use client";
import { useEffect, useRef, useState } from "react";
import { Download, ImageUp } from "lucide-react";
import { api } from "@/lib/client";
import { Button, Card, Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import { GRADES, gradePixel, type Grade } from "@/lib/luts";

type Pic = { id: string; name: string; url: string };

/** A stand-in picture when the person has none: sky, skin tones, foliage and shadow in one frame. */
function sample(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d")!;
  const sky = x.createLinearGradient(0, 0, 0, h * 0.6);
  sky.addColorStop(0, "#3b6fb6");
  sky.addColorStop(1, "#f2b679");
  x.fillStyle = sky;
  x.fillRect(0, 0, w, h);
  x.fillStyle = "#2f5d34";
  x.fillRect(0, h * 0.6, w, h * 0.4);
  [["#8d5524", 0.2], ["#c68642", 0.4], ["#e0ac69", 0.6], ["#f1c27d", 0.8]].forEach(([col, f]) => {
    x.fillStyle = col as string;
    x.beginPath();
    x.arc(w * (f as number), h * 0.72, w * 0.08, 0, Math.PI * 2);
    x.fill();
  });
  x.fillStyle = "#111";
  x.fillRect(0, h * 0.9, w, h * 0.1);
  return c;
}

function graded(src: HTMLCanvasElement | HTMLImageElement, g: Grade | null, w: number) {
  const sw = src instanceof HTMLImageElement ? src.naturalWidth : src.width;
  const sh = src instanceof HTMLImageElement ? src.naturalHeight : src.height;
  const h = Math.round((w * sh) / sw);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d")!;
  x.drawImage(src, 0, 0, w, h);
  if (g) {
    const d = x.getImageData(0, 0, w, h);
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const o = gradePixel(g, [p[i] / 255, p[i + 1] / 255, p[i + 2] / 255]);
      p[i] = o[0] * 255;
      p[i + 1] = o[1] * 255;
      p[i + 2] = o[2] * 255;
    }
    x.putImageData(d, 0, 0);
  }
  return c.toDataURL("image/jpeg", 0.85);
}

/** The Library's LUTs: every grade previewed live on one of your pictures, then downloaded as a .cube. */
export function LutGallery({ canDownload }: { canDownload: boolean }) {
  const [pics, setPics] = useState<Pic[]>([]);
  const [src, setSrc] = useState<string>("");
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [pick, setPick] = useState<Grade>(GRADES[0]);
  const [big, setBig] = useState<{ before: string; after: string } | null>(null);
  const [split, setSplit] = useState(50);
  const img = useRef<HTMLImageElement | HTMLCanvasElement | null>(null);
  const [group, setGroup] = useState("");

  useEffect(() => {
    api<{ pictures: Pic[] }>("/api/images").then((d) => setPics(d.pictures)).catch(() => {});
  }, []);
  useEffect(() => {
    let off = false;
    const run = (el: HTMLImageElement | HTMLCanvasElement) => {
      img.current = el;
      const t: Record<string, string> = {};
      for (const g of GRADES) t[g.id] = graded(el, g, 220);
      if (!off) setThumbs(t);
    };
    if (!src) run(sample(540, 960));
    else {
      const el = new Image();
      el.onload = () => run(el);
      el.src = src;
    }
    return () => {
      off = true;
    };
  }, [src]);
  useEffect(() => {
    if (img.current && thumbs[pick.id]) setBig({ before: graded(img.current, null, 900), after: graded(img.current, pick, 900) });
  }, [pick, thumbs]);

  const shown = GRADES.filter((g) => !group || g.group === group);
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select className="w-auto" value={src} onChange={(e) => setSrc(e.target.value)}>
            <option value="">Sample picture</option>
            {pics.slice(0, 40).map((p) => <option key={p.id} value={p.url}>{p.name}</option>)}
          </Select>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-white/80 hover:bg-white/5">
            <ImageUp className="h-4 w-4" /> Try on a photo
            <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setSrc(URL.createObjectURL(f)); }} />
          </label>
          <Select className="w-auto" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">All grades</option>
            {[...new Set(GRADES.map((g) => g.group))].map((g) => <option key={g}>{g}</option>)}
          </Select>
          <span className="text-xs text-white/40">Your photo stays in your browser.</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((g) => (
            <button key={g.id} onClick={() => setPick(g)} className={cn("overflow-hidden rounded-xl border text-left transition", pick.id === g.id ? "border-mint-400" : "border-white/10 hover:border-white/30")}>
              {thumbs[g.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbs[g.id]} alt={g.name} className="aspect-[4/5] w-full object-cover" />
              ) : (
                <div className="aspect-[4/5] w-full animate-pulse bg-white/5" />
              )}
              <div className="p-2.5">
                <div className="text-sm font-medium">{g.name}</div>
                <div className="truncate text-xs text-white/50">{g.blurb}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <Card className="h-fit overflow-hidden xl:sticky xl:top-10">
        {big && (
          <div className="relative select-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={big.before} alt="Before" className="w-full" />
            <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={big.after} alt={`With ${pick.name}`} className="w-full" />
            </div>
            <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/80" style={{ left: `${split}%` }} />
            <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs">Before</span>
            <span className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs">{pick.name}</span>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 p-4">
          <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} className="w-full accent-mint-400" aria-label="Before and after" />
          <div>
            <div className="font-semibold">{pick.name}</div>
            <div className="text-sm text-white/60">{pick.blurb}. A 33-point .cube for Premiere Pro, DaVinci Resolve, Final Cut Pro and CapCut, made for Rec.709 footage.</div>
          </div>
          {canDownload ? (
            <a href={`/api/library/lut?id=${pick.id}`}><Button variant="primary" className="w-full"><Download className="h-4 w-4" /> Download .cube</Button></a>
          ) : (
            <div className="text-sm text-white/60">Preview every grade free. <a className="text-mint-300 underline" href="/plans">Upgrade</a> to download the .cube files.</div>
          )}
        </div>
      </Card>
    </div>
  );
}
