"""Score and mix for the Episode 1 hype cut: dark half-time trap at 140 BPM, sirens, braams, a heartbeat, silence before D.
Usage: hype_audio.py OUT_DIR"""
import json
import sys

import numpy as np
from scipy import signal
from scipy.io import wavfile

OUT = sys.argv[1]
TL = json.load(open(f"{OUT}/timeline.json"))
SR = 48000
T = TL["total"]
N = int(SR * T)
rng = np.random.default_rng(7)
music = np.zeros((N, 2))
fx = np.zeros((N, 2))
voice = np.zeros((N, 2))
fx = np.zeros((N, 2))
voice = np.zeros((N, 2))
def t_(n):
    return np.arange(n) / SR


def add(buf, x, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if x.ndim == 1:
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        x = np.stack([x * l * 1.414, x * r * 1.414], 1)
    j = min(N, i + len(x))
    if j > i:
        buf[i:j] += x[: j - i] * gain


def lp(x, f, o=2):
    b, a = signal.butter(o, f / (SR / 2), "low")
    return signal.lfilter(b, a, x, axis=0)


def hp(x, f, o=2):
    b, a = signal.butter(o, f / (SR / 2), "high")
    return signal.lfilter(b, a, x, axis=0)


def bp(x, lo, hi, o=2):
    b, a = signal.butter(o, [lo / (SR / 2), hi / (SR / 2)], "band")
    return signal.lfilter(b, a, x, axis=0)


def saw(f, n, detune=0.0):
    ph = np.cumsum(np.full(n, f * (1 + detune)) / SR) if np.isscalar(f) else np.cumsum(f * (1 + detune) / SR)
    return 2 * (ph % 1) - 1


def env(n, a, r):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
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


note = lambda m: 440 * 2 ** ((m - 69) / 12)


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


def rain(start, end, gain=0.12):
    n = int((end - start) * SR)
    if n <= 0:
        return
    x = lp(hp(rng.standard_normal((n, 2)), 700), 7000) * 0.6
    drops = signal.lfilter([1], [1, -0.97], (rng.random((n, 2)) > 0.9993) * rng.uniform(0.5, 1.5, (n, 2)), axis=0)
    add(fx, (x + hp(drops, 1500) * 0.6) * env(n, 1.5, 1.5)[:, None], start, gain)


def comp(x, thresh=0.25, ratio=4.0):
    e = signal.lfilter([0.002], [1, -0.998], np.abs(x))
    return x * np.maximum(e / thresh, 1) ** (1 / ratio - 1)


def load_wav(path, pitch=1.0):
    sr, x = wavfile.read(path)
    x = x.astype(np.float64)
    x = x.mean(1) if x.ndim > 1 else x
    x /= np.abs(x).max() + 1e-9
    return signal.resample(x, int(len(x) * SR / sr / pitch))


def siren(at, length=7.0, gain=0.09, pan=-0.4):
    """A police siren a few blocks away: a wailing tone, filtered and washed in reverb."""
    n = int(length * SR)
    t = t_(n)
    f = 950 + 350 * np.sin(2 * np.pi * 0.42 * t)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.3 * np.sin(4 * np.pi * np.cumsum(f) / SR)
    x = bp(x, 500, 2500) * env(n, 1.5, 2.0)
    add(fx, reverb(x, 3.0, 0.55), at, gain, pan)


B = 60 / TL["bpm"]
M = TL["marks"]
shots = TL["shots"]
start_of = lambda i: shots[i]["start"]


def kick(at, gain=0.9):
    n = int(0.45 * SR)
    t = t_(n)
    body = np.sin(2 * np.pi * np.cumsum(48 + 110 * np.exp(-t * 28)) / SR) * np.exp(-t * 7)
    click = hp(rng.standard_normal(n), 3000) * np.exp(-t * 400) * 0.25
    add(music, np.tanh((body + click) * 1.6), at, gain)


def b808(at, midi, length, gain=0.55):
    n = int(length * SR)
    t = t_(n)
    f = note(midi) * (1 + 0.6 * np.exp(-t * 30))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.1) * env(n, 0.003, 0.12)
    add(music, lp(np.tanh(x * 2.2), 900), at, gain)


def clap(at, gain=0.42):
    n = int(0.3 * SR)
    t = t_(n)
    burst = sum(np.roll(np.exp(-t * 90), int(k * 0.011 * SR)) for k in range(3))
    x = bp(rng.standard_normal(n), 900, 6000) * (burst * 0.6 + np.exp(-t * 18))
    add(music, reverb(x, 1.2, 0.25), at, gain, pan=0.05)


