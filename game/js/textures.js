// Procedural canvas textures: facades, roads, grass, signs, billboards.
import * as THREE from 'three';
import { mulberry32 } from './util.js';

let maxAniso = 4;
export function setAnisotropy(n) { maxAniso = n; }

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTex(c, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  return t;
}

function noise(ctx, w, h, amount, rng, alpha = 0.08) {
  for (let i = 0; i < amount; i++) {
    const v = Math.floor(rng() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
  }
}

// ---- Building facades -------------------------------------------------------
// Each style returns { map, emissiveMap, tileW, tileH } where tile sizes are metres
// covered by one repeat of the texture. The bottom-left corner of every texture
// is solid "frame" colour so roofs (which sample uv≈0) look plain.
export const FACADE_STYLES = {};

function facade(name, opts) {
  const S = 256;
  const rng = mulberry32(name.length * 997 + 13);
  const [c, g] = canvas(S, S);
  const [ce, ge] = canvas(S, S);
  g.fillStyle = opts.frame; g.fillRect(0, 0, S, S);
  noise(g, S, S, 1200, rng, 0.05);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
  const cw = S / opts.cols, ch = S / opts.rows;
  for (let r = 0; r < opts.rows; r++) {
    for (let col = 0; col < opts.cols; col++) {
      const x = col * cw + opts.padX, y = r * ch + opts.padY;
      const w = cw - opts.padX * 2, h = ch - opts.padY * 2;
      const grad = g.createLinearGradient(x, y, x + w, y + h);
      grad.addColorStop(0, opts.glassA);
      grad.addColorStop(1, opts.glassB);
      g.fillStyle = grad;
      if (opts.arch) {
        g.beginPath();
        g.moveTo(x, y + h);
        g.lineTo(x, y + w / 2);
        g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
        g.lineTo(x + w, y + h);
        g.closePath();
        g.fill();
      } else {
        g.fillRect(x, y, w, h);
      }
      if (opts.shutters) {
        g.fillStyle = opts.shutters;
        g.fillRect(x - 5, y, 4, h);
        g.fillRect(x + w + 1, y, 4, h);
      }
      if (opts.sill) {
        g.fillStyle = opts.sill;
        g.fillRect(x - 2, y + h, w + 4, 3);
      }
      // lit windows at night
      if (rng() < opts.lit) {
        const warm = rng();
        ge.fillStyle = warm < 0.6 ? '#ffd890' : warm < 0.85 ? '#fff4d6' : '#9fd4ff';
        ge.fillRect(x, y, w, h);
      }
    }
  }
  if (opts.bands) {
    g.fillStyle = opts.bands;
    for (let r = 0; r < opts.rows; r++) g.fillRect(0, r * ch, S, 3);
  }
  // keep bottom-left corner as frame for roofs
  g.fillStyle = opts.roof || opts.frame; g.fillRect(0, S - 6, 6, 6);
  ge.fillStyle = '#000'; ge.fillRect(0, S - 6, 6, 6);
  const map = toTex(c);
  const emissiveMap = toTex(ce);
  FACADE_STYLES[name] = { map, emissiveMap, tileW: opts.tileW, tileH: opts.tileH };
}

export function buildFacades() {
  facade('glass', { frame: '#9fb0c0', glassA: '#2d4a66', glassB: '#7fa6c8', cols: 8, rows: 16, padX: 1, padY: 1, lit: 0.35, tileW: 16, tileH: 32, bands: '#b8c4cf', roof: '#6d747c' });
  facade('office', { frame: '#cfc8bb', glassA: '#1d2833', glassB: '#44586b', cols: 6, rows: 10, padX: 5, padY: 5, lit: 0.4, tileW: 18, tileH: 30, sill: '#e6e0d4', roof: '#7c7870' });
  facade('brick', { frame: '#8a4a36', glassA: '#1f2a33', glassB: '#3d5566', cols: 4, rows: 6, padX: 14, padY: 10, lit: 0.45, tileW: 12, tileH: 18, arch: true, sill: '#d8cbb5', roof: '#57463e' });
  facade('pastel', { frame: '#f2efe8', glassA: '#233', glassB: '#465a5f', cols: 3, rows: 4, padX: 20, padY: 8, lit: 0.55, tileW: 12, tileH: 14, shutters: '#2f5b3a', roof: '#8a8580' });
  facade('res', { frame: '#e0d4bd', glassA: '#26313a', glassB: '#51626e', cols: 4, rows: 5, padX: 12, padY: 11, lit: 0.5, tileW: 14, tileH: 16, sill: '#fff', roof: '#6a5f55' });
  facade('dark', { frame: '#2a2d33', glassA: '#101820', glassB: '#304860', cols: 10, rows: 20, padX: 1, padY: 2, lit: 0.3, tileW: 16, tileH: 32, roof: '#222' });
}

// ---- Ground ----------------------------------------------------------------
export function grassTexture() {
  const S = 256, rng = mulberry32(7);
  const [c, g] = canvas(S, S);
  g.fillStyle = '#4d6b2f'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 6000; i++) {
    const v = rng();
    g.fillStyle = v < 0.33 ? '#5a7a36' : v < 0.66 ? '#415c27' : '#6b8a3f';
    g.fillRect(rng() * S, rng() * S, 2, 2);
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = 'rgba(120,100,60,0.15)';
    g.beginPath(); g.arc(rng() * S, rng() * S, 6 + rng() * 14, 0, Math.PI * 2); g.fill();
  }
  return toTex(c);
}

