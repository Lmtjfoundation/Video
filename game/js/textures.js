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

let texScale = 1;
export function setTextureScale(k) { texScale = k; }

// Tangent-space normal map from a greyscale height canvas (wraps at the edges).
function normalFromHeight(src, strength = 2) {
  const w = src.width, h = src.height;
  const d = src.getContext('2d').getImageData(0, 0, w, h).data;
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h), o = img.data;
  const H = (x, y) => d[((((y + h) % h) * w) + ((x + w) % w)) * 4];
  const k = strength / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * k;
      const dy = (H(x, y - 1) - H(x, y + 1)) * k; // canvas y runs opposite to texture v
      const l = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * w + x) * 4;
      o[i] = (-dx * l * 0.5 + 0.5) * 255;
      o[i + 1] = (-dy * l * 0.5 + 0.5) * 255;
      o[i + 2] = (l * 0.5 + 0.5) * 255;
      o[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return toTex(c, false);
}

// roughness (green) / metalness (blue) pair for MeshStandardMaterial
function rm(r, m = 0) { return `rgb(0,${Math.round(r * 255)},${Math.round(m * 255)})`; }

// attaches PBR maps to a colour texture so materials can pick them up
function withPbr(map, heightCanvas, strength, roughCanvas) {
  map.userData.normalMap = normalFromHeight(heightCanvas, strength);
  if (roughCanvas) map.userData.roughMap = toTex(roughCanvas, false);
  return map;
}

