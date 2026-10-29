// Deterministic trailer renderer. drawFrame(ctx, t, ...) paints the frame at
// time t (seconds) so the same code drives the live player on the page and
// the frame-by-frame MP4 export. Cuts are locked to the score's bar grid.
import { BAR, BEAT, BARS } from './music.js';

export const SHOTS = ['dallas_aerial', 'nola_quarter', 'atl_skyline', 'dallas_night', 'nola_dome', 'atl_stadium', 'dallas_action', 'texas_star'];

const bars = (a, b) => [a * BAR, b * BAR];

// kb: Ken Burns move [scale0, scale1, panX0, panX1, panY0, panY1]; pan is -1..1 of the overflow.
const SCENES = [
  { at: bars(0, 2), type: 'intro', img: 'dallas_aerial', kicker: 'From the streets of', title: 'DALLAS', kb: [1.06, 1.2, -0.4, 0.2, 0.2, -0.1] },
  { at: bars(2, 4), type: 'intro', img: 'nola_quarter', kicker: 'To the French Quarter of', title: 'NEW ORLEANS', kb: [1.18, 1.06, 0.3, -0.2, 0, 0.1] },
  { at: bars(4, 6), type: 'intro', img: 'atl_skyline', kicker: 'To the heart of', title: 'ATLANTA', kb: [1.05, 1.22, 0.2, -0.3, -0.1, 0.1] },
  { at: bars(6, 7), type: 'title', img: 'dallas_night' },
  { at: bars(7, 8), type: 'feature', img: 'dallas_night', title: 'THREE CITIES', sub: 'One open world, linked by the I-20, I-49 and I-59', kb: [1.1, 1.2, -0.3, 0.3, 0, 0] },
  { at: bars(8, 9), type: 'feature', img: 'nola_dome', title: 'SIX MISSIONS', sub: 'The Big D Heist · Bayou Express · Skyfall Over The A', kb: [1.2, 1.08, 0.2, -0.2, 0.1, -0.1] },
  { at: bars(9, 10), type: 'feature', img: 'atl_stadium', title: 'FIVE-STAR HEAT', sub: 'Cruisers, SWAT, choppers. At five stars, the army sends a tank.', kb: [1.05, 1.18, 0, 0, -0.3, 0.2] },
  { at: bars(10, 11), type: 'feature', img: 'dallas_action', title: 'TANKS · CHOPPERS · NITRO', sub: 'Drift it, jump it, fly it, or parachute out of it', kb: [1.16, 1.04, -0.2, 0.2, 0, 0] },
  { at: bars(11, 12), type: 'feature', img: 'texas_star', title: 'DUSK TILL DAWN', sub: 'Full day and night cycle, rain and neon', kb: [1.05, 1.16, 0.3, -0.1, 0.1, -0.1] },
  { at: bars(12, 13), type: 'feature', img: 'nola_quarter', title: 'THREE RADIO STATIONS', sub: 'Country · Second Line Brass · Peach State Trap', kb: [1.22, 1.12, -0.5, 0.1, -0.2, 0.2] },
  { at: bars(13, 14), type: 'feature', img: 'dallas_aerial', title: 'EVERY BRICK IS CODE', sub: 'Geometry, textures and sound are all generated', kb: [1.3, 1.15, 0.5, 0.2, -0.3, 0] },
  { at: bars(14, 15), type: 'feature', img: 'atl_skyline', title: 'PLAYS IN YOUR BROWSER', sub: 'No download. Desktop and touch screens.', kb: [1.08, 1.2, -0.2, 0.3, 0, 0.1] },
  { at: bars(15, 16), type: 'montage', imgs: ['dallas_action', 'atl_stadium', 'texas_star', 'nola_dome'], words: ['GAMEPLAY', 'MISSIONS', 'STUNTS', 'BEHIND THE BUILD'] },
  { at: bars(16, BARS), type: 'end', img: 'dallas_aerial' },
];

export const TRAILER_LENGTH = BARS * BAR;

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
const easeInOut = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const lerp = (a, b, k) => a + (b - a) * k;

const HEAT = ['#ffd36b', '#ff7a1a', '#ff2d55'];
const DISPLAY = '"Anton", Impact, "Arial Narrow", sans-serif';
const BODY = '"Inter", system-ui, sans-serif';

