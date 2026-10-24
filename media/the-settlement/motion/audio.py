"""Score and mix for the 30-second motion piece. Usage: audio.py OUT_DIR"""
import sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

OUT = sys.argv[1]
SR = 48000
T = 30.0
N = int(SR * T)
rng = np.random.default_rng(11)
music = np.zeros((N, 2))
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


VO = "/tmp/claude-0/-home-user-Video/e94a2179-1832-5221-bb24-9d181da3a815/scratchpad/m30/vo"
VO_AT = [0.5, 5.6, 10.4, 15.6, 20.3, 25.2]

# Warm first half: slow piano over a soft major drone; the floor drops at 15 s (the bank) into a minor drone and a heartbeat.
drone(0, 16, root=45, gain=0.35, bright=500, minor=False)
for at, m in [(0.3, 57), (2.8, 64), (5.3, 62), (7.8, 66), (10.2, 57), (12.6, 64)]:
    piano(m, at, 0.22, 5)
rain(0, 5.5, 0.1)
whoosh(13.9)
boom(15.1, 0.45, 3.5)
drone(15, T, root=38, gain=0.6, bright=380)
for k, at in enumerate(np.cumsum([1.0] * 4 + [0.85] * 5 + [0.72] * 6)[:-1] + 15.2):
    if at < 27.6:
        thump(at, 0.55)
        thump(at + 0.22, 0.3)
rain(20, 25.5, 0.14)
riser(24.3, 3.4, 0.3)
braam(27.8, 1.0, 3.0)

for i, at in enumerate(VO_AT):
    x = hp(load_wav(f"{VO}/l{i:02d}.wav", 0.95), 60)
    x = x + lp(x, 220, 1) * 0.6
    x = comp(x, 0.22, 4)
    add(voice, reverb(x / np.abs(x).max(), 1.6, 0.14) * 0.95, at, 1.0)

lev = np.abs(voice).max(1)
v = np.clip(signal.lfilter([0.0006], [1, -0.9994], (lev > 0.02).astype(float)) * 3, 0, 1)
music *= (1 - 0.85 * v)[:, None]
fx *= (1 - 0.6 * v)[:, None]
bed = music + fx
out = bed + voice
out[: int(0.4 * SR)] *= np.linspace(0, 1, int(0.4 * SR))[:, None]
out[-int(1.2 * SR):] *= np.linspace(1, 0, int(1.2 * SR))[:, None] ** 1.5
out /= np.abs(out).max()
out = np.tanh(out * 1.6) / np.tanh(1.6)
wavfile.write(f"{OUT}/mix.wav", SR, (out * 0.89 * 32767).astype(np.int16))
sc = 0.89 / np.abs(bed + voice).max()
for name, x in (("stem-bed.wav", bed), ("stem-voice.wav", voice)):
    wavfile.write(f"{OUT}/{name}", SR, (np.clip(x * sc, -1, 1) * 32767).astype(np.int16))
print("mix done")
