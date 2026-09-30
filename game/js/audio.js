// WebAudio synth: gunfire, explosions, engine, siren and three procedural
// radio stations (Dallas country, New Orleans brass band, Atlanta trap).

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export const STATIONS = [
  { name: 'KBIG 97.3', sub: 'Lone Star Twang', color: '#ffb347' },
  { name: 'WNOLA 88.9', sub: 'Second Line Brass', color: '#b48cff' },
  { name: 'HOT 404', sub: 'Peach State Trap', color: '#ff6b6b' },
  { name: 'RADIO OFF', sub: '', color: '#999' },
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.station = 2;
    this.musicOn = false;
    this.step = 0;
    this.nextTime = 0;
    this.enabled = true;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 0; this.music.connect(this.master);
    // noise buffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // engine
    this.engOsc = ctx.createOscillator(); this.engOsc.type = 'sawtooth';
    this.engOsc2 = ctx.createOscillator(); this.engOsc2.type = 'square';
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 600;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engOsc.connect(this.engFilter); this.engOsc2.connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.sfx);
    this.engOsc.start(); this.engOsc2.start();
    // rotor (chopped noise)
    this.rotorSrc = this.loopNoise();
    this.rotorFilter = ctx.createBiquadFilter(); this.rotorFilter.type = 'lowpass'; this.rotorFilter.frequency.value = 500;
    this.rotorAM = ctx.createGain(); this.rotorAM.gain.value = 0;
    this.rotorLfo = ctx.createOscillator(); this.rotorLfo.frequency.value = 14;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.5;
    this.rotorLfo.connect(lfoGain).connect(this.rotorAM.gain);
    this.rotorOut = ctx.createGain(); this.rotorOut.gain.value = 0;
    this.rotorSrc.connect(this.rotorFilter).connect(this.rotorAM).connect(this.rotorOut).connect(this.sfx);
    this.rotorLfo.start();
    // tyre screech
    this.screechSrc = this.loopNoise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 8;
    this.screechGain = ctx.createGain(); this.screechGain.gain.value = 0;
    this.screechSrc.connect(bp).connect(this.screechGain).connect(this.sfx);
    // siren
    this.sirenOsc = ctx.createOscillator(); this.sirenOsc.type = 'square';
    this.sirenLfo = ctx.createOscillator(); this.sirenLfo.frequency.value = 0.9;
    const sl = ctx.createGain(); sl.gain.value = 350;
    this.sirenOsc.frequency.value = 900;
    this.sirenLfo.connect(sl).connect(this.sirenOsc.frequency);
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 2200;
    this.sirenGain = ctx.createGain(); this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(sf).connect(this.sirenGain).connect(this.sfx);
    this.sirenOsc.start(); this.sirenLfo.start();
    // horn
    this.hornGain = ctx.createGain(); this.hornGain.gain.value = 0;
    const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 1500;
    for (const f of [349, 440]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(hf); o.start(); }
    hf.connect(this.hornGain).connect(this.sfx);
    // wind (for skydiving / speed)
    this.windSrc = this.loopNoise();
    const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 800;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    this.windSrc.connect(wf).connect(this.windGain).connect(this.sfx);
    this.nextTime = ctx.currentTime + 0.1;
    this.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 3); }
    this.shaper.curve = curve;
    this.shaper.connect(this.music);
  }

  loopNoise() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true; s.start();
    return s;
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  noiseHit(t, dur, freq, type, gain, dest, q = 1, sweepTo) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(dest || this.sfx);
    s.start(t, Math.random() * Math.max(0, 1.9 - dur)); s.stop(t + dur + 0.05);
  }

  tone(t, freq, dur, type, gain, dest, opts = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + (opts.glide || dur));
    if (opts.detune) o.detune.value = opts.detune;
    const g = ctx.createGain();
    const a = opts.attack || 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (opts.lp) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(opts.lp, t);
      if (opts.lpTo) f.frequency.exponentialRampToValueAtTime(opts.lpTo, t + dur);
      f.Q.value = opts.q || 1;
      node = o.connect(f);
    }
    node.connect(g).connect(dest || this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  distGain(dist) { return Math.max(0, 1 - dist / 260); }

  // ------------------------------------------------------------------ sfx
  shot(kind, dist = 0) {
    if (!this.ctx) return;
    const t = this.t, k = this.distGain(dist);
    if (k <= 0) return;
    switch (kind) {
      case 'pistol': this.noiseHit(t, 0.18, 2600, 'lowpass', 0.8 * k); this.tone(t, 180, 0.08, 'sine', 0.5 * k, null, { to: 60 }); this.noiseHit(t + 0.02, 0.5, 900, 'lowpass', 0.12 * k); break;
      case 'smg': this.noiseHit(t, 0.09, 3200, 'lowpass', 0.55 * k); this.tone(t, 150, 0.05, 'sine', 0.35 * k, null, { to: 60 }); break;
      case 'shotgun': this.noiseHit(t, 0.4, 1800, 'lowpass', 1.0 * k, null, 1, 300); this.tone(t, 120, 0.2, 'sine', 0.8 * k, null, { to: 40 }); break;
      case 'minigun': this.noiseHit(t, 0.05, 3500, 'lowpass', 0.4 * k); break;
      case 'rpg': this.noiseHit(t, 0.7, 800, 'bandpass', 0.8 * k, null, 2, 3000); break;
      case 'cannon': this.noiseHit(t, 0.8, 900, 'lowpass', 1.2 * k, null, 1, 80); this.tone(t, 90, 0.4, 'sine', 1 * k, null, { to: 30 }); break;
      case 'punch': this.noiseHit(t, 0.08, 900, 'lowpass', 0.5 * k); this.tone(t, 120, 0.08, 'sine', 0.4 * k, null, { to: 70 }); break;
      case 'empty': this.tone(t, 1600, 0.03, 'square', 0.1); break;
    }
  }

  // magazine out / in / slide release, timed to the reload animation
  reload(kind) {
    if (!this.ctx) return;
    const t = this.t;
    const click = (at, f, g) => { this.noiseHit(t + at, 0.05, f, 'bandpass', g, null, 4); this.tone(t + at, f / 3, 0.03, 'square', g * 0.15); };
    if (kind === 'shotgun') {
      for (let i = 0; i < 4; i++) click(0.3 + i * 0.5, 1800, 0.25);
      click(2.3, 900, 0.4); click(2.45, 1200, 0.4);
    } else if (kind === 'rpg') {
      click(0.5, 700, 0.35); click(1.6, 900, 0.4);
    } else {
      const d = kind === 'smg' ? 1.9 : 1.4;
      click(d * 0.2, 1400, 0.3); click(d * 0.6, 1100, 0.35); click(d * 0.85, 2200, 0.4);
    }
  }

  footstep(k = 0.5) {
    if (!this.ctx) return;
    const t = this.t;
    this.noiseHit(t, 0.07, 500 + Math.random() * 300, 'lowpass', 0.12 * k);
    this.noiseHit(t + 0.01, 0.04, 2500 + Math.random() * 1500, 'bandpass', 0.03 * k, null, 2);
  }

  explosion(dist = 0, big = 1) {
    if (!this.ctx) return;
    const t = this.t, k = Math.max(0, 1 - dist / 600) * big;
    if (k <= 0) return;
    this.noiseHit(t, 1.8, 2000, 'lowpass', 1.2 * k, null, 1, 60);
    this.tone(t, 70, 1.2, 'sine', 1.2 * k, null, { to: 25 });
    this.noiseHit(t + 0.05, 0.5, 400, 'lowpass', 0.8 * k);
  }

  crash(impact, dist = 0) {
    if (!this.ctx) return;
    const t = this.t, k = Math.min(1, impact / 25) * this.distGain(dist);
    if (k <= 0.02) return;
    this.noiseHit(t, 0.35, 1200, 'lowpass', 0.9 * k, null, 1, 200);
    this.tone(t, 220 + Math.random() * 200, 0.25, 'triangle', 0.35 * k, null, { to: 90 });
    this.tone(t, 1100 + Math.random() * 600, 0.15, 'square', 0.06 * k, null, { lp: 3000 });
  }

  scream(x, z) {
    if (!this.ctx) return;
    const t = this.t;
    const f = 700 + Math.random() * 400;
    this.tone(t, f, 0.6, 'sawtooth', 0.06, null, { to: f * 1.3, glide: 0.2, lp: 2500 });
  }

  pickup() { if (!this.ctx) return; const t = this.t; [72, 76, 79, 84].forEach((m, i) => this.tone(t + i * 0.06, mtof(m), 0.2, 'square', 0.12, null, { lp: 3000 })); }
  cash() { if (!this.ctx) return; const t = this.t; this.tone(t, mtof(84), 0.1, 'square', 0.1, null, { lp: 4000 }); this.tone(t + 0.07, mtof(91), 0.25, 'square', 0.1, null, { lp: 4000 }); }
  star() { if (!this.ctx) return; const t = this.t; this.tone(t, 880, 0.12, 'square', 0.1, null, { lp: 3000 }); this.tone(t + 0.1, 660, 0.18, 'square', 0.1, null, { lp: 3000 }); }
  ui() { if (!this.ctx) return; this.tone(this.t, 1200, 0.05, 'square', 0.06, null, { lp: 4000 }); }
  cheat() { if (!this.ctx) return; const t = this.t; [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => this.tone(t + i * 0.04, mtof(m), 0.25, 'sawtooth', 0.08, null, { lp: 3500 })); }
  passed() {
    if (!this.ctx) return;
    const t = this.t;
    const seq = [[60, 64, 67], [65, 69, 72], [67, 71, 74], [72, 76, 79, 84]];
    seq.forEach((ch, i) => ch.forEach((m) => this.tone(t + i * 0.22, mtof(m), i === 3 ? 1.4 : 0.3, 'sawtooth', 0.07, null, { lp: 2500, attack: 0.02 })));
    this.noiseHit(t + 0.66, 0.8, 8000, 'highpass', 0.2);
  }
  wasted() {
    if (!this.ctx) return;
    const t = this.t;
    this.tone(t, 110, 3, 'sawtooth', 0.25, null, { to: 40, glide: 3, lp: 600 });
    this.tone(t, 55, 3, 'sine', 0.5, null, { to: 30, glide: 3 });
    this.noiseHit(t, 2.5, 600, 'lowpass', 0.4, null, 1, 60);
  }
  checkpoint() { if (!this.ctx) return; const t = this.t; this.tone(t, mtof(79), 0.15, 'square', 0.1, null, { lp: 3000 }); this.tone(t + 0.08, mtof(86), 0.2, 'square', 0.1, null, { lp: 3000 }); }

  // continuous sounds, called every frame
  setEngine(on, rpm, load, kind = 'car') {
    if (!this.ctx) return;
    const t = this.t;
    const base = kind === 'bike' ? 70 : kind === 'tank' ? 28 : kind === 'truck' ? 38 : 45;
    const f = base + rpm * (kind === 'bike' ? 220 : 150);
    this.engOsc.frequency.setTargetAtTime(f, t, 0.05);
    this.engOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(300 + load * 1400 + rpm * 600, t, 0.08);
    this.engGain.gain.setTargetAtTime(on ? 0.1 + load * 0.08 : 0, t, 0.1);
  }
  setRotor(level) { if (!this.ctx) return; this.rotorOut.gain.setTargetAtTime(level * 0.9, this.t, 0.2); this.rotorLfo.frequency.setTargetAtTime(6 + level * 10, this.t, 0.3); }
  setScreech(v) { if (!this.ctx) return; this.screechGain.gain.setTargetAtTime(Math.min(0.12, v), this.t, 0.05); }
  setSiren(v) { if (!this.ctx) return; this.sirenGain.gain.setTargetAtTime(Math.min(0.08, v * 0.08), this.t, 0.2); }
  setHorn(on) { if (!this.ctx) return; this.hornGain.gain.setTargetAtTime(on ? 0.12 : 0, this.t, 0.02); }
  setWind(v) { if (!this.ctx) return; this.windGain.gain.setTargetAtTime(Math.min(0.3, v), this.t, 0.2); }

  // ------------------------------------------------------------------ radio
  setMusicAudible(on) {
    if (!this.ctx) return;
    this.musicOn = on && this.station !== 3;
    this.music.gain.setTargetAtTime(this.musicOn ? 0.55 : 0, this.t, 0.4);
  }

  nextStation() {
    this.station = (this.station + 1) % STATIONS.length;
    this.step = 0;
    if (this.ctx) this.nextTime = this.t + 0.05;
    this.chordSeed = Math.random();
    return STATIONS[this.station];
  }

  updateMusic() {
    if (!this.ctx || this.station === 3) return;
    const tempo = [112, 100, 140][this.station];
    const stepDur = 60 / tempo / 4;
    while (this.nextTime < this.t + 0.2) {
      if (this.nextTime < this.t - 0.1) this.nextTime = this.t + 0.02;
      if (this.musicOn) {
        if (this.station === 0) this.country(this.step, this.nextTime, stepDur);
        else if (this.station === 1) this.brass(this.step, this.nextTime, stepDur);
        else this.trap(this.step, this.nextTime, stepDur);
      }
      this.nextTime += stepDur;
      this.step++;
    }
  }

  // drum kit
  kick(t, v = 1) { this.tone(t, 150, 0.25, 'sine', 0.9 * v, this.music, { to: 42, glide: 0.1 }); }
  snare(t, v = 1) { this.noiseHit(t, 0.16, 1800, 'highpass', 0.35 * v, this.music); this.tone(t, 190, 0.08, 'triangle', 0.25 * v, this.music); }
  clap(t, v = 1) { for (let i = 0; i < 3; i++) this.noiseHit(t + i * 0.012, 0.12 + i * 0.03, 1300, 'bandpass', 0.4 * v, this.music, 1.2); }
  hat(t, v = 1, open = false) { this.noiseHit(t, open ? 0.22 : 0.035, 8000, 'highpass', 0.13 * v, this.music); }
  ride(t, v = 1) { this.noiseHit(t, 0.3, 6000, 'bandpass', 0.09 * v, this.music, 2); }
  brush(t, v = 1) { this.noiseHit(t, 0.12, 3500, 'bandpass', 0.12 * v, this.music, 0.8); }

  country(step, t, sd) {
    const bar = Math.floor(step / 16) % 4, s = step % 16;
    const prog = [55, 60, 62, 55]; // G C D G
    const root = prog[bar];
    if (s === 0 || s === 8) this.kick(t, 0.7);
    if (s === 4 || s === 12) this.brush(t, 1.2);
    if (s % 2 === 0) this.hat(t, 0.4);
    if (s === 0) this.tone(t, mtof(root - 24), sd * 3.5, 'triangle', 0.5, this.music, { lp: 600 });
    if (s === 8) this.tone(t, mtof(root - 17), sd * 3.5, 'triangle', 0.5, this.music, { lp: 600 });
    if (s === 6) this.tone(t, mtof(root - 20), sd * 1.5, 'triangle', 0.35, this.music, { lp: 600 });
    if (s === 4 || s === 12 || s === 14) {
      [0, 4, 7, 12].forEach((iv, i) => this.tone(t + i * 0.012, mtof(root + iv), sd * 3, 'sawtooth', 0.045, this.music, { lp: 2200, lpTo: 500 }));
    }
    // twangy lead (G major pentatonic)
    const pent = [0, 2, 4, 7, 9, 12, 14, 16];
    if ((s % 2 === 0 && Math.random() < 0.45) || s === 0) {
      const n = 67 + pent[Math.floor(Math.random() * pent.length)];
      this.tone(t, mtof(n - 1), sd * 2.5, 'square', 0.05, this.music, { to: mtof(n), glide: 0.05, lp: 2400, lpTo: 900 });
    }
  }

  brass(step, t, sd) {
    const swing = (step % 2) ? sd * 0.3 : 0;
    t += swing;
    const bar = Math.floor(step / 16) % 4, s = step % 16;
    const prog = [46, 51, 46, 53]; // Bb Eb Bb F
    const root = prog[bar];
    // second line drums
    if (s === 0 || s === 6 || s === 10) this.kick(t, 0.8);
    if (s === 4 || s === 12) this.snare(t, 1);
    else if (s % 2 === 1 && Math.random() < 0.5) this.snare(t, 0.25);
    if (s % 2 === 0) this.ride(t, 0.8);
    // tuba
    const tuba = { 0: 0, 3: 7, 6: 12, 8: 0, 10: 4, 12: 7, 14: 10 };
    if (tuba[s] !== undefined) this.tone(t, mtof(root - 12 + tuba[s]), sd * 1.8, 'sawtooth', 0.22, this.music, { lp: 500, attack: 0.02 });
    // horn riffs: call and response on bars
    const blues = [0, 3, 5, 6, 7, 10, 12];
    if (bar % 2 === 0 && (s === 2 || s === 5 || s === 7 || s === 10)) {
      const n = 70 + blues[Math.floor(Math.random() * blues.length)];
      this.tone(t, mtof(n), sd * 1.6, 'sawtooth', 0.09, this.music, { lp: 600, lpTo: 2600, attack: 0.02 });
      this.tone(t, mtof(n), sd * 1.6, 'sawtooth', 0.06, this.music, { lp: 600, lpTo: 2400, attack: 0.02, detune: 12 });
    }
    if (bar % 2 === 1 && (s === 0 || s === 3 || s === 6)) {
      [0, 4, 7, 10].forEach((iv) => this.tone(t, mtof(root + 12 + iv), sd * 2.2, 'sawtooth', 0.04, this.music, { lp: 800, lpTo: 2000, attack: 0.03 }));
    }
  }

  trap(step, t, sd) {
    const bar = Math.floor(step / 16) % 4, s = step % 16;
    const roots = [36, 32, 39, 31]; // C Ab Eb G
    const root = roots[bar];
    if (s === 0 || (s === 10 && bar % 2 === 0) || s === 7 && bar === 3) {
      // 808
      const dur = s === 0 ? sd * 7 : sd * 4;
      this.tone(t, mtof(root + 12), dur, 'sine', 0.7, this.shaper, { to: mtof(root), glide: 0.06 });
      this.kick(t, 0.8);
    }
    if (s === 8) { this.clap(t, 1); this.snare(t, 0.5); }
    // hats: 8ths with rolls
    if (s % 2 === 0) this.hat(t, 0.8);
    if ((s === 13 || s === 14 || s === 15) && bar % 2 === 1) {
      for (let k = 0; k < 3; k++) this.hat(t + k * sd / 3, 0.6);
    } else if (s % 2 === 1 && Math.random() < 0.25) this.hat(t, 0.4);
    if (s === 6 && Math.random() < 0.4) this.hat(t, 0.5, true);
    // dark bell melody (C minor)
    const minor = [0, 3, 7, 10, 12, 15, 19];
    if (s % 4 === 0 || (s % 2 === 0 && Math.random() < 0.3)) {
      const n = 72 + minor[(Math.floor(step / 2) * 3 + bar) % minor.length];
      this.tone(t, mtof(n), sd * 3, 'sine', 0.08, this.music);
      this.tone(t, mtof(n) * 2.76, sd * 1.2, 'sine', 0.025, this.music);
    }
    if (s === 0) [0, 3, 7].forEach((iv) => this.tone(t, mtof(root + 36 + iv), sd * 15, 'sawtooth', 0.012, this.music, { lp: 700, attack: 0.3 }));
  }
}