let grain = null;
function grainTile() {
  if (grain) return grain;
  grain = document.createElement('canvas'); grain.width = grain.height = 256;
  const g = grain.getContext('2d'); const id = g.createImageData(256, 256);
  let s = 99;
  for (let i = 0; i < id.data.length; i += 4) {
    s = (s * 1664525 + 1013904223) >>> 0; const v = s >>> 24;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
  }
  g.putImageData(id, 0, 0); return grain;
}

function cover(ctx, img, W, H, scale, px, py) {
  if (!img) { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H); return; }
  const iw = img.width, ih = img.height;
  const s = Math.max(W / iw, H / ih) * scale;
  const dw = iw * s, dh = ih * s;
  const ox = (dw - W) / 2, oy = (dh - H) / 2;
  ctx.drawImage(img, -ox + px * ox, -oy + py * oy, dw, dh);
}

function grade(ctx, W, H, warm = 0.5) {
  ctx.save();
  // teal shadows / orange highlights
  ctx.globalCompositeOperation = 'soft-light';
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `rgba(40,110,160,${0.55})`);
  g.addColorStop(1, `rgba(255,140,60,${0.35 + warm * 0.3})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // vignette
  ctx.globalCompositeOperation = 'multiply';
  const r = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.hypot(W, H) * 0.62);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(20,10,20,1)');
  ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function heatFill(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  HEAT.forEach((c, i) => g.addColorStop(i / (HEAT.length - 1), c));
  return g;
}

// Text revealed by a left-to-right wipe with a slight rise.
function wipeText(ctx, text, x, y, k, { font, fill = '#fff', align = 'left', spacing = 0, shadow = true }) {
  if (k <= 0) return;
  ctx.save();
  ctx.font = font; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
  const w = ctx.measureText(text).width;
  const left = align === 'center' ? x - w / 2 : x;
  const e = easeOut(k);
  ctx.beginPath(); ctx.rect(left - 20, y - 2000, (w + 40) * e, 4000); ctx.clip();
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 4; }
  ctx.fillStyle = fill; ctx.globalAlpha = clamp(k * 2);
  ctx.fillText(text, x, y + (1 - e) * 18);
  ctx.restore();
  return w;
}

function fitFont(ctx, text, family, max, maxWidth, spacing = 0) {
  let size = max;
  for (let i = 0; i < 12; i++) {
    ctx.font = `${size}px ${family}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size *= 0.9;
  }
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  return size;
}

function logo(ctx, W, H, cx, cy, size, k) {
  const big = fitFont(ctx, 'SOUTHERN HEAT', DISPLAY, size, W * 0.86, size * 0.02);
  ctx.save();
  const a = easeOut(k);
  ctx.translate(cx, cy); ctx.scale(lerp(1.18, 1, a), lerp(1.18, 1, a)); ctx.translate(-cx, -cy);
  ctx.globalAlpha = clamp(k * 3);
  ctx.textAlign = 'center';
  ctx.font = `600 ${big * 0.16}px ${BODY}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${big * 0.08}px`;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText('GRAND THEFT', cx + big * 0.04, cy - big * 0.92);
  ctx.font = `${big}px ${DISPLAY}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${big * 0.02}px`;
  ctx.shadowColor = 'rgba(255,80,30,0.65)'; ctx.shadowBlur = big * 0.35;
  ctx.fillStyle = heatFill(ctx, cx, cy - big * 0.8, cx, cy);
  ctx.fillText('SOUTHERN HEAT', cx, cy);
  ctx.shadowBlur = 0;
  // underline rule
  const w = ctx.measureText('SOUTHERN HEAT').width;
  ctx.fillStyle = heatFill(ctx, cx - w / 2, 0, cx + w / 2, 0);
  ctx.fillRect(cx - (w / 2) * a, cy + big * 0.12, w * a, Math.max(2, big * 0.03));
  ctx.restore();
}

function letterbox(ctx, W, H, k) {
  if (H > W) return; // vertical cut: no bars
  const h = H * 0.1 * easeInOut(k);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, h); ctx.fillRect(0, H - h, W, h);
}