def hat(at, gain=0.09, open_=False):
    n = int((0.18 if open_ else 0.045) * SR)
    t = t_(n)
    x = hp(rng.standard_normal(n), 7500) * np.exp(-t * (25 if open_ else 140))
    add(music, x, at, gain, pan=0.3)


def buzz(at, gain=0.22):
    """A phone vibrating on wood: three short buzzes."""
    for k in range(3):
        n = int(0.38 * SR)
        t = t_(n)
        x = signal.square(2 * np.pi * 172 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 31 * t)) * env(n, 0.01, 0.04)
        add(fx, lp(x, 1800), at + k * 0.55, gain)


def stutter(at, gain=0.16):
    for k in range(6):
        n = int(0.03 * SR)
        add(fx, hp(rng.standard_normal(n), 1500) * np.exp(-t_(n) * 60), at + k * 0.045, gain * (1 - k / 7))


BASS = {"A": [38, 38, 34, 33], "C": [38, 41, 34, 36]}  # D, D, Bb, A / D, F, Bb, C


def beat(t0, t1, kind="full", line="A", hats="8"):
    """Half-time trap from t0 to t1: kick on 1 and the 'and' of 2, clap on 3, hats and 808 per bar."""
    bar, b = 0, t0
    while b < t1 - 0.05:
        for k, (pos, g) in enumerate([(0, 1.0), (1.5, 0.75)] + ([(3.25, 0.6)] if kind == "full" and bar % 2 else [])):
            if b + pos * B < t1:
                kick(b + pos * B, 0.7 * g)
        if b + 2 * B < t1:
            clap(b + 2 * B, 0.32 if kind == "full" else 0.24)
        step = 0.25 if hats == "16" else 0.5
        for k in range(int(4 / step)):
            p = b + k * step * B
            if p < t1:
                hat(p, 0.075 if k % 2 else 0.1)
        if kind == "full" and bar % 4 == 3:  # roll into the next phrase
            for k in range(6):
                hat(b + 3 * B + k * B / 6, 0.06 + 0.01 * k)
        if b < t1:
            b808(b, BASS[line][bar % 4], min(4 * B, t1 - b) * 0.95, 0.42 if kind == "full" else 0.32)
        bar += 1
        b += 4 * B


# ── Cold open: heartbeat, sirens far off, the title hit.
drone(0.0, M["title"] + 1.0, root=38, gain=0.5, bright=420)
t0 = 0.4
while t0 < M["title"] - 0.3:
    thump(t0, 0.35)
    thump(t0 + 0.22, 0.2)
    t0 += 2 * B
for i in (1, 2, 4):
    whoosh(start_of(i) - 0.5, 0.6, 0.18)
    boom(start_of(i), 0.25, 1.5)
stutter(start_of(4))
riser(M["title"] - 2.2, 2.2, 0.3)
braam(M["title"], 1.1, 4.0)
boom(M["title"], 0.9, 4.5)

# ── 2012: the beat comes in.
riser(M["2012"] - 1.6, 1.6, 0.25)
boom(M["2012"], 0.6, 3.0)
beat(M["2012"], M["later"], "full", "A")
siren(M["sirens"] - 0.5, 8.0, 0.12)
siren(M["sirens"] + 1.0, 8.0, 0.07, 0.5)
rain(M["2012"], M["later"], 0.06)
for k in ("nine",):
    boom(M[k], 0.5, 2.5)
braam(M["later"], 0.7, 3.0)

# ── Twelve years later: lighter beat with a piano line.
beat(M["present"], M["riser"], "light", "C")
drone(M["present"], M["riser"] + 0.5, root=38, gain=0.35, bright=520)
mel = [62, 65, 69, 67, 65, 62, 60, 62]
k, t0 = 0, M["present"]
while t0 < M["riser"] - 0.3:
    piano(mel[k % len(mel)], t0, 0.16, 3.0)
    t0 += 2 * B
    k += 1
riser(M["riser"], shots[[s["mark"] if "mark" in s else "" for s in shots].index("riser")]["dur"], 0.42)

# ── The money: the drop, full beat with 16th hats, a hit on every slam.
braam(M["drop"], 0.9, 3.0)
boom(M["drop"], 0.8, 3.0)
beat(M["drop"], M["dread"], "full", "A", hats="16")
for k in ("card", "forged", "where"):
    boom(M[k] + 0.4, 0.55, 2.0)
    whoosh(M[k] - 0.2, 0.5, 0.15)