export function concreteTexture() {
  const S = 128, rng = mulberry32(11);
  const [c, g] = canvas(S, S);
  g.fillStyle = '#9a9894'; g.fillRect(0, 0, S, S);
  noise(g, S, S, 1500, rng, 0.08);
  g.strokeStyle = 'rgba(60,60,60,0.35)'; g.lineWidth = 1;
  for (let i = 0; i <= S; i += 32) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke();
  }
  return toTex(c);
}

// City road tile: 100m x 100m, road centrelines along u=0 and v=0 edges.
export function cityRoadTexture() {
  const S = 512, rng = mulberry32(3);
  const [c, g] = canvas(S, S);
  g.fillStyle = '#34363a'; g.fillRect(0, 0, S, S);
  noise(g, S, S, 9000, rng, 0.07);
  const m = S / 100; // px per metre
  const hw = 9 * m; // half road width
  // double yellow centre lines (wrap around tile edge)
  g.fillStyle = '#e8c33a';
  for (const off of [0.25, -0.55]) {
    const p = off * m;
    // vertical (along v) at u=0
    for (let y = hw + 4; y < S - hw - 4; y += 1) {
      g.fillRect((p + S) % S, y, 2, 1);
    }
    for (let x = hw + 4; x < S - hw - 4; x += 1) {
      g.fillRect(x, (p + S) % S, 1, 2);
    }
  }
  // white lane edge lines
  g.fillStyle = 'rgba(235,235,235,0.9)';
  for (const e of [hw - 1.5 * m, S - hw + 1.5 * m - 2]) {
    g.fillRect(e, hw + 6, 2, S - 2 * hw - 12);
    g.fillRect(hw + 6, e, S - 2 * hw - 12, 2);
  }
  // crosswalks near each corner-intersection
  g.fillStyle = 'rgba(240,240,240,0.85)';
  const cw = (x, y, w, h) => g.fillRect(x, y, w, h);
  for (let i = -hw + 4; i < hw - 4; i += 6) {
    const a = (i + S) % S;
    // four crosswalks per intersection (drawn at each tile corner)
    cw(a, hw + 2, 3, 14); cw(a, S - hw - 16, 3, 14);
    cw(hw + 2, a, 14, 3); cw(S - hw - 16, a, 14, 3);
  }
  return toTex(c);
}

// Highway: tile is full road width (30m) across u, 20m along v.
export function highwayTexture() {
  const W = 256, H = 170, rng = mulberry32(5);
  const [c, g] = canvas(W, H);
  g.fillStyle = '#3a3b3e'; g.fillRect(0, 0, W, H);
  noise(g, W, H, 5000, rng, 0.08);
  const m = W / 30;
  g.fillStyle = '#e8c33a';
  g.fillRect(1.2 * m, 0, 2, H); g.fillRect(W - 1.2 * m - 2, 0, 2, H);
  g.fillRect(W / 2 - 4, 0, 2, H); g.fillRect(W / 2 + 2, 0, 2, H);
  g.fillStyle = '#eee';
  for (const u of [7.5, 22.5]) {
    g.fillRect(u * m - 1, 0, 2, H * 0.45);
  }
  return toTex(c);
}

