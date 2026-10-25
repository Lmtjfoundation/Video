"""Score, sound design and narration mix for The Settlement, Episode 1 (full motion), following timeline.json.
Sound effects are recorded-quality MOSS-SoundEffect v2 generations placed per shot (script sfx/bed); the score is synthesised.
Usage: mix.py OUT_DIR SFX_DIR"""
import json
import subprocess
import sys

import numpy as np
from scipy import signal
from scipy.io import wavfile

OUT, SFX = sys.argv[1], sys.argv[2]
TL = json.load(open(f"{OUT}/timeline.json"))
SR = 48000
T = TL["total"]
N = int(SR * T)
rng = np.random.default_rng(11)
music = np.zeros((N, 2))
fx = np.zeros((N, 2))
voice = np.zeros((N, 2))
shots = TL["shots"]
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


def room(start, end, gain=0.05):  # fluorescent hum for the hospital
    n = int((end - start) * SR)
    t = t_(n)
    x = (np.sin(2 * np.pi * 120 * t) * 0.3 + np.sin(2 * np.pi * 240 * t) * 0.1 + lp(rng.standard_normal(n), 1500) * 0.4) * env(n, 0.8, 0.8)
    add(fx, x, start, gain)


def shot_by(pred):
    return next(s for s in shots if pred(s))


# ── Score by mood ─────────────────────────────────────────────
def mood_start(m):
    return next(s["start"] for s in shots if s.get("mood") == m)


WARM, DOUBT, DREAD = mood_start("warm"), mood_start("doubt"), mood_start("dread")  # "street" runs from 0 to WARM
flash = next(s for s in shots if s.get("flash"))
black = next(s for s in shots if s["kind"] == "black")
END = black["start"]
cards_end = [s for s in shots if s["kind"] == "card" and s["start"] > END]
drone(0.3, DOUBT + 1.5, root=38, gain=0.5, bright=360)
melody = [62, 65, 69, 67, 62, 65, 70, 69, 62, 65, 64, 62, 57, 58, 62, 65, 69, 72, 70, 69]
for k in range(int((DOUBT - WARM - 1.0) / 2.6)):
    piano(melody[k % len(melody)], WARM + 1.0 + k * 2.6, 0.18)
    if k % 4 == 0:
        piano(melody[k % len(melody)] - 24, WARM + 1.0 + k * 2.6, 0.12, 6)


def siren(at, length=7.0, gain=0.09, pan=-0.4):
    """A police siren a few blocks away: a wailing tone, filtered and washed in reverb."""
    n = int(length * SR)
    t = t_(n)
    f = 950 + 350 * np.sin(2 * np.pi * 0.42 * t)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.3 * np.sin(4 * np.pi * np.cumsum(f) / SR)
    x = bp(x, 500, 2500) * env(n, 1.5, 2.0)
    add(fx, reverb(x, 3.0, 0.55), at, gain, pan)


# Cold open on the Southside: a low pulse under the street, rain, sirens when they come.
STREET_END = WARM
t0 = 9.0
while t0 < STREET_END - 1.0:
    thump(t0, 0.16)
    t0 += 60 / 58
sirens = next(s for s in shots if "sirens" in (s.get("vo") or ""))
drone(DOUBT - 1.0, DREAD + 1.5, root=36, gain=0.7, bright=480)
for k in range(int((DREAD - DOUBT) / 4.2)):
    piano([50, 53, 48, 46][k % 4], DOUBT + 1 + k * 4.2, 0.13, 5)
t0 = DOUBT + 2.0
while t0 < DREAD:
    thump(t0, 0.22)
    t0 += 60 / 52
drone(DREAD - 1.0, END + 0.3, root=38, gain=0.8, bright=620)
t0 = DREAD + 0.5
while t0 < END - 0.2:
    g = 0.25 + 0.5 * (t0 - DREAD) / (END - DREAD)
    thump(t0, g)
    thump(t0 + 0.24, g * 0.65)
    t0 += 60 / (66 + 20 * (t0 - DREAD) / (END - DREAD))
monitor = next(s for s in shots if "baby monitor" in (s.get("vo") or ""))
t0, k = monitor["start"], 0
while t0 < END - 0.2:
    tick(t0, 0.06 if k % 2 == 0 else 0.045, 3400 if k % 2 == 0 else 2600)
    t0 += 0.5
    k += 1
riser(flash["start"] + flash["dur"] - 4.5, 4.5, 0.42)
boom(END, 1.1, 5.0)
braam(END, 0.9, 4.0)
for c in [s for s in shots if s["kind"] == "card"]:
    whoosh(c["start"] - 1.2)
    boom(c["start"], 0.4, 3.0)
drone(cards_end[0]["start"], T, root=38, gain=0.55, bright=400)
she_did = flash  # the line under the riser gets the music dipped below

# ── Sound effects (MOSS-SoundEffect v2) ──────────────────────────
_SFX = {}


