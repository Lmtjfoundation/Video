// Procedural trailer score: a dark half-time trap cue in F minor with
// cinematic hits. Everything is synthesised with the Web Audio API, so the
// same function drives live playback (AudioContext) and the offline render
// used for the MP4 export (OfflineAudioContext).

export const BPM = 140;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;
export const BARS = 19;
export const DURATION = BARS * BAR + 1.5;

// Chord tones (Hz). Fm, Db, Bbm, C (harmonic minor turnaround).
const CHORDS = {
  Fm: { root: 43.65, pad: [174.61, 207.65, 261.63, 349.23] },
  Db: { root: 69.3, pad: [138.59, 174.61, 207.65, 277.18] },
  Bbm: { root: 58.27, pad: [116.54, 138.59, 174.61, 233.08] },
  C: { root: 65.41, pad: [130.81, 164.81, 196.0, 261.63] },
};
// One entry per bar.
const PROG = ['Fm', 'Fm', 'Db', 'Db', 'Bbm', 'C', 'Fm', 'Fm', 'Db', 'Bbm', 'C', 'Fm', 'Db', 'Bbm', 'C', 'Db', 'Fm', 'Fm', 'Fm'];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function buildMusic(ctx, out, t0 = 0) {
  const rand = rng(1337);
  const sr = ctx.sampleRate;

  const noise = ctx.createBuffer(1, sr * 2, sr);
  { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1; }

  // ---- master bus: glue compressor + soft limiter
  const master = ctx.createGain();
  master.gain.value = 0.82;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 3.5;
  comp.attack.value = 0.005; comp.release.value = 0.18;
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -2; limit.knee.value = 0; limit.ratio.value = 20;
  limit.attack.value = 0.001; limit.release.value = 0.08;
  const rumble = ctx.createBiquadFilter(); rumble.type = 'highpass'; rumble.frequency.value = 30; rumble.Q.value = 0.7;
  master.connect(rumble); rumble.connect(comp); comp.connect(limit); limit.connect(out);

  // ---- hall reverb from a decaying stereo noise impulse
  const irLen = Math.floor(sr * 3.2);
  const ir = ctx.createBuffer(2, irLen, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < irLen; i++) d[i] = (rand() * 2 - 1) * Math.pow(1 - i / irLen, 3.4);
  }
  const verb = ctx.createConvolver(); verb.buffer = ir;
  const verbOut = ctx.createGain(); verbOut.gain.value = 0.32;
  verb.connect(verbOut); verbOut.connect(master);

  // ---- dotted-eighth ping-pong-ish delay for plucks
  const dly = ctx.createDelay(2); dly.delayTime.value = BEAT * 0.75;
  const fb = ctx.createGain(); fb.gain.value = 0.38;
  const dlyLp = ctx.createBiquadFilter(); dlyLp.type = 'lowpass'; dlyLp.frequency.value = 2600;
  const dlyOut = ctx.createGain(); dlyOut.gain.value = 0.28;
  dly.connect(dlyLp); dlyLp.connect(fb); fb.connect(dly); dlyLp.connect(dlyOut); dlyOut.connect(master);

  const T = (bar, beat = 0) => t0 + bar * BAR + beat * BEAT;
  const shaper = (k) => {
    const ws = ctx.createWaveShaper(); const c = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
    ws.curve = c; return ws;
  };
  const send = (node, amt) => { const g = ctx.createGain(); g.gain.value = amt; node.connect(g); g.connect(verb); };
  const noiseSrc = (t, dur) => {
    const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
    s.start(t, rand() * 1.5); s.stop(t + dur + 0.05); return s;
  };
  const pan = (v) => { const p = ctx.createStereoPanner(); p.pan.value = v; return p; };

  // ---------------------------------------------------------------- drums
  function kick(t, vol = 1) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.45);
    // click
    const n = noiseSrc(t, 0.02); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.25 * vol, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
    n.connect(hp); hp.connect(ng); ng.connect(master);
  }
  function sub808(t, f, dur, vol = 0.9) {
    const o = ctx.createOscillator(); const g = ctx.createGain(); const ws = shaper(2.2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    o.frequency.setValueAtTime(f * 1.9, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.setValueAtTime(vol, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(ws); ws.connect(lp); lp.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function snare(t, vol = 1) {
    const n = noiseSrc(t, 0.3); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.7;
    const g = ctx.createGain();
    // clap: three quick bursts then a tail
    g.gain.setValueAtTime(0, t);
    [0, 0.011, 0.022].forEach((o) => { g.gain.setValueAtTime(0.75 * vol, t + o); g.gain.exponentialRampToValueAtTime(0.12 * vol, t + o + 0.009); });
    g.gain.setValueAtTime(0.6 * vol, t + 0.033); g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    n.connect(bp); bp.connect(g); g.connect(master); send(g, 0.5);
    const o = ctx.createOscillator(); o.type = 'triangle'; const og = ctx.createGain();
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(170, t + 0.08);
    og.gain.setValueAtTime(0.45 * vol, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.15);
  }
  let hatSide = 1;
  function hat(t, vol = 0.3, open = false) {
    const len = open ? 0.28 : 0.045;
    const n = noiseSrc(t, len); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7800;
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 10500; pk.gain.value = 6;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    hatSide = -hatSide;
    n.connect(hp); hp.connect(pk); pk.connect(g); g.connect(pan(0.22 * hatSide)).connect(master);
  }
  function crash(t, vol = 0.32) {
    const n = noiseSrc(t, 2.2); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4500;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 2.1);
    n.connect(hp); hp.connect(g); g.connect(master); send(g, 0.6);
  }

  // ---------------------------------------------------------------- tonal
  function pad(t, dur, freqs, cut0 = 600, cut1 = 1400, vol = 0.05) {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(cut0, t); lp.frequency.linearRampToValueAtTime(cut1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.7, dur * 0.4));
    g.gain.setValueAtTime(vol, t + dur - 0.05); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.9);
    lp.connect(g); g.connect(master); send(g, 0.9);
    freqs.forEach((f, i) => {
      [-8, 8].forEach((cents, j) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = cents + (i - 1.5) * 1.5;
        const p = pan(j ? 0.45 : -0.45); o.connect(p); p.connect(lp); o.start(t); o.stop(t + dur + 1);
      });
    });
  }
  function pluck(t, f, vol = 0.16) {
    const g = ctx.createGain(); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5200, t); lp.frequency.exponentialRampToValueAtTime(900, t + 0.35);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    [[f, 'triangle', 1], [f * 2, 'sine', 0.45], [f * 3.01, 'sine', 0.12]].forEach(([fr, type, a]) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = fr; const og = ctx.createGain(); og.gain.value = a;
      o.connect(og); og.connect(lp); o.start(t); o.stop(t + 0.75);
    });
    lp.connect(g); g.connect(master); g.connect(dly); send(g, 0.35);
  }
  function braam(t, vol = 0.22) {
    const ws = shaper(1.6); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(90, t); lp.frequency.exponentialRampToValueAtTime(1900, t + 0.35); lp.frequency.exponentialRampToValueAtTime(380, t + 2.6);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.04); g.gain.exponentialRampToValueAtTime(0.001, t + 3.2);
    [43.65, 87.31, 130.81, 174.61, 207.65].forEach((f) => [-12, 0, 12].forEach((c) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = c;
      o.connect(ws); o.start(t); o.stop(t + 3.3);
    }));
    ws.connect(lp); lp.connect(g); g.connect(master); send(g, 0.8);
  }
  function impact(t, vol = 1) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.setValueAtTime(78, t); o.frequency.exponentialRampToValueAtTime(26, t + 1.8);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 2.5);
    const n = noiseSrc(t, 1.6); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t); lp.frequency.exponentialRampToValueAtTime(160, t + 1.2);
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.7 * vol, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    n.connect(lp); lp.connect(ng); ng.connect(master); send(ng, 1.2);
  }
  function riser(t, dur, vol = 0.32) {
    const n = noiseSrc(t, dur); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur);
    g.gain.setValueAtTime(0.0001, t + dur + 0.01);
    n.connect(bp); bp.connect(g); g.connect(master); send(g, 0.4);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; const og = ctx.createGain();
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(880, t + dur);
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(vol * 0.12, t + dur); og.gain.setValueAtTime(0.0001, t + dur + 0.01);
    const olp = ctx.createBiquadFilter(); olp.type = 'lowpass'; olp.frequency.value = 2500;
    o.connect(olp); olp.connect(og); og.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function whoosh(t, vol = 0.22) {
    const d = 0.42; const n = noiseSrc(t - d, d + 0.2); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(350, t - d); bp.frequency.exponentialRampToValueAtTime(4200, t);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t - d); g.gain.exponentialRampToValueAtTime(vol, t - 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    const p = ctx.createStereoPanner(); p.pan.setValueAtTime(-0.7, t - d); p.pan.linearRampToValueAtTime(0.7, t + 0.1);
    n.connect(bp); bp.connect(g); g.connect(p); p.connect(master);
  }

  // ================================================================ arrangement
  const chord = (bar) => CHORDS[PROG[Math.min(bar, PROG.length - 1)]];

  // Intro (bars 0-5): pad swells, plucks, hats creeping in.
  pad(T(0), BAR * 2, CHORDS.Fm.pad, 300, 1100, 0.045);
  pad(T(2), BAR * 2, CHORDS.Db.pad, 500, 1300, 0.05);
  pad(T(4), BAR, CHORDS.Bbm.pad, 600, 1600, 0.055);
  pad(T(5), BAR, CHORDS.C.pad, 800, 2400, 0.06);
  impact(T(0), 0.55);
  const motif = [0, 2, 1, 3, 2, 1, 0, 2];
  for (let bar = 0; bar < 6; bar++) {
    const c = chord(bar);
    motif.forEach((m, i) => { if (bar < 2 && i % 2) return; pluck(T(bar, i * 0.5), c.pad[m] * 2, bar < 2 ? 0.11 : 0.14); });
    if (bar >= 2) for (let b = 0; b < 4; b++) hat(T(bar, b), 0.12);
    if (bar >= 4) for (let b = 0; b < 4; b++) hat(T(bar, b + 0.5), 0.09);
  }
  whoosh(T(2), 0.18); whoosh(T(4), 0.2);
  sub808(T(2), CHORDS.Db.root, BAR * 0.9, 0.4);
  sub808(T(4), CHORDS.Bbm.root, BAR * 0.9, 0.42);
  sub808(T(5), CHORDS.C.root, BAR * 0.5, 0.42);
  // snare roll building into the title hit
  for (let i = 0; i < 16; i++) { const s = i / 16; snare(T(5, 2 + i * 0.125), 0.18 + s * 0.6); }
  riser(T(4), BAR * 2, 0.34);

  // Title (bar 6): braam + impact, no drums, reverse swell into the drop.
  impact(T(6), 1); braam(T(6), 0.24); crash(T(6), 0.28);
  pad(T(6), BAR, CHORDS.Fm.pad, 1800, 500, 0.04);
  riser(T(6, 2), BEAT * 2, 0.22);

  // Drop (bars 7-14): half-time trap groove, one chord per bar.
  for (let bar = 7; bar < 15; bar++) {
    const c = chord(bar);
    if (bar === 7 || bar === 11) crash(T(bar), 0.3);
    kick(T(bar, 0)); sub808(T(bar, 0), c.root, BEAT * 1.4);
    sub808(T(bar, 1.5), c.root, BEAT * 0.9, 0.8);
    kick(T(bar, 2.5), 0.8); sub808(T(bar, 2.5), c.root * (bar % 2 ? 1.5 : 1), BEAT * 1.3, 0.85);
    snare(T(bar, 2), 1);
    if (bar % 2 === 0) snare(T(bar, 3.75), 0.35);
    // hats: 8ths with rolls
    for (let s = 0; s < 8; s++) {
      const beat = s * 0.5;
      if (bar % 2 === 1 && s === 6) { for (let r = 0; r < 6; r++) hat(T(bar, 3 + r / 6), 0.1 + r * 0.025); continue; }
      if (bar % 2 === 1 && s === 7) continue;
      if (bar % 4 === 2 && s === 5) { for (let r = 0; r < 4; r++) hat(T(bar, 2.5 + r * 0.125), 0.14); continue; }
      hat(T(bar, beat), s % 2 ? 0.13 : 0.2);
    }
    if (bar % 2 === 0) hat(T(bar, 1.5), 0.08, true);
    pad(T(bar), BAR, c.pad, 900, 1500, 0.04);
    motif.forEach((m, i) => pluck(T(bar, i * 0.5), c.pad[(m + (bar % 2)) % 4] * 2, 0.1));
    if (bar > 7) whoosh(T(bar), 0.16);
  }

  // Breakdown (bar 15): drums drop out, riser into the end card.
  pad(T(15), BAR, CHORDS.Db.pad, 2400, 600, 0.05);
  for (let b = 0; b < 4; b++) pluck(T(15, b), CHORDS.Db.pad[b % 4] * 2, 0.12);
  riser(T(15), BAR - 0.05, 0.4);
  sub808(T(15), CHORDS.Db.root, BAR * 0.8, 0.5);

  // End card (bars 16-18): final hit, long 808, sustained chord.
  impact(T(16), 1); braam(T(16), 0.2); crash(T(16), 0.3);
  kick(T(16)); sub808(T(16), CHORDS.Fm.root, BAR * 1.8, 0.8);
  pad(T(16), BAR * 2.4, CHORDS.Fm.pad, 1600, 500, 0.05);
  [0, 2, 1, 3].forEach((m, i) => pluck(T(16, 1 + i), CHORDS.Fm.pad[m] * 2, 0.1));
  hat(T(17, 0), 0.08, true);

  return DURATION;
}

// Render the whole cue offline and encode it as a 16-bit stereo WAV.
export async function renderWav(sampleRate = 48000) {
  const ctx = new OfflineAudioContext(2, Math.ceil(DURATION * sampleRate), sampleRate);
  buildMusic(ctx, ctx.destination, 0.05);
  const buf = await ctx.startRendering();
  const n = buf.length, L = buf.getChannelData(0), R = buf.getChannelData(1);
  const out = new DataView(new ArrayBuffer(44 + n * 4));
  const str = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, sampleRate, true); out.setUint32(28, sampleRate * 4, true);
  out.setUint16(32, 4, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * 4, true);
  for (let i = 0, o = 44; i < n; i++, o += 4) {
    out.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    out.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  return new Uint8Array(out.buffer);
}