// sprinkles matching blotches on the colour / height / roughness layers
function speckle(layers, S, n, rng, size, col, hgt, rough) {
  for (let i = 0; i < n; i++) {
    const x = rng() * S, y = rng() * S, r = size * (0.4 + rng());
    const c = typeof col === 'function' ? col(rng) : col;
    for (const [g, fill] of [[layers.g, c], [layers.hg, hgt], [layers.rg, rough]]) {
      if (!g || fill === null) continue;
      g.fillStyle = fill; g.fillRect(x, y, r, r);
    }
  }
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
  const S = Math.round(256 * texScale), k = S / 256;
  const rng = mulberry32(name.length * 997 + 13);
  const [c, g] = canvas(S, S);
  const [ce, ge] = canvas(S, S);
  const [ch, gh] = canvas(S, S); // height
  const [cr, gr] = canvas(S, S); // roughness / metalness
  g.fillStyle = opts.frame; g.fillRect(0, 0, S, S);
  noise(g, S, S, 1600 * k * k, rng, 0.06);
  gh.fillStyle = '#b0b0b0'; gh.fillRect(0, 0, S, S);
  noise(gh, S, S, 3000 * k * k, rng, 0.12);
  gr.fillStyle = rm(opts.frameRough ?? 0.85, opts.frameMetal ?? 0); gr.fillRect(0, 0, S, S);
  if (opts.bricks) {
    const bh = 3.2 * k, bw = 9 * k;
    for (let y = 0, row = 0; y < S; y += bh, row++) {
      for (let x = (row % 2) * bw / 2 - bw; x < S; x += bw) {
        const v = rng();
        g.fillStyle = `rgba(${v < 0.5 ? '40,10,0' : '255,200,170'},${0.05 + rng() * 0.12})`;
        g.fillRect(x + 0.6, y + 0.6, bw - 1.2, bh - 1.2);
        gh.fillStyle = '#c8c8c8'; gh.fillRect(x + 0.7, y + 0.7, bw - 1.4, bh - 1.4);
      }
      g.fillStyle = 'rgba(210,200,185,0.35)'; g.fillRect(0, y, S, 0.7);
      gh.fillStyle = '#707070'; gh.fillRect(0, y, S, 0.8);
    }
  }
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
  const cw = S / opts.cols, rh = S / opts.rows;
  const padX = opts.padX * k, padY = opts.padY * k;
  const winMetal = opts.glassMetal ?? 0.3;
  const shape = (ctx, x, y, w, h) => {
    if (opts.arch) {
      ctx.beginPath();
      ctx.moveTo(x, y + h); ctx.lineTo(x, y + w / 2);
      ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
      ctx.lineTo(x + w, y + h); ctx.closePath(); ctx.fill();
    } else ctx.fillRect(x, y, w, h);
  };
  for (let r = 0; r < opts.rows; r++) {
    for (let col = 0; col < opts.cols; col++) {
      const x = col * cw + padX, y = r * rh + padY;
      const w = cw - padX * 2, h = rh - padY * 2;
      // reveal around the window
      if (padX > 2) {
        g.fillStyle = 'rgba(0,0,0,0.25)'; shape(g, x - 1.5 * k, y - 1.5 * k, w + 3 * k, h + 3 * k);
      }
      // glass with a sky reflection gradient and random blinds
      const grad = g.createLinearGradient(x, y, x + w * 0.4, y + h);
      grad.addColorStop(0, opts.glassA);
      grad.addColorStop(1, opts.glassB);
      g.fillStyle = grad; shape(g, x, y, w, h);
      if (rng() < 0.35 && h > 6) {
        g.fillStyle = `rgba(${rng() < 0.5 ? '230,225,210' : '120,110,95'},0.55)`;
        g.fillRect(x, y, w, h * (0.2 + rng() * 0.5));
      }
      gh.fillStyle = '#303030'; shape(gh, x, y, w, h);
      gr.fillStyle = rm(0.06, winMetal); shape(gr, x, y, w, h);
      // mullions
      if (opts.mullions && w > 6 * k) {
        g.fillStyle = opts.mullions; gh.fillStyle = '#707070'; gr.fillStyle = rm(0.4, 0.8);
        for (const ctx of [g, gh, gr]) { ctx.fillRect(x + w / 2 - 0.6 * k, y, 1.2 * k, h); ctx.fillRect(x, y + h * 0.3, w, 1 * k); }
      }
      if (opts.shutters) {
        g.fillStyle = opts.shutters;
        g.fillRect(x - 5 * k, y, 4 * k, h); g.fillRect(x + w + 1 * k, y, 4 * k, h);
        gh.fillStyle = '#d0d0d0';
        gh.fillRect(x - 5 * k, y, 4 * k, h); gh.fillRect(x + w + 1 * k, y, 4 * k, h);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        for (let yy = y; yy < y + h; yy += 2 * k) { g.fillRect(x - 5 * k, yy, 4 * k, 0.6 * k); g.fillRect(x + w + 1 * k, yy, 4 * k, 0.6 * k); }
      }
      if (opts.sill) {
        g.fillStyle = opts.sill; g.fillRect(x - 2 * k, y + h, w + 4 * k, 3 * k);
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x - 2 * k, y + h + 3 * k, w + 4 * k, 1.5 * k);
        gh.fillStyle = '#ffffff'; gh.fillRect(x - 2 * k, y + h, w + 4 * k, 3 * k);
      }
      // lit windows at night
      if (rng() < opts.lit) {
        const warm = rng();
        const base = warm < 0.6 ? [255, 200, 130] : warm < 0.85 ? [240, 225, 190] : [150, 200, 255];
        const b = 0.55 + rng() * 0.45;
        // ceiling light at the top fading down into the room
        const lg = ge.createLinearGradient(x, y, x, y + h);
        lg.addColorStop(0, `rgb(${base.map((c) => c * b | 0)})`);
        lg.addColorStop(1, `rgb(${base.map((c) => c * b * 0.45 | 0)})`);
        ge.fillStyle = lg;
        ge.fillRect(x, y, w, h);
        // blinds or a silhouette
        if (rng() < 0.4) {
          ge.fillStyle = 'rgba(0,0,0,0.35)';
          for (let yy = y; yy < y + h; yy += 2.5 * k) ge.fillRect(x, yy, w, 1 * k);
        } else if (rng() < 0.3) {
          ge.fillStyle = 'rgba(0,0,0,0.6)';
          ge.fillRect(x + w * (0.2 + rng() * 0.5), y + h * 0.35, w * 0.12, h * 0.65);
        }
      }
    }
  }
  if (opts.bands) {
    g.fillStyle = opts.bands; gh.fillStyle = '#d8d8d8'; gr.fillStyle = rm(0.3, 0.7);
    for (let r = 0; r < opts.rows; r++) for (const ctx of [g, gh, gr]) ctx.fillRect(0, r * rh, S, 3 * k);
  }
  // grime streaks running down from the sills
  for (let i = 0; i < 30 * k; i++) {
    const x = rng() * S, y = rng() * S, l = 10 + rng() * 60 * k;
    const gg = g.createLinearGradient(0, y, 0, y + l);
    gg.addColorStop(0, 'rgba(30,25,20,0.12)'); gg.addColorStop(1, 'rgba(30,25,20,0)');
    g.fillStyle = gg; g.fillRect(x, y, 1 + rng() * 3 * k, l);
  }
  // keep bottom-left corner as frame for roofs
  const cs = 6 * k;
  g.fillStyle = opts.roof || opts.frame; g.fillRect(0, S - cs, cs, cs);
  ge.fillStyle = '#000'; ge.fillRect(0, S - cs, cs, cs);
  gh.fillStyle = '#b0b0b0'; gh.fillRect(0, S - cs, cs, cs);
  gr.fillStyle = rm(0.9, 0); gr.fillRect(0, S - cs, cs, cs);
  const map = toTex(c);
  const emissiveMap = toTex(ce);
  FACADE_STYLES[name] = { map, emissiveMap, normalMap: normalFromHeight(ch, 3), ormMap: toTex(cr, false), tileW: opts.tileW, tileH: opts.tileH };
}

