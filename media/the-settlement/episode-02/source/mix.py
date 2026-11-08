"""Score, sound design and dialogue mix for The Settlement, Episode 2, following timeline.json.
Ambiences and foley are AudioLDM2 generations (sfx/*.wav); impacts, risers, phone sounds, heartbeat and the whole score
are synthesised here. Usage: mix.py ROOT OUT_DIR"""
import json, sys
import numpy as np
from scipy import signal
from scipy.io import wavfile
import soundfile as sf

ROOT, OUT = sys.argv[1:3]
SFX = f"{ROOT}/sfx"
TL = json.load(open(f"{OUT}/timeline.json"))
SR = 48000
T = TL["total"]
N = int(SR * T) + SR
rng = np.random.default_rng(22)
music, fx, voice = (np.zeros((N, 2)) for _ in range(3))
shots = TL["shots"]
t_ = lambda n: np.arange(n) / SR
note = lambda m: 440 * 2 ** ((m - 69) / 12)


def add(buf, x, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if x.ndim == 1:
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        x = np.stack([x * l * 1.414, x * r * 1.414], 1)
    j = min(N, i + len(x))
    if j > i >= 0:
        buf[i:j] += x[: j - i] * gain


def filt(kind, x, f, o=2):
    b, a = signal.butter(o, np.array(f) / (SR / 2), kind)
    return signal.lfilter(b, a, x, axis=0)


lp = lambda x, f, o=2: filt("low", x, f, o)
hp = lambda x, f, o=2: filt("high", x, f, o)
bp = lambda x, lo, hi, o=2: filt("band", x, [lo, hi], o)


def saw(f, n, detune=0.0):
    ph = np.cumsum(np.full(n, f * (1 + detune)) / SR) if np.isscalar(f) else np.cumsum(f * (1 + detune) / SR)
    return 2 * (ph % 1) - 1


def env(n, a, r):
    e = np.ones(n)
    na, nr = min(n, int(a * SR)), min(n, int(r * SR))
    if na:
        e[:na] = np.linspace(0, 1, na) ** 2
    if nr:
        e[-nr:] *= np.linspace(1, 0, nr) ** 1.5
    return e


_IR = {}


def reverb(x, secs=2.5, wet=0.3):
    if secs not in _IR:
        n = int(secs * SR)
        ir = lp(rng.standard_normal((n, 2)) * np.exp(-np.linspace(0, 7, n))[:, None], 6000)
        _IR[secs] = ir / np.abs(ir).sum(0).max() * 6
    ir = _IR[secs]
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    y = np.stack([signal.fftconvolve(x[:, c], ir[:, c]) for c in range(2)], 1)
    dry = np.vstack([x, np.zeros((len(y) - len(x), 2))])
    return dry * (1 - wet) + y * wet


# ── Score instruments ─────────────────────────────────────────
def drone(start, end, root=38, gain=0.7, bright=450, minor=True):
    n = int((end - start) * SR)
    if n <= 0:
        return
    t = t_(n)
    x = np.zeros(n)
    for m, g in [(root - 12, 1.0), (root, 0.7), (root + (3 if minor else 4), 0.35), (root + 7, 0.45)]:
        for d in (-0.003, 0.0, 0.004):
            x += saw(note(m), n, d) * g
    a, b = lp(x, bright * 0.6), lp(x, bright * 1.6)
    w = np.clip(0.5 + 0.5 * np.sin(2 * np.pi * 0.06 * t), 0, 1)
    y = (a * (1 - w) + b * w) * env(n, 3.0, 3.0) / 12
    add(music, np.stack([y * (1 + 0.1 * np.sin(0.7 * t)), y * (1 - 0.1 * np.sin(0.7 * t))], 1), start, gain)


def strings(start, end, chord, gain=0.3, bright=1800):
    """A soft string pad: detuned saws through a gentle low-pass with slow vibrato."""
    n = int((end - start) * SR)
    if n <= 0:
        return
    t = t_(n)
    x = np.zeros(n)
    for m in chord:
        vib = 1 + 0.003 * np.sin(2 * np.pi * 5.2 * t + rng.uniform(0, 6))
        for d in (-0.004, 0.0, 0.005):
            x += saw(note(m) * vib, n, d)
    y = lp(x, bright, 3) * env(n, 2.5, 2.5) / (len(chord) * 6)
    add(music, reverb(y, 3.0, 0.4), start, gain)


def piano(m, at, gain=0.2, dur=4.0):
    n = int(dur * SR)
    t = t_(n)
    f = note(m)
    x = sum(np.sin(2 * np.pi * f * k * t * (1 + 0.0004 * k * k)) * np.exp(-t * (1.2 + 0.9 * k)) / k ** 1.3 for k in range(1, 7))
    x = lp(x * np.minimum(1, t / 0.004), 2600)
    add(music, reverb(x, 3.0, 0.45), at, gain, pan=rng.uniform(-0.3, 0.3))


def thump(at, gain=0.6):
    n = int(0.35 * SR)
    t = t_(n)
    x = np.sin(2 * np.pi * np.cumsum(55 * np.exp(-t * 6) + 38) / SR) * np.exp(-t * 14)
    add(music, lp(x, 180), at, gain)


def tick(at, gain=0.07, f=3200):
    n = int(0.03 * SR)
    add(music, bp(rng.standard_normal(n), f * 0.8, f * 1.2) * np.exp(-t_(n) * 220), at, gain, pan=0.25)


def boom(at, gain=1.0, length=4.0):
    n = int(length * SR)
    t = t_(n)
    sub = np.sin(2 * np.pi * np.cumsum(70 * np.exp(-t * 3) + 30) / SR) * np.exp(-t * 1.6)
    x = np.tanh((sub * 1.4 + hp(rng.standard_normal(n), 900) * np.exp(-t * 30) * 0.5 + lp(rng.standard_normal(n), 400) * np.exp(-t * 4) * 0.8) * 1.3)
    add(fx, reverb(x, 4.0, 0.35), at, gain * 0.5)


def braam(at, gain=1.0, length=3.5, root=26):
    n = int(length * SR)
    t = t_(n)
    x = sum(saw(note(m), n, d) for m in (root, root + 12, root + 19) for d in (-0.006, 0, 0.007))
    y = lp(x, 260) * (1 - np.exp(-t * 4)) + lp(x, 1400) * np.exp(-t * 1.6) * (1 - np.exp(-t * 30))
    add(fx, reverb(np.tanh(y * 0.5) * env(n, 0.02, 1.6), 3.5, 0.3), at, gain * 0.3)


def whoosh(at, length=1.3, gain=0.22):
    n = int(length * SR)
    t = t_(n)
    x = bp(rng.standard_normal(n), 400, 5000) * (t / length) ** 2.5
    add(fx, np.stack([x * np.linspace(0.6, 1.2, n), x * np.linspace(1.2, 0.6, n)], 1), at, gain)


def riser(at, length, gain=0.35):
    n = int(length * SR)
    t = t_(n)
    f = 80 * 2 ** (t / length * 4)
    x = (np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.4 + saw(f * 1.5, n) * 0.15 + hp(rng.standard_normal(n), 2000) * 0.5) * (t / length) ** 2
    add(fx, reverb(x, 2.0, 0.25), at, gain)


# ── Synthesised effects ───────────────────────────────────────
def synth(name):
    if name == "heartbeat":  # lub-dub x6, ~62 bpm
        n = int(6 * SR); x = np.zeros(n)
        for b in range(6):
            for off, g in ((0.0, 1.0), (0.28, 0.7)):
                i = int((b * 0.97 + off) * SR); m = int(0.18 * SR); tt = t_(m)
                x[i:i + m] += np.sin(2 * np.pi * (48 + 20 * np.exp(-tt * 30)) * tt) * np.exp(-tt * 22) * g
        return lp(x, 140) * 1.6
    if name == "phonebuzz":  # vibrating phone in a box
        n = int(3 * SR); t = t_(n)
        gate = ((t % 1.0) < 0.55).astype(float)
        x = np.sign(np.sin(2 * np.pi * 168 * t)) * (0.6 + 0.4 * np.sin(2 * np.pi * 7 * t))
        return bp(x, 120, 2400) * lp(gate, 40) * 0.5
    if name == "thunder":
        n = int(6 * SR); t = t_(n)
        x = lp(rng.standard_normal(n), 220, 3) * (np.exp(-t * 0.7) * (1 - np.exp(-t * 6)))
        x += lp(rng.standard_normal(n), 900) * np.exp(-((t - 0.4) ** 2) * 20) * 0.4
        return x * 3
    if name == "dial":  # keypad beeps (DTMF)
        keys = [(697, 1209), (770, 1336), (852, 1477), (697, 1336), (941, 1336), (770, 1209), (852, 1336)]
        out = []
        for lo, hi in keys:
            m = int(0.09 * SR); tt = t_(m)
            out += [(np.sin(2 * np.pi * lo * tt) + np.sin(2 * np.pi * hi * tt)) * 0.3 * env(m, 0.003, 0.01), np.zeros(int(0.07 * SR))]
        return bp(np.concatenate(out), 300, 3400)
    if name == "ring":  # US ringback heard through a phone speaker
        m = int(2.0 * SR); tt = t_(m)
        x = (np.sin(2 * np.pi * 440 * tt) + np.sin(2 * np.pi * 480 * tt)) * 0.25 * env(m, 0.01, 0.02)
        return bp(x, 300, 3400)
    if name == "hangup":  # click, then the three-tone call-ended beep
        click = hp(rng.standard_normal(int(0.02 * SR)), 1500) * np.exp(-t_(int(0.02 * SR)) * 200)
        tones = [np.sin(2 * np.pi * f * t_(int(0.25 * SR))) * 0.3 * env(int(0.25 * SR), 0.005, 0.02) for f in (950, 1400, 1800)]
        return bp(np.concatenate([click, np.zeros(int(0.5 * SR))] + tones), 300, 3400)
    if name == "breath":  # breathing on the line, close-mic
        n = int(3 * SR); t = t_(n)
        e = np.clip(np.sin(2 * np.pi * 0.45 * t), 0, 1) ** 2
        return bp(rng.standard_normal(n), 300, 2600) * e * 0.35
    if name == "slide":  # a phone slid across a cafe table
        n = int(0.9 * SR); t = t_(n)
        x = bp(rng.standard_normal(n), 600, 5000) * np.sin(np.pi * t / 0.9) ** 0.7 * (1 + 0.3 * np.sin(2 * np.pi * 60 * t))
        tap = lp(rng.standard_normal(int(0.04 * SR)), 1500) * np.exp(-t_(int(0.04 * SR)) * 120) * 3
        return np.concatenate([x * 0.5, tap])
    if name == "laugh_db":
        n = int(0.3 * SR); tt = t_(n)
        return np.sin(2 * np.pi * 900 * tt) * env(n, 0.005, 0.1) * 0.2
    return None


_SFX = {}


def sfx(name):
    if name not in _SFX:
        x = synth(name)
        if x is None:
            x, sr = sf.read(f"{SFX}/{name}.wav")
            x = x.mean(1) if x.ndim > 1 else x
            x = signal.resample_poly(x, SR, sr)
            x = hp(x, 35)
        fade = int(0.02 * SR)
        x[:fade] *= np.linspace(0, 1, fade)
        x[-fade * 5:] *= np.linspace(1, 0, fade * 5)
        rms, peak = np.sqrt(np.mean(x ** 2)) + 1e-9, np.abs(x).max() + 1e-9
        _SFX[name] = x * min(0.12 / rms, 0.6 / peak)
    return _SFX[name]


IMPACT = {"impact", "riser", "whoosh"}
BED_GAIN = {"rain": 0.5, "wind": 0.4, "bus": 0.45, "hum": 0.3, "prison": 0.35, "cicadas": 0.35, "night": 0.4,
            "morning": 0.35, "lobby": 0.4, "cafe": 0.4, "phone": 0.0}


def bed(name, start, end):
    """Loop an ambience under a stretch of the film with crossfades."""
    if BED_GAIN.get(name, 0.4) == 0:
        return
    x, n = sfx(name), int((end - start) * SR)
    xf = int(1.0 * SR)
    out, pos = np.zeros(n + len(x)), 0
    ramp = np.linspace(0, 1, xf)
    while pos < n:
        seg = x.copy()
        seg[:xf] *= ramp
        seg[-xf:] *= ramp[::-1]
        out[pos:pos + len(seg)] += seg
        pos += len(seg) - xf
    out = out[:n] * env(n, 0.6, 0.8)
    add(fx, np.stack([out, np.roll(out, int(0.013 * SR))], 1), start, BED_GAIN.get(name, 0.4))


for name in sorted({b for s in shots for b in s.get("bed", [])}):
    run = None
    for s in shots + [None]:
        on = s is not None and name in s.get("bed", [])
        if on and run is None:
            run = s["start"]
        elif not on and run is not None:
            bed(name, max(0.0, run - 0.3), s["start"] + 0.4 if s else T)
            run = None

for s in shots:
    for item in s.get("sfx", []):
        name, off, gain = item[:3]
        pan = item[3] if len(item) > 3 else 0.0
        at = s["start"] + off
        if name == "impact":
            boom(at, gain * 1.1, 4.0)
        elif name == "riser":
            riser(at, max(1.5, s["dur"] - off), gain * 0.5)
        elif name == "whoosh":
            whoosh(at, 1.2, gain * 0.4)
        elif name == "laugh_low":
            pass  # placed with the voices
        elif name in ("ring", "dial", "hangup", "breath"):
            add(fx, sfx(name), at, gain * 0.8, pan)
        else:
            add(fx, sfx(name), at, gain, pan)

# ── Score by mood ─────────────────────────────────────────────
def first(m):
    return next(s for s in shots if s.get("mood") == m)


def span(m, nxt):
    return first(m)["start"], first(nxt)["start"]


black = next(s for s in shots if s["kind"] == "black")
END = black["start"]
flash = next(s for s in shots if s.get("flash"))
# Cold open (dread): low drone, heartbeat pulse.
a, b = span("dread", "cold")
drone(0.2, b + 1.0, root=38, gain=0.55, bright=380)
for c in [s for s in shots if s["kind"] == "card" and s["start"] < END]:
    whoosh(c["start"] - 1.1, 1.2, 0.18)
# Release (cold): open fifths, lonely piano.
a, b = span("cold", "memory")
strings(a, b + 1.5, [50, 57, 62, 64], 0.28, 1300)
for k, m in enumerate([62, 64, 65, 69, 67, 65, 64, 62]):
    if a + 1 + k * 2.4 < b - 1:
        piano(m, a + 1 + k * 2.4, 0.15)
# 2012 flashback (memory): filtered, distant, minor piano motif.
a, b = span("memory", "grief")
drone(a, b + 1.0, root=33, gain=0.35, bright=300)
for k, m in enumerate([57, 60, 64, 62, 57, 60, 65, 64, 57, 60, 64, 62]):
    if a + 0.8 + k * 1.8 < b - 0.5:
        piano(m, a + 0.8 + k * 1.8, 0.12, 5)
# Funeral (grief): strings swell, D minor.
a, b = span("grief", "pulse")
strings(a - 0.5, b + 1.0, [38, 50, 53, 57, 62], 0.42, 1600)
for k, m in enumerate([74, 72, 69, 70, 69, 65]):
    if a + 1.5 + k * 2.2 < b:
        piano(m, a + 1.5 + k * 2.2, 0.14, 5)
# Dre watches (pulse): heartbeat-tempo bass pulse, ticking clock.
a, b = span("pulse", "tension")
drone(a - 0.5, b + 1.0, root=36, gain=0.6, bright=520)
t0 = a + 0.3
while t0 < b - 0.2:
    thump(t0, 0.28)
    tick(t0 + 0.43, 0.05)
    t0 += 60 / 72
# Bank (tension) -> question (heart): warm turns tender.
a, b = span("tension", "heart")
drone(a - 0.5, b + 1.0, root=40, gain=0.45, bright=420)
t0 = a
while t0 < b:
    tick(t0, 0.045, 3000)
    t0 += 0.5
heart = first("heart")
car = next(s for s in shots if s.get("mood") == "dread" and s["start"] > heart["start"])
strings(heart["start"] - 0.3, car["start"] + 1.0, [45, 52, 57, 60, 64], 0.38, 2200)
for k, m in enumerate([64, 67, 69, 72, 71, 69, 67, 64, 62, 64]):
    if heart["start"] + 0.6 + k * 1.9 < car["start"]:
        piano(m, heart["start"] + 0.6 + k * 1.9, 0.15)
# The phone in her car (dread) into the call (climax): rising drone, accelerating pulse, riser into the door.
climax = first("climax")
drone(car["start"] - 0.5, climax["start"] + 0.5, root=37, gain=0.6, bright=420)
drone(climax["start"] - 0.5, END + 0.3, root=38, gain=0.8, bright=650)
t0 = climax["start"] + 0.3
while t0 < END - 0.2:
    g = 0.25 + 0.5 * (t0 - climax["start"]) / (END - climax["start"])
    thump(t0, g)
    thump(t0 + 0.24, g * 0.6)
    t0 += 60 / (70 + 30 * (t0 - climax["start"]) / (END - climax["start"]))
boom(END, 1.2, 5.0)
braam(END, 1.0, 4.0)
ends = [s for s in shots if s["kind"] == "card" and s["start"] > END]
for c in ends:
    boom(c["start"] + 0.15, 0.45, 3.0)
drone(ends[0]["start"], T, root=38, gain=0.5, bright=380)

# ── Voices ─────────────────────────────────────────────────────
def comp(x, thresh=0.25, ratio=4.0):
    e = signal.lfilter([0.002], [1, -0.998], np.abs(x))
    return x * np.maximum(e / thresh, 1) ** (1 / ratio - 1)


def load(path, pitch=1.0):
    x, sr = sf.read(path)
    x = x.mean(1) if x.ndim > 1 else x
    x = x / (np.abs(x).max() + 1e-9)
    return signal.resample(x, int(len(x) * SR / sr / pitch))


def phone_eq(x):
    return np.tanh(bp(x, 350, 3200, 3) * 2.2) * 0.8


phone_shots = {s["index"] for s in shots if "phone" in s.get("bed", [])}
for s in shots:
    if s.get("vo_file"):
        who = s["vo"][0]
        x = hp(load(s["vo_file"], s["pitch"]), 70)
        if who != "T":
            x = x + lp(x, 220, 1) * 0.5  # chest
        x = comp(x, 0.22, 4)
        x /= np.abs(x).max()
        if who == "N":
            add(voice, reverb(x, 1.4, 0.12) * 0.95, s["vo_at"], 1.0)
        else:
            # characters sit a little further into the room than the narrator
            add(voice, reverb(x, 0.9, 0.2) * 0.9, s["vo_at"], 1.0, pan=0.0)
    for item in s.get("sfx", []):
        if item[0] == "laugh_low":  # Dre's laugh, heard down the phone line
            x = load(f"{ROOT}/vo/laugh.wav", 1.0)
            add(voice, reverb(phone_eq(x), 0.6, 0.15) * 0.8, s["start"] + item[1], item[2])

# Duck music (-14 dB) and effects under any voice.
lev = np.abs(voice).max(1)
v = np.clip(signal.lfilter([0.0006], [1, -0.9994], (lev > 0.02).astype(float)) * 3, 0, 1)
music *= (1 - 0.8 * v)[:, None]
fx *= (1 - 0.7 * v)[:, None]


def hush(a, b, fade=0.15, floor=0.0):
    g = np.ones(N)
    i, j, f = int(a * SR), int(b * SR), int(fade * SR)
    g[i:j] = floor
    g[max(0, i - f):i] = np.linspace(1, floor, min(f, i))
    g[j:j + f] = np.linspace(floor, 1, len(g[j:j + f]))
    return g[:, None]


bedmix = (music + fx) * hush(black["start"] + 1.0, black["start"] + black["dur"], 0.3, 0.25)
# Total hush for "What do you want?" and for the silence on the line before the laugh.
q = next(s for s in shots if s.get("vo") and s["vo"][1] == "What you want?")
bedmix *= hush(q["vo_at"] - 0.3, q["vo_at"] + q["vo_len"] + 0.6, 0.25, 0.25)
out = bedmix + voice
out = out[: int(T * SR)]
out[: int(0.4 * SR)] *= np.linspace(0, 1, int(0.4 * SR))[:, None]
out[-int(2.5 * SR):] *= np.linspace(1, 0, int(2.5 * SR))[:, None] ** 1.5
out /= np.abs(out).max()
out = np.tanh(out * 1.5) / np.tanh(1.5)
wavfile.write(f"{OUT}/mix.wav", SR, (out * 0.89 * 32767).astype(np.int16))
print("mix done", round(T, 1), "s")