export function waterTexture() {
  const S = 256, rng = mulberry32(21);
  const [c, g] = canvas(S, S);
  g.fillStyle = '#2d5870'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 400; i++) {
    g.strokeStyle = `rgba(${170 + rng() * 60},${200 + rng() * 55},255,${0.08 + rng() * 0.15})`;
    g.lineWidth = 1 + rng() * 2;
    const x = rng() * S, y = rng() * S, l = 6 + rng() * 20;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y - 3, x + l, y); g.stroke();
  }
  return toTex(c);
}

// ---- Signs & billboards ----------------------------------------------------
export function textTexture(lines, opts = {}) {
  const W = opts.w || 512, H = opts.h || 256;
  const [c, g] = canvas(W, H);
  const bg = opts.bg || '#111';
  if (Array.isArray(bg)) {
    const grad = g.createLinearGradient(0, 0, W, H);
    bg.forEach((col, i) => grad.addColorStop(i / (bg.length - 1), col));
    g.fillStyle = grad;
  } else g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  if (opts.border) {
    g.strokeStyle = opts.border; g.lineWidth = 10; g.strokeRect(5, 5, W - 10, H - 10);
  }
  const total = lines.reduce((s, l) => s + (l.size || 48) * 1.15, 0);
  let y = (H - total) / 2;
  for (const l of lines) {
    const size = l.size || 48;
    g.font = `${l.italic ? 'italic ' : ''}${l.weight || 800} ${size}px ${l.font || 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif'}`;
    g.textAlign = 'center'; g.textBaseline = 'top';
    if (l.glow) { g.shadowColor = l.glow; g.shadowBlur = 18; } else g.shadowBlur = 0;
    if (l.stroke) { g.strokeStyle = l.stroke; g.lineWidth = 6; g.strokeText(l.text, W / 2, y); }
    g.fillStyle = l.color || '#fff';
    g.fillText(l.text, W / 2, y);
    y += size * 1.15;
  }
  return toTex(c, true, false);
}

export function crossTexture(color = '#e22') {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = color; g.fillRect(48, 16, 32, 96); g.fillRect(16, 48, 96, 32);
  return toTex(c, true, false);
}

export function helipadTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#3a3d42'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#f2c230'; g.lineWidth = 10;
  g.beginPath(); g.arc(128, 128, 105, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#fff'; g.font = '900 150px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('H', 128, 136);
  return toTex(c, true, false);
}

export function parkTexture() {
  const S = 256, rng = mulberry32(99);
  const [c, g] = canvas(S, S);
  g.fillStyle = '#4f7d33'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = rng() < 0.5 ? '#5c8c3b' : '#46702c';
    g.fillRect(rng() * S, rng() * S, 2, 2);
  }
  g.strokeStyle = '#c9b996'; g.lineWidth = 10;
  g.beginPath(); g.moveTo(0, S / 2); g.lineTo(S, S / 2); g.moveTo(S / 2, 0); g.lineTo(S / 2, S); g.stroke();
  g.beginPath(); g.arc(S / 2, S / 2, 50, 0, Math.PI * 2); g.stroke();
  return toTex(c, true, false);
}

export function parkingTexture() {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#2f3134'; g.fillRect(0, 0, S, S);
  noise(g, S, S, 3000, mulberry32(4), 0.08);
  g.fillStyle = '#ddd';
  for (let row = 0; row < 3; row++) {
    const y0 = 20 + row * 80;
    for (let x = 10; x < S - 10; x += 20) g.fillRect(x, y0, 2, 40);
  }
  return toTex(c, true, false);
}

export function neonTexture(text, color) {
  return textTexture([{ text, size: 90, color: '#fff', glow: color, font: '"Brush Script MT", cursive', weight: 700 }], { w: 512, h: 160, bg: '#0a0a0f' });
}