export function buildFacades() {
  facade('glass', { frame: '#8d9aa6', glassA: '#1e3348', glassB: '#5d7f9c', cols: 8, rows: 16, padX: 1, padY: 1, lit: 0.35, tileW: 16, tileH: 32, bands: '#a9b4be', roof: '#6d747c', glassMetal: 0.85, frameRough: 0.35, frameMetal: 0.8 });
  facade('office', { frame: '#c7c0b3', glassA: '#1d2833', glassB: '#44586b', cols: 6, rows: 10, padX: 5, padY: 5, lit: 0.4, tileW: 18, tileH: 30, sill: '#e6e0d4', roof: '#7c7870', mullions: '#5a5f66', glassMetal: 0.6 });
  facade('brick', { frame: '#80442f', glassA: '#1f2a33', glassB: '#3d5566', cols: 4, rows: 6, padX: 14, padY: 10, lit: 0.45, tileW: 12, tileH: 18, arch: true, sill: '#d8cbb5', roof: '#57463e', bricks: true, frameRough: 0.95 });
  facade('pastel', { frame: '#f2efe8', glassA: '#233', glassB: '#465a5f', cols: 3, rows: 4, padX: 20, padY: 8, lit: 0.55, tileW: 12, tileH: 14, shutters: '#2f5b3a', roof: '#8a8580' });
  facade('res', { frame: '#d6c9b0', glassA: '#26313a', glassB: '#51626e', cols: 4, rows: 5, padX: 12, padY: 11, lit: 0.5, tileW: 14, tileH: 16, sill: '#fff', roof: '#6a5f55', mullions: '#eee' });
  facade('dark', { frame: '#2a2d33', glassA: '#101820', glassB: '#304860', cols: 10, rows: 20, padX: 1, padY: 2, lit: 0.3, tileW: 16, tileH: 32, roof: '#222', glassMetal: 0.9, frameRough: 0.3, frameMetal: 0.9 });
}

// ---- Ground ----------------------------------------------------------------
function layers(S, W = S) {
  const [c, g] = canvas(W, S), [hc, hg] = canvas(W, S), [rc, rg] = canvas(W, S);
  return { c, g, hc, hg, rc, rg };
}