function finish(ctx, W, H, t, flash) {
  if (flash > 0) { ctx.fillStyle = `rgba(255,245,230,${flash})`; ctx.fillRect(0, 0, W, H); }
  ctx.save();
  ctx.globalAlpha = 0.07; ctx.globalCompositeOperation = 'overlay';
  const tile = grainTile(); const f = Math.floor(t * 24);
  const ox = (f * 73) % 256, oy = (f * 151) % 256;
  ctx.translate(-ox, -oy);
  ctx.fillStyle = ctx.createPattern(tile, 'repeat'); ctx.fillRect(0, 0, W + 256, H + 256);
  ctx.restore();
}

function drawSubscribe(ctx, W, H, cx, cy, s, k, clicked, pulse) {
  const label = clicked ? 'SUBSCRIBED' : 'SUBSCRIBE';
  ctx.save();
  ctx.font = `${s}px ${DISPLAY}`; if ('letterSpacing' in ctx) ctx.letterSpacing = `${s * 0.06}px`;
  const tw = ctx.measureText(label).width;
  const bw = tw + s * 2.6, bh = s * 1.9;
  const sc = easeOut(k) * (1 + pulse * 0.05);
  ctx.translate(cx, cy); ctx.scale(sc, sc);
  ctx.shadowColor = clicked ? 'rgba(0,0,0,0.4)' : 'rgba(255,30,60,0.6)'; ctx.shadowBlur = s * 1.2;
  ctx.fillStyle = clicked ? '#2a2a2e' : '#ff1f3d';
  ctx.beginPath(); ctx.roundRect(-bw / 2, -bh / 2, bw, bh, bh / 2); ctx.fill();
  ctx.shadowBlur = 0;
  // bell / check icon
  const ix = -bw / 2 + s * 1.15, ir = s * 0.42;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = s * 0.12; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (clicked) {
    ctx.beginPath(); ctx.moveTo(ix - ir * 0.7, 0); ctx.lineTo(ix - ir * 0.15, ir * 0.55); ctx.lineTo(ix + ir * 0.8, -ir * 0.6); ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(ix - ir * 0.8, ir * 0.45);
    ctx.quadraticCurveTo(ix - ir * 0.62, ir * 0.2, ix - ir * 0.62, -ir * 0.15);
    ctx.quadraticCurveTo(ix - ir * 0.6, -ir * 0.85, ix, -ir * 0.88);
    ctx.quadraticCurveTo(ix + ir * 0.6, -ir * 0.85, ix + ir * 0.62, -ir * 0.15);
    ctx.quadraticCurveTo(ix + ir * 0.62, ir * 0.2, ix + ir * 0.8, ir * 0.45);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(ix, ir * 0.62, ir * 0.18, 0, Math.PI * 2); ctx.fill();
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(label, ix + s * 0.75, s * 0.06);
  ctx.restore();
  return { bw, bh };
}

function drawCursor(ctx, x, y, s, press) {
  ctx.save(); ctx.translate(x, y); const k = 1 - press * 0.15; ctx.scale(k, k);
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(0, s * 1.6); ctx.lineTo(s * 0.42, s * 1.22); ctx.lineTo(s * 0.72, s * 1.85);
  ctx.lineTo(s * 0.95, s * 1.74); ctx.lineTo(s * 0.66, s * 1.12); ctx.lineTo(s * 1.15, s * 1.1); ctx.closePath();
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = s * 0.09;
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = s * 0.4;
  ctx.fill(); ctx.shadowBlur = 0; ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
export function drawFrame(ctx, t, W, H, images, opts = {}) {
  const U = Math.min(W, H);             // layout unit
  const vertical = H > W;
  const scene = SCENES.find((s) => t >= s.at[0] && t < s.at[1]) || SCENES[SCENES.length - 1];
  const [s0, s1] = scene.at;
  const local = t - s0, dur = s1 - s0, p = clamp(local / dur);
  const barT = (t % BAR), beatT = (t % BEAT);
  let flash = 0;

  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

  if (scene.type === 'intro' || scene.type === 'feature') {
    const [a, b, x0, x1, y0, y1] = scene.kb;
    const e = easeInOut(p);
    let scale = lerp(a, b, e);
    if (scene.type === 'feature') scale += 0.05 * Math.exp(-local * 7) + 0.02 * Math.exp(-Math.max(0, local - BEAT * 2) * 9) * (local > BEAT * 2 ? 1 : 0);
    cover(ctx, images[scene.img], W, H, scale, lerp(x0, x1, e), lerp(y0, y1, e));
    grade(ctx, W, H, scene.type === 'intro' ? 0.7 : 0.4);

    // darken the lower third for legibility
    const lg = ctx.createLinearGradient(0, H * 0.45, 0, H);
    lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);

    const margin = vertical ? U * 0.08 : U * 0.11;
    const baseY = vertical ? H * 0.72 : H * 0.8;
    if (scene.type === 'intro') {
      // fade from black at the very start
      if (t < 0.9) { ctx.fillStyle = `rgba(0,0,0,${1 - easeOut(t / 0.9)})`; ctx.fillRect(0, 0, W, H); }
      const ks = U * 0.042;
      wipeText(ctx, scene.kicker.toUpperCase(), margin, baseY - U * 0.17, (local - 0.25) / 0.6, { font: `600 ${ks}px ${BODY}`, fill: HEAT[0], spacing: ks * 0.35 });
      const ts = fitFont(ctx, scene.title, DISPLAY, U * 0.2, W - margin * 2, U * 0.004);
      wipeText(ctx, scene.title, margin, baseY, (local - 0.55) / 0.7, { font: `${ts}px ${DISPLAY}`, spacing: U * 0.004 });
      // fade out to the next card
      const out = clamp((local - (dur - 0.35)) / 0.35);
      if (out > 0) { ctx.fillStyle = `rgba(0,0,0,${out * 0.85})`; ctx.fillRect(0, 0, W, H); }
    } else {
      flash = 0.38 * Math.exp(-local * 16);
      const ts = fitFont(ctx, scene.title, DISPLAY, U * (vertical ? 0.15 : 0.13), W - margin * 2, U * 0.003);
      // accent bar
      const barW = U * 0.012, k = easeOut((local - 0.05) / 0.3);
      ctx.fillStyle = heatFill(ctx, 0, baseY - ts, 0, baseY);
      ctx.fillRect(margin, baseY - ts * 0.86 * k, barW, ts * 0.86 * k);
      wipeText(ctx, scene.title, margin + barW * 2.4, baseY, (local - 0.08) / 0.38, { font: `${ts}px ${DISPLAY}`, spacing: U * 0.003 });
      const ss = U * (vertical ? 0.036 : 0.03);
      const subFont = `500 ${fitFont(ctx, scene.sub, BODY, ss, W - margin * 2.5)}px ${BODY}`;
      wipeText(ctx, scene.sub, margin + barW * 2.4, baseY + ss * 1.9, (local - 0.4) / 0.5, { font: subFont, fill: 'rgba(255,255,255,0.88)' });
    }
    letterbox(ctx, W, H, scene.type === 'intro' ? clamp(t / 1.5) : 1);
  } else if (scene.type === 'title') {
    // dim plate of the night skyline behind the logo
    ctx.globalAlpha = 0.35 * easeOut(local / 1.2);
    cover(ctx, images[scene.img], W, H, 1.25 - 0.08 * p, 0, 0);
    ctx.globalAlpha = 1;
    grade(ctx, W, H, 0.2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H);
    flash = 0.9 * Math.exp(-local * 6);
    logo(ctx, W, H, W / 2, H * 0.56, U * (vertical ? 0.2 : 0.22), local / 0.6);
    const ss = U * 0.028;
    ctx.save(); ctx.globalAlpha = clamp((local - 0.6) / 0.4);
    ctx.font = `600 ${ss}px ${BODY}`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.85)';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${ss * 0.4}px`;
    ctx.fillText(vertical ? 'DALLAS · NOLA · ATLANTA' : 'DALLAS  ·  NEW ORLEANS  ·  ATLANTA', W / 2, H * 0.56 + U * 0.12);
    ctx.restore();
    letterbox(ctx, W, H, 1);
  } else if (scene.type === 'montage') {
    const i = Math.min(3, Math.floor(local / BEAT));
    const bl = local - i * BEAT;
    cover(ctx, images[scene.imgs[i]], W, H, 1.25 - bl * 0.12, (i % 2 ? 0.4 : -0.4), 0);
    grade(ctx, W, H, 0.5);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
    flash = 0.4 * Math.exp(-bl * 16);
    const word = scene.words[i];
    const ts = fitFont(ctx, word, DISPLAY, U * 0.17, W * 0.86, U * 0.006);
    ctx.save();
    const sc = 1.12 - 0.12 * easeOut(bl / 0.25);
    ctx.translate(W / 2, H / 2); ctx.scale(sc, sc);
    ctx.font = `${ts}px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${U * 0.006}px`;
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 30;
    ctx.fillStyle = i === 3 ? heatFill(ctx, 0, -ts / 2, 0, ts / 2) : '#fff';
    ctx.fillText(word, 0, 0);
    ctx.restore();
    letterbox(ctx, W, H, 1);
  } else if (scene.type === 'end') {
    // blurred, darkened backdrop
    ctx.save();
    ctx.filter = `blur(${Math.round(U * 0.018)}px) brightness(0.45) saturate(1.2)`;
    cover(ctx, images[scene.img], W, H, 1.15 + 0.05 * p, 0, 0);
    ctx.restore();
    const rg = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.hypot(W, H) * 0.6);
    rg.addColorStop(0, 'rgba(255,60,40,0.18)'); rg.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    flash = 0.85 * Math.exp(-local * 5);

    const ly = vertical ? H * 0.36 : H * 0.36;
    logo(ctx, W, H, W / 2, ly, U * (vertical ? 0.15 : 0.15), local / 0.5);

    const s = U * (vertical ? 0.062 : 0.058);
    const by = vertical ? H * 0.55 : H * 0.62;
    const clickAt = 2.3;
    const clicked = local > clickAt;
    const pulse = !clicked ? Math.max(0, Math.sin(local * Math.PI * 2 / BEAT * 0.5)) * clamp(local - 0.8) : 0;
    const { bw, bh } = drawSubscribe(ctx, W, H, W / 2, by, s, (local - 0.45) / 0.45, clicked, pulse);

    // cursor glides in and clicks
    if (!opts.interactive) {
      const c0 = [W * 0.86, H * 0.98], c1 = [W / 2 + bw * 0.3, by + bh * 0.1];
      const m = easeInOut((local - 1.2) / 1.0);
      if (local > 1.2 && local < 4.2) {
        const press = clamp(1 - Math.abs(local - clickAt) / 0.12);
        drawCursor(ctx, lerp(c0[0], c1[0], m), lerp(c0[1], c1[1], m), U * 0.04, press);
      }
      if (clicked) {
        const r = (local - clickAt) * U * 0.5, a = clamp(1 - (local - clickAt) / 0.6);
        ctx.strokeStyle = `rgba(255,255,255,${a * 0.8})`; ctx.lineWidth = U * 0.006;
        ctx.beginPath(); ctx.arc(c1[0], c1[1], r, 0, Math.PI * 2); ctx.stroke();
      }
    }

    const ss = U * 0.03;
    ctx.save(); ctx.globalAlpha = clamp((local - 1.0) / 0.5); ctx.textAlign = 'center';
    ctx.font = `600 ${ss}px ${BODY}`; ctx.fillStyle = '#fff';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${ss * 0.25}px`;
    const line1 = opts.handle ? opts.handle.toUpperCase() : 'NEW GAMEPLAY · MISSIONS · STUNTS';
    ctx.fillText(line1, W / 2, by + bh / 2 + ss * 2.6);
    const line2 = opts.interactive ? 'PLAY FREE IN YOUR BROWSER' : 'LINK IN DESCRIPTION  ·  PLAY FREE IN YOUR BROWSER';
    const s2 = fitFont(ctx, line2, BODY, ss * 0.8, W * 0.86, ss * 0.2);
    ctx.font = `500 ${s2}px ${BODY}`; ctx.fillStyle = HEAT[0];
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${ss * 0.2}px`;
    ctx.fillText(line2, W / 2, by + bh / 2 + ss * 4.3);
    ctx.restore();

    // fade out at the very end
    const out = clamp((local - (dur - 0.6)) / 0.6);
    if (out > 0 && !opts.interactive) { ctx.fillStyle = `rgba(0,0,0,${out})`; ctx.fillRect(0, 0, W, H); }
  }

  finish(ctx, W, H, t, flash);
  ctx.restore();
}

export function loadShots(base = './shots/') {
  return Promise.all(SHOTS.map((n) => new Promise((res) => {
    const im = new Image();
    im.onload = () => res([n, im]); im.onerror = () => res([n, null]);
    im.src = `${base}${n}.jpg`;
  }))).then((pairs) => Object.fromEntries(pairs));
}
