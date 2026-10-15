// Renders the newest batch's carousel posts into designed 1080x1350 slides (JPG, plus a PDF for LinkedIn).
// Setup once per run:  npm --prefix tools install --no-audit --no-fund
// Run:                 node tools/render-slides.mjs            (writes media/<item id>/slide-N.jpg)
// A carousel item may carry an optional "slideDesign" object to control the look; otherwise slides are
// built from hook + parts. See BRIEF.md "Carousel slides".
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url).pathname;
const inbox = JSON.parse(readFileSync(`${root}inbox.json`, "utf8"));
const batch = inbox.batches[0];
const PALETTES = [
  { accent: "#E8B04B", glow: "rgba(232,176,75,.22)", glow2: "rgba(28,210,139,.10)" },
  { accent: "#1CD28B", accent2: "#8CF9CB", glow: "rgba(28,210,139,.20)", glow2: "rgba(232,71,90,.10)" },
  { accent: "#E8475A", glow: "rgba(232,71,90,.22)", glow2: "rgba(28,210,139,.08)" },
  { accent: "#7C9CFF", glow: "rgba(124,156,255,.22)", glow2: "rgba(28,210,139,.08)" },
];
const PILLAR_TAG = { wealth_systems: "Money", ai_leverage: "AI at work", high_agency: "Mindset", relationships: "Relationships", longevity: "Health" };
function deckFor(it, n) {
  const d = it.slideDesign ?? {};
  const pal = PALETTES[n % PALETTES.length];
  const slides = d.slides ?? [
    { big: true, size: it.hook.length > 70 ? 96 : 112, title: it.hook },
    ...it.parts.map((p) => ({ title: p, size: p.length > 120 ? 58 : p.length > 70 ? 66 : 80 })),
  ];
  return {
    tag: d.tag ?? PILLAR_TAG[it.pillar] ?? "Nexus Pulse",
    handle: d.handle ?? (it.platform === "linkedin" ? "Nexus Pulse" : "@bino_da_producer"),
    lastCta: d.lastCta ?? (it.platform === "linkedin" ? "Share with your team ↓" : "Save this ↓"),
    pdf: it.platform === "linkedin" ? "slides.pdf" : undefined,
    ...pal, ...d, slides,
  };
}
let deck;
const fontDir = new URL("./node_modules/@fontsource/", import.meta.url).pathname;
const font = (fam, file) => `url("data:font/woff2;base64,${readFileSync(`${fontDir}${fam}/files/${file}`).toString("base64")}") format("woff2")`;

let A, A2;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
// **text** → accent highlight
const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<span class="hl">$1</span>').replace(/\n/g, "<br>");