def sfx(name):
    if name not in _SFX:
        sr, x = wavfile.read(f"{SFX}/{name}.wav")
        x = x.astype(np.float64)
        x = x.mean(1) if x.ndim > 1 else x
        if sr != SR:
            x = signal.resample(x, int(len(x) * SR / sr))
        x = hp(x, 30)
        fade = int(0.02 * SR)
        x[:fade] *= np.linspace(0, 1, fade)
        x[-fade * 5:] *= np.linspace(1, 0, fade * 5)
        # Every sound at about the same loudness before its gain, but a sparse one (a click, a slam) isn't pushed past
        # a safe peak just because it is mostly silence.
        rms, peak = np.sqrt(np.mean(x ** 2)) + 1e-9, np.abs(x).max() + 1e-9
        _SFX[name] = x * min(0.12 / rms, 0.6 / peak)
    return _SFX[name]


BED_GAIN = {"rain": 0.55, "fridge": 0.35, "cicadas": 0.4, "ac": 0.4}


def bed(name, start, end):
    """Loop an ambience under a stretch of the film with crossfades."""
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
    l, r = out, np.roll(out, int(0.013 * SR))  # a little width
    add(fx, np.stack([l, r], 1), start, BED_GAIN.get(name, 0.4))


# Beds run across consecutive shots that share them, so they do not restart at every cut.
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
        add(fx, sfx(name), s["start"] + off, gain, pan)

# ── Voices ──────────────────────────────────────────────────────
def comp(x, thresh=0.25, ratio=4.0):
    e = signal.lfilter([0.002], [1, -0.998], np.abs(x))
    return x * np.maximum(e / thresh, 1) ** (1 / ratio - 1)


def load_wav(path, pitch=1.0):
    sr, x = wavfile.read(path)
    x = x.astype(np.float64)
    x = x.mean(1) if x.ndim > 1 else x
    x /= np.abs(x).max() + 1e-9
    return signal.resample(x, int(len(x) * SR / sr / pitch))


for s in shots:
    if s["kind"] == "title":
        s["vo_at"] = s["start"] + 2.4  # after the title hit, as the words fade in
    if s.get("vo_file"):
        x = hp(load_wav(s["vo_file"], 0.95), 60)
        x = x + lp(x, 220, 1) * 0.6
        x = comp(x, 0.22, 4)
        add(voice, reverb(x / np.abs(x).max(), 1.6, 0.14) * 0.95, s["vo_at"], 1.0)
    if s["kind"] == "talk":
        wav = f"{OUT}/talk-{s['index']:03d}.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", s["src"], "-vn", "-ac", "1", "-ar", str(SR), wav], check=True)
        x = comp(hp(load_wav(wav), 110), 0.25, 3)
        add(voice, reverb(x / np.abs(x).max(), 0.9, 0.2) * 0.9, s["talk_at"], 1.0)

# Duck music (-14 dB) and effects (-7 dB) under any voice.
lev = np.abs(voice).max(1)
v = np.clip(signal.lfilter([0.0006], [1, -0.9994], (lev > 0.02).astype(float)) * 3, 0, 1)
music *= (1 - 0.85 * v)[:, None]
fx *= (1 - 0.82 * v)[:, None]  # effects drop about 15 dB under a voice, so sirens never cover a line


def hush(a, b, fade=0.15, floor=0.0):
    g = np.ones(N)
    i, j, f = int(a * SR), int(b * SR), int(fade * SR)
    g[i:j] = floor
    g[max(0, i - f):i] = np.linspace(1, floor, min(f, i))
    g[j:j + f] = np.linspace(floor, 1, len(g[j:j + f]))
    return g[:, None]


pre_title = black
# Silence for the black beat after the crash (only the narrator), and before the title.
bed = (music + fx) * hush(pre_title["start"] + 0.9, pre_title["start"] + pre_title["dur"], 0.3, 0.2)
bed *= hush(she_did["vo_at"] - 0.1, she_did["vo_at"] + 1.1, 0.15, 0.3)
for s in shots:  # music dips under the talking characters so their lines land
    if s["kind"] == "talk":
        bed *= hush(s["start"] + 0.2, s["start"] + s["dur"] - 0.3, 0.3, 0.35)
out = bed + voice
out[: int(0.5 * SR)] *= np.linspace(0, 1, int(0.5 * SR))[:, None]
out[-int(3 * SR):] *= np.linspace(1, 0, int(3 * SR))[:, None] ** 1.5
out /= np.abs(out).max()
out = np.tanh(out * 1.6) / np.tanh(1.6)
wavfile.write(f"{OUT}/mix.wav", SR, (out * 0.89 * 32767).astype(np.int16))
sc = 0.89 / np.abs(bed + voice).max()
for name, x in (("stem-bed.wav", bed), ("stem-voice.wav", voice)):
    wavfile.write(f"{OUT}/{name}", SR, (np.clip(x * sc, -1, 1) * 32767).astype(np.int16))
print("mix done", round(T, 1), "s")