export function grassTexture() {
  const S = Math.round(256 * texScale), rng = mulberry32(7), L = layers(S);
  const { g, hg, rg } = L;
  g.fillStyle = '#4a642c'; g.fillRect(0, 0, S, S);
  hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
  rg.fillStyle = rm(0.95); rg.fillRect(0, 0, S, S);
  // soil patches and colour variation
  for (let i = 0; i < 50; i++) {
    const x = rng() * S, y = rng() * S, r = (8 + rng() * 26) * texScale;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const dry = rng() < 0.5;
    gr.addColorStop(0, dry ? 'rgba(125,110,62,0.35)' : 'rgba(40,70,25,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // blades
  for (let i = 0; i < 16000 * texScale * texScale; i++) {
    const v = rng(), x = rng() * S, y = rng() * S, l = 1 + rng() * 3;
    g.fillStyle = v < 0.3 ? '#5b7b35' : v < 0.6 ? '#3f5923' : v < 0.9 ? '#6c8a40' : '#8a8a4e';
    g.fillRect(x, y, 1, l);
    const hv = 90 + rng() * 120 | 0;
    hg.fillStyle = `rgb(${hv},${hv},${hv})`; hg.fillRect(x, y, 1, l);
  }
  return withPbr(toTex(L.c), L.hc, 3, null);
}

export function concreteTexture() {
  const S = Math.round(128 * texScale), rng = mulberry32(11), L = layers(S), k = S / 128;
  const { g, hg, rg } = L;
  g.fillStyle = '#9d9a94'; g.fillRect(0, 0, S, S);
  hg.fillStyle = '#a0a0a0'; hg.fillRect(0, 0, S, S);
  rg.fillStyle = rm(0.88); rg.fillRect(0, 0, S, S);
  // each slab slightly different
  for (let x = 0; x < S; x += 32 * k) for (let y = 0; y < S; y += 32 * k) {
    const v = (rng() - 0.5) * 16 | 0;
    g.fillStyle = `rgba(${v > 0 ? '255,250,240' : '40,38,35'},${Math.abs(v) / 90})`; g.fillRect(x, y, 32 * k, 32 * k);
  }
  noise(g, S, S, 3000 * k * k, rng, 0.08);
  noise(hg, S, S, 4000 * k * k, rng, 0.2);
  speckle(L, S, 14, rng, 5 * k, 'rgba(50,45,40,0.12)', null, rm(0.6));   // stains
  speckle(L, S, 60, rng, 1.2 * k, 'rgba(30,30,30,0.5)', '#303030', null); // chewing gum / pits
  g.strokeStyle = 'rgba(55,52,48,0.55)'; hg.strokeStyle = '#303030';
  for (const ctx of [g, hg]) {
    ctx.lineWidth = 1.2 * k;
    for (let i = 0; i <= S; i += 32 * k) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke();
    }
  }
  return withPbr(toTex(L.c), L.hc, 2.5, L.rc);
}

// hairline cracks drawn into colour + height
function cracks(L, S, n, rng) {
  for (let i = 0; i < n; i++) {
    let x = rng() * S, y = rng() * S, a = rng() * Math.PI * 2;
    L.g.strokeStyle = 'rgba(15,15,15,0.55)'; L.hg.strokeStyle = '#202020';
    for (const ctx of [L.g, L.hg]) { ctx.lineWidth = 0.8 * texScale; ctx.beginPath(); }
    L.g.moveTo(x, y); L.hg.moveTo(x, y);
    for (let j = 0; j < 12; j++) {
      a += (rng() - 0.5) * 1.2; x += Math.cos(a) * 4 * texScale; y += Math.sin(a) * 4 * texScale;
      L.g.lineTo(x, y); L.hg.lineTo(x, y);
    }
    L.g.stroke(); L.hg.stroke();
  }
}

function asphaltBase(L, W, H, rng) {
  const { g, hg, rg } = L;
  g.fillStyle = '#35373a'; g.fillRect(0, 0, W, H);
  hg.fillStyle = '#808080'; hg.fillRect(0, 0, W, H);
  rg.fillStyle = rm(0.9); rg.fillRect(0, 0, W, H);
  // aggregate
  const n = W * H * 0.35;
  for (let i = 0; i < n; i++) {
    const x = rng() * W, y = rng() * H, v = 30 + rng() * 60 | 0;
    g.fillStyle = `rgba(${v + 20},${v + 20},${v + 22},0.5)`; g.fillRect(x, y, 1, 1);
    const hv = 60 + rng() * 150 | 0;
    hg.fillStyle = `rgb(${hv},${hv},${hv})`; hg.fillRect(x, y, 1, 1);
  }
  // patches of newer / older asphalt
  for (let i = 0; i < 6; i++) {
    const w = (20 + rng() * 60) * texScale, h = (10 + rng() * 40) * texScale;
    g.fillStyle = rng() < 0.5 ? 'rgba(20,20,22,0.35)' : 'rgba(90,90,90,0.12)';
    g.fillRect(rng() * W, rng() * H, w, h);
  }
  // oil drips: darker and glossier
  speckle(L, Math.min(W, H), 40, rng, 4 * texScale, 'rgba(10,10,12,0.35)', null, rm(0.45));
}

// City road tile: 100m x 100m, road centrelines along u=0 and v=0 edges.
export function cityRoadTexture() {
  const S = Math.round(512 * texScale), rng = mulberry32(3), L = layers(S);
  const { g, hg, rg } = L;
  asphaltBase(L, S, S, rng);
  cracks(L, S, 30, rng);
  const m = S / 100; // px per metre
  const hw = 9 * m; // half road width
  // darker tyre tracks in each lane
  g.fillStyle = 'rgba(15,15,18,0.18)';
  for (const off of [2.6, 6.2]) for (const sgn of [1, -1]) {
    const p = (sgn * off * m + S) % S;
    g.fillRect(p - 0.5 * m, 0, 1 * m, S); g.fillRect(0, p - 0.5 * m, S, 1 * m);
  }
  const paint = (col, x, y, w, h) => {
    g.fillStyle = col; g.fillRect(x, y, w, h);
    hg.fillStyle = '#a8a8a8'; hg.fillRect(x, y, w, h);
    rg.fillStyle = rm(0.6); rg.fillRect(x, y, w, h);
  };
  // double yellow centre lines (wrap around tile edge)
  for (const off of [0.25, -0.55]) {
    const p = (off * m + S) % S;
    paint('#d9b43a', p, hw + 4, 2 * texScale, S - 2 * hw - 8);
    paint('#d9b43a', hw + 4, p, S - 2 * hw - 8, 2 * texScale);
  }
  // white lane edge lines
  for (const e of [hw - 1.5 * m, S - hw + 1.5 * m - 2]) {
    paint('rgba(225,225,220,0.9)', e, hw + 6, 2 * texScale, S - 2 * hw - 12);
    paint('rgba(225,225,220,0.9)', hw + 6, e, S - 2 * hw - 12, 2 * texScale);
  }
  // crosswalks near each corner-intersection
  const cwk = 0.85;
  for (let i = -hw + 4; i < hw - 4; i += 6 * texScale) {
    const a = (i + S) % S, l = 14 * texScale, t = 3 * texScale;
    paint(`rgba(235,235,230,${cwk})`, a, hw + 2, t, l); paint(`rgba(235,235,230,${cwk})`, a, S - hw - 2 - l, t, l);
    paint(`rgba(235,235,230,${cwk})`, hw + 2, a, l, t); paint(`rgba(235,235,230,${cwk})`, S - hw - 2 - l, a, l, t);
  }
  // wear on the paint
  noise(g, S, S, 6000 * texScale * texScale, rng, 0.25);
  return withPbr(toTex(L.c), L.hc, 2, L.rc);
}

// Highway: tile is full road width (30m) across u, 20m along v.
export function highwayTexture() {
  const W = Math.round(256 * texScale), H = Math.round(170 * texScale), rng = mulberry32(5);
  const L = layers(H, W);
  const { g, hg, rg } = L;
  asphaltBase(L, W, H, rng);
  cracks(L, W, 6, rng);
  const m = W / 30;
  const paint = (col, x, y, w, h) => {
    g.fillStyle = col; g.fillRect(x, y, w, h);
    hg.fillStyle = '#a8a8a8'; hg.fillRect(x, y, w, h);
    rg.fillStyle = rm(0.6); rg.fillRect(x, y, w, h);
  };
  g.fillStyle = 'rgba(15,15,18,0.2)';
  for (const u of [4, 11, 19, 26]) g.fillRect(u * m - 0.5 * m, 0, 1 * m, H);
  const t = 2 * texScale;
  paint('#d9b43a', 1.2 * m, 0, t, H); paint('#d9b43a', W - 1.2 * m - t, 0, t, H);
  paint('#d9b43a', W / 2 - 2 * t, 0, t, H); paint('#d9b43a', W / 2 + t, 0, t, H);
  for (const u of [7.5, 22.5]) paint('#e4e4e0', u * m - t / 2, 0, t, H * 0.45);
  return withPbr(toTex(L.c), L.hc, 2, L.rc);
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
  const S = 256, rng = mulberry32(4), L = layers(S);
  const sc = texScale; texScale = 1;
  asphaltBase(L, S, S, rng);
  texScale = sc;
  L.g.fillStyle = '#ddd'; L.hg.fillStyle = '#a8a8a8'; L.rg.fillStyle = rm(0.6);
  for (let row = 0; row < 3; row++) {
    const y0 = 20 + row * 80;
    for (let x = 10; x < S - 10; x += 20) for (const ctx of [L.g, L.hg, L.rg]) ctx.fillRect(x, y0, 2, 40);
  }
  const map = withPbr(toTex(L.c, true, false), L.hc, 2, L.rc);
  for (const t of [map, map.userData.normalMap, map.userData.roughMap]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return map;
}

export function neonTexture(text, color) {
  return textTexture([{ text, size: 90, color: '#fff', glow: color, font: '"Brush Script MT", cursive', weight: 700 }], { w: 512, h: 160, bg: '#0a0a0f' });
}

// clumpy leaf relief for tree canopies
export function leafTexture() {
  const S = 256, rng = mulberry32(77);
  const [c, g] = canvas(S, S), [hc, hg] = canvas(S, S);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  hg.fillStyle = '#404040'; hg.fillRect(0, 0, S, S);
  for (let i = 0; i < 2200; i++) {
    const x = rng() * S, y = rng() * S, r = 3 + rng() * 6, a = rng() * Math.PI;
    const v = 0.7 + rng() * 0.3;
    g.fillStyle = `rgb(${v * 230 | 0},${v * 255 | 0},${v * 215 | 0})`;
    const hv = 120 + rng() * 135 | 0;
    hg.fillStyle = `rgb(${hv},${hv},${hv})`;
    for (const ctx of [g, hg]) { ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.45, a, 0, Math.PI * 2); ctx.fill(); }
  }
  return withPbr(toTex(c), hc, 4, null);
}