function chart(v) {
  // v: {points:[[label,value]], show: n, markers:[{i,label,color}], note}
  const W = 888, H = 430, pad = 50;
  const max = Math.max(...v.points.map((p) => p[1])) * 1.1;
  const xs = (i) => pad + (i * (W - pad * 2)) / (v.points.length - 1);
  const ys = (val) => H - pad - (val / max) * (H - pad * 2);
  const shown = v.points.slice(0, v.show ?? v.points.length);
  const path = shown.map((p, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(p[1]).toFixed(1)}`).join(" ");
  const area = shown.length > 1 ? `${path} L${xs(shown.length - 1)},${H - pad} L${xs(0)},${H - pad} Z` : "";
  const ghost = v.points.map((p, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(p[1]).toFixed(1)}`).join(" ");
  const labels = v.points.map((p, i) => `<text x="${xs(i)}" y="${H - 12}" class="ax" text-anchor="middle">${esc(p[0])}</text>`).join("");
  const last = shown[shown.length - 1];
  const dot = last ? `<circle cx="${xs(shown.length - 1)}" cy="${ys(last[1])}" r="12" fill="${A}"/><circle cx="${xs(shown.length - 1)}" cy="${ys(last[1])}" r="26" fill="${A}" opacity=".18"/>` : "";
  const val = last && v.valueLabel !== false ? `<text x="${Math.min(xs(shown.length - 1) + 22, W - 10)}" y="${ys(last[1]) - 22}" class="val" text-anchor="${shown.length - 1 > v.points.length * 0.6 ? "end" : "start"}">${esc(v.fmt ? v.fmt.replace("{v}", last[1].toLocaleString("en-GB")) : last[1])}</text>` : "";
  const marks = (v.markers ?? []).map((m) => `<g><line x1="${xs(m.i)}" x2="${xs(m.i)}" y1="${pad - 10}" y2="${H - pad}" stroke="${m.color ?? A2}" stroke-width="3" stroke-dasharray="8 8"/><rect x="${xs(m.i) - 80}" y="${pad - 46}" width="160" height="40" rx="20" fill="${m.color ?? A2}"/><text x="${xs(m.i)}" y="${pad - 19}" text-anchor="middle" class="mk">${esc(m.label)}</text></g>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="chart">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${A}" stop-opacity=".45"/><stop offset="1" stop-color="${A}" stop-opacity="0"/></linearGradient></defs>
    ${[0.25, 0.5, 0.75].map((f) => `<line x1="${pad}" x2="${W - pad}" y1="${pad + f * (H - pad * 2)}" y2="${pad + f * (H - pad * 2)}" stroke="#ffffff" stroke-opacity=".07"/>`).join("")}
    <path d="${ghost}" fill="none" stroke="#ffffff" stroke-opacity=".12" stroke-width="5" stroke-dasharray="2 12" stroke-linecap="round"/>
    ${area ? `<path d="${area}" fill="url(#g)"/>` : ""}
    <path d="${path}" fill="none" stroke="${A}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    ${marks}${dot}${val}${labels}
  </svg>${v.note ? `<div class="note">${esc(v.note)}</div>` : ""}`;
}

function visual(s) {
  if (!s.visual) return "";
  const v = s.visual;
  if (v.type === "chart") return chart(v);
  if (v.type === "stat") return `<div class="stat">${esc(v.value)}</div>${v.label ? `<div class="statl">${esc(v.label)}</div>` : ""}`;
  if (v.type === "icons") return `<div class="icons">${v.items.map((t) => `<div class="ic"><span>${esc(t[0])}</span><b>${esc(t[1])}</b></div>`).join("")}</div>`;
  if (v.type === "checklist") return `<div class="checks">${v.items.map((t, i) => `<div class="ck"><i>${i + 1}</i><span>${rich(t)}</span></div>`).join("")}</div>`;
  if (v.type === "timeline") return `<div class="tl">${v.items.map((t) => `<div class="tli ${t[2] ?? ""}"><b>${esc(t[0])}</b><span>${esc(t[1])}</span></div>`).join("")}</div>`;
  if (v.type === "strike") return `<div class="strike">“${esc(v.text)}”</div>`;
  if (v.type === "split") return `<div class="split"><div><small>${esc(v.l[0])}</small><b>${esc(v.l[1])}</b></div><div class="r"><small>${esc(v.r[0])}</small><b>${esc(v.r[1])}</b></div></div>`;
  return "";
}

const cssFor = () => `
@font-face{font-family:PF;font-weight:800;src:${font("playfair-display", "playfair-display-latin-800-normal.woff2")}}
@font-face{font-family:PF;font-weight:900;src:${font("playfair-display", "playfair-display-latin-900-normal.woff2")}}
@font-face{font-family:IN;font-weight:400;src:${font("inter", "inter-latin-400-normal.woff2")}}
@font-face{font-family:IN;font-weight:600;src:${font("inter", "inter-latin-600-normal.woff2")}}
@font-face{font-family:IN;font-weight:800;src:${font("inter", "inter-latin-800-normal.woff2")}}
*{margin:0;box-sizing:border-box}
html,body{width:1080px;height:1350px;background:#0d0e12}
.s{position:relative;width:1080px;height:1350px;overflow:hidden;padding:96px;color:#f4efe6;font-family:IN;display:flex;flex-direction:column}
.bg{position:absolute;inset:0;z-index:0}
.grain{position:absolute;inset:0;z-index:1;opacity:.09;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='200' height='200' filter='url(%23n)'/></svg>")}
.top,.body,.foot{position:relative;z-index:2}
.top{display:flex;justify-content:space-between;align-items:flex-start;font-weight:600;font-size:27px;letter-spacing:.06em}
.tag{color:${A};text-transform:uppercase;padding-bottom:10px;border-bottom:4px solid ${A}}
.num{color:#a9a39a}
.body{flex:1;display:flex;flex-direction:column;justify-content:center;gap:40px}
h1{font-family:PF;font-weight:900;font-size:var(--h,104px);line-height:1.04;letter-spacing:-.01em}
h2{font-family:PF;font-weight:800;font-size:var(--h,76px);line-height:1.1}
.hl{color:${A}}
p.sub{font-size:38px;line-height:1.45;color:#cfc8bd;border-left:6px solid ${A2};padding-left:30px}
.foot{display:flex;justify-content:space-between;font-size:30px;color:#a9a39a}
.foot b{color:#fff;font-weight:600}
.chart{display:block;margin-top:6px}
.chart .ax{fill:#a9a39a;font:600 24px IN}
.chart .val{fill:#fff;font:800 40px IN}
.chart .mk{fill:#0d0e12;font:800 21px IN;letter-spacing:.05em}
.note{font-size:22px;color:#8d877e;margin-top:-18px}
.stat{font-family:PF;font-weight:900;font-size:190px;line-height:1;color:${A};letter-spacing:-.02em}
.statl{font-size:34px;color:#cfc8bd;margin-top:-10px}
.icons{display:grid;grid-template-columns:1fr 1fr 1fr;gap:22px}
.ic{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:28px;padding:30px 26px;display:flex;flex-direction:column;gap:14px}
.ic span{font-size:64px}
.ic b{font-size:27px;font-weight:600;color:#e9e3d8;line-height:1.3}
.checks{display:flex;flex-direction:column;gap:22px}
.ck{display:flex;gap:26px;align-items:center;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:26px;padding:28px 32px;font-size:36px;line-height:1.3}
.ck i{font-style:normal;flex:none;width:64px;height:64px;border-radius:50%;background:${A};color:#0d0e12;font-weight:800;display:grid;place-items:center;font-size:32px}
.tl{display:flex;flex-direction:column;gap:0;border-left:4px solid rgba(255,255,255,.15);margin-left:12px}
.tli{position:relative;padding:14px 0 14px 46px;display:flex;gap:30px;align-items:baseline}
.tli:before{content:"";position:absolute;left:-14px;top:30px;width:24px;height:24px;border-radius:50%;background:#55504a}
.tli.on:before{background:${A};box-shadow:0 0 0 10px ${A}33}
.tli b{font:800 40px IN;color:#fff;width:150px}
.tli span{font-size:34px;color:#cfc8bd}
.tli.on span{color:${A};font-weight:600}
.strike{font-family:PF;font-weight:800;font-size:58px;line-height:1.2;color:#8d877e;text-decoration:line-through;text-decoration-color:${A};text-decoration-thickness:6px}
.split{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.split div{border-radius:28px;padding:34px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1)}
.split .r{background:${A}22;border-color:${A}}
.split small{display:block;font-size:24px;letter-spacing:.08em;text-transform:uppercase;color:#a9a39a;margin-bottom:14px}
.split b{font:800 44px IN;line-height:1.2}
`;

function slide(s, i, n) {
  const glow = s.glow ?? (i % 2 ? "88% 18%" : "12% 10%");
  const bg = `<div class="bg" style="background:radial-gradient(circle at ${glow}, ${deck.glow} 0, transparent 55%), radial-gradient(circle at 80% 100%, ${deck.glow2 ?? "transparent"} 0, transparent 50%), #0d0e12"></div><div class="grain"></div>`;
  const head = s.big ? `<h1 style="--h:${s.size ?? 104}px">${rich(s.title)}</h1>` : `<h2 style="--h:${s.size ?? 76}px">${rich(s.title)}</h2>`;
  return `<div class="s">${bg}
  <div class="top"><span class="tag">${esc(s.tag ?? deck.tag)}</span><span class="num">${i + 1}/${n}</span></div>
  <div class="body">${s.visualFirst ? visual(s) + head : head + visual(s)}${s.sub ? `<p class="sub">${rich(s.sub)}</p>` : ""}</div>
  <div class="foot"><span>${esc(deck.handle)}</span><b>${i === n - 1 ? esc(deck.lastCta ?? "Save this ↓") : "Swipe →"}</b></div></div>`;
}

const exe = existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
const carousels = [...batch.items, ...(batch.bank ?? [])].filter((it) => it.type === "post" && it.format === "carousel");
for (const [k, it] of carousels.entries()) {
  deck = deckFor(it, k);
  A = deck.accent; A2 = deck.accent2 ?? deck.accent;
  const css = cssFor();
  const outDir = `${root}media/${it.id}`;
  mkdirSync(outDir, { recursive: true });
  const n = deck.slides.length;
  const all = [];
  for (const [i, s] of deck.slides.entries()) {
    all.push(slide(s, i, n));
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${slide(s, i, n)}</body></html>`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${outDir}/slide-${i + 1}.jpg`, type: "jpeg", quality: 92 });
  }
  if (deck.pdf) {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css} .s{page-break-after:always}</style></head><body>${all.join("")}</body></html>`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: `${outDir}/${deck.pdf}`, width: "1080px", height: "1350px", printBackground: true });
  }
  writeFileSync(`${outDir}/alt.json`, JSON.stringify(deck.slides.map((s) => s.alt ?? s.title.replace(/\*\*/g, "")), null, 1) + "\n");
  console.log(`${it.id}: ${n} slides → media/${it.id}/`);
}
await browser.close();