# ── Dread: drums out, heartbeat speeding up, ticking, the phone.
drone(M["dread"], M["silence"], root=37, gain=0.75, bright=600)
t0, bpm = M["dread"] + 0.2, 64.0
while t0 < M["silence"] - 0.2:
    g = 0.3 + 0.45 * (t0 - M["dread"]) / (M["silence"] - M["dread"])
    thump(t0, g)
    thump(t0 + 0.23, g * 0.6)
    tick(t0 + 0.5, 0.05)
    bpm += 1.4
    t0 += 60 / bpm
rain(M["dread"], M["buzz"] + 2, 0.08)
buzz(M["buzz"] + 2.6, 0.26)
buzz(M["contact"] + 0.2, 0.2)
stutter(M["contact"], 0.2)
riser(M["contact"], M["silence"] - M["contact"], 0.4)
# Silence, then D.
# "D." is said into the silence; the hit lands right after it.
boom(M["d"] + 1.0, 1.3, 6.0)
braam(M["d"] + 1.0, 1.2, 5.0, root=25)

# ── Next episode: the beat returns to close.
beat(M["next"], T - 0.2, "full", "A")
boom(T - 0.9, 0.5, 1.0)

# ── Voices ──
for ln in TL["lines"]:
    x = hp(load_wav(ln["file"]), 70)
    x = x + lp(x, 220, 1) * 0.5
    x = comp(x, 0.22, 4)
    add(voice, reverb(x / np.abs(x).max(), 1.2, 0.12) * 0.95, ln["at"], 1.25)
for key, path in (("tasha_talk", "tasha-money"), ("marcus_talk", "marcus-bank")):
    i = [s.get("mark") for s in shots].index(key)
    import subprocess

    wav = f"{OUT}/{path}.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", shots[i]["src"], "-vn", "-ac", "1", "-ar", str(SR), wav], check=True)
    x = comp(hp(load_wav(wav), 110), 0.25, 3)
    add(voice, reverb(x / np.abs(x).max(), 0.8, 0.18) * 0.95, shots[i]["start"] + 0.1, 1.0)

# Duck the bed under voices (music -11 dB, effects -6 dB); total hush under Tasha's line and in the silence.
lev = np.abs(voice).max(1)
# Fast to duck, slower to come back, so the beat breathes between lines but never covers a word.
gate = (lev > 0.015).astype(float)
gate = np.maximum.accumulate(np.where(gate > 0, np.arange(N), 0)) > np.arange(N) - int(0.25 * SR)
v = np.clip(signal.lfilter([0.004], [1, -0.996], gate.astype(float)) * 1.6, 0, 1)
v = np.concatenate([v[int(0.08 * SR):], np.zeros(int(0.08 * SR))])  # start ducking just before each line
music *= (1 - 0.88 * v)[:, None]
fx *= (1 - 0.82 * v)[:, None]


def hush(a, b, fade=0.08, floor=0.0):
    g = np.ones(N)
    i, j, f = int(a * SR), int(b * SR), int(fade * SR)
    g[i:j] = floor
    g[max(0, i - f):i] = np.linspace(1, floor, min(f, i))
    g[j:j + f] = np.linspace(floor, 1, len(g[j:j + f]))
    return g[:, None]


line_at = {ln["file"].split("/")[-1][:-4]: ln for ln in TL["lines"]}
tl4 = line_at["l04"]
bed = (music + fx) * hush(tl4["at"] - 0.15, tl4["at"] + tl4["len"] + 0.1, 0.1, 0.25)
bed *= hush(M["silence"], M["d"], 0.05, 0.0)
out = bed + voice
out[: int(0.2 * SR)] *= np.linspace(0, 1, int(0.2 * SR))[:, None]
out[-int(1.0 * SR):] *= np.linspace(1, 0, int(1.0 * SR))[:, None] ** 1.5
out /= np.abs(out).max()
out = np.tanh(out * 1.8) / np.tanh(1.8)
wavfile.write(f"{OUT}/mix.wav", SR, (out * 0.9 * 32767).astype(np.int16))
sc = 0.9 / np.abs(bed + voice).max()
for name, x in (("stem-bed.wav", bed), ("stem-voice.wav", voice)):
    wavfile.write(f"{OUT}/{name}", SR, (np.clip(x * sc, -1, 1) * 32767).astype(np.int16))
print("mix done", round(T, 1), "s")
