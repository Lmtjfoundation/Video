"""Sound design and score for GHOST POST, synthesized from scratch.

Reads cues.json (the same cue sheet the picture uses) and writes a 48 kHz stereo WAV.
Run:  python3 audio.py out/audio.wav
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

HERE = Path(__file__).resolve().parent
Q = json.loads((HERE / "cues.json").read_text())
SR = 48000
DUR = Q["duration"]
N = int(DUR * SR)
rng = np.random.default_rng(1992)

dry = np.zeros((2, N))
verb = np.zeros((2, N))   # send to the street reverb
drums = np.zeros((2, N))  # beat bus (filtered during the reload)


# ---------- helpers ----------
def tt(dur):
    return np.arange(int(dur * SR)) / SR


def noise(dur):
    return rng.standard_normal(int(dur * SR))


def filt(x, kind, f, order=2):
    if isinstance(f, (list, tuple)):
        f = [min(v, SR / 2 * 0.95) for v in f]
    else:
        f = min(f, SR / 2 * 0.95)
    return sosfilt(butter(order, f, btype=kind, fs=SR, output="sos"), x)


def sweep(f0, f1, dur, curve="exp"):
    t = tt(dur)
    if curve == "exp":
        f = f0 * (f1 / f0) ** (t / dur)
    else:
        f = f0 + (f1 - f0) * t / dur
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def env_ad(n, a, d):
    """Attack/decay envelope in seconds over n samples."""
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-np.maximum(0, t - a) / d)
    return e


def place(sig, t0, gain=1.0, pan=0.0, bus=None, send=0.0):
    """Add a mono or stereo signal at time t0 with equal-power pan and optional reverb send."""
    bus = dry if bus is None else bus
    i = int(round(t0 * SR))
    if i >= N:
        return
    s = np.atleast_2d(sig) if np.ndim(sig) == 2 else None
    if s is None:
        a = (pan + 1) * np.pi / 4
        s = np.vstack([sig * np.cos(a), sig * np.sin(a)])
    j0 = max(0, -i)
    s = s[:, j0:]
    i = max(0, i)
    n = min(s.shape[1], N - i)
    bus[:, i:i + n] += gain * s[:, :n]
    if send:
        verb[:, i:i + n] += gain * send * s[:, :n]


def norm(x):
    m = np.max(np.abs(x))
    return x / m if m > 0 else x


# ---------- time warp (same function as the picture) ----------
B = Q["bt"]


def speed_at(t):
    sm = lambda x: x * x * (3 - 2 * x)
    inv = lambda a, b, x: min(1, max(0, (x - a) / (b - a)))
    if t < B["slowStart"]:
        return 1
    if t < B["slowFull"]:
        return 1 + (B["minSpeed"] - 1) * sm(inv(B["slowStart"], B["slowFull"], t))
    if t < B["fastStart"]:
        return B["minSpeed"]
    if t < B["fastFull"]:
        return B["minSpeed"] + (1 - B["minSpeed"]) * sm(inv(B["fastStart"], B["fastFull"], t))
    return 1


WSTEP = 0.001
_tab = np.zeros(int(np.ceil(DUR / WSTEP)) + 2)
for k in range(1, len(_tab)):
    _tab[k] = _tab[k - 1] + speed_at((k - 0.5) * WSTEP) * WSTEP
_ts = np.arange(len(_tab)) * WSTEP


def unwarp(rt):
    """Real time at which world time reaches rt."""
    if rt >= _tab[-1]:
        return _ts[-1] + (rt - _tab[-1])
    return float(np.interp(rt, _tab, _ts))


# ---------- instruments ----------
def gunshot(big=False, ghost=False):
    d = 1.4
    t = tt(d)
    crack = filt(noise(d), "high", 1800) * np.exp(-t / 0.0045)
    body = filt(noise(d), "low", 3200) * np.exp(-t / (0.09 if big else 0.06))
    f = 52 + 110 * np.exp(-t / 0.025)
    thump = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (0.22 if big else 0.13))
    s = 1.1 * crack + 0.75 * body + (1.3 if big else 0.95) * thump
    s = np.tanh(s * 2.2)
    # slap-back off the storefronts
    for dl, g, lp in ((0.19, 0.32, 1800), (0.43, 0.18, 1100), (0.82, 0.07, 700)):
        k = int(dl * SR)
        s[k:] += g * filt(s[:-k], "low", lp)
    if ghost:
        wob = np.interp(np.arange(len(s)) * 0.72, np.arange(len(s)), s)
        s = 0.55 * s + 0.6 * filt(wob, "low", 2500) + 0.25 * sweep(2600, 900, d) * np.exp(-t / 0.18)
    return norm(s) * np.exp(-t / 0.9)


def casing_tink():
    t = tt(0.35)
    s = sum(np.sin(2 * np.pi * f * t) * np.exp(-t / dcy) for f, dcy in ((3150, 0.05), (5080, 0.035), (7870, 0.02), (9300, 0.015)))
    return norm(s + 0.3 * filt(noise(0.35), "high", 6000) * np.exp(-t / 0.004))


def metal_hit(ric=False):
    t = tt(0.9)
    s = sum(np.sin(2 * np.pi * f * t) * np.exp(-t / d) for f, d in ((820, 0.12), (1340, 0.09), (2150, 0.07), (3400, 0.04)))
    s += 0.8 * filt(noise(0.9), "band", (1500, 7000)) * np.exp(-t / 0.012)
    if ric:
        s += 0.35 * sweep(3600, 1100, 0.9) * np.exp(-t / 0.28) * np.minimum(1, t / 0.03)
    return norm(s)


def glass_shatter():
    d = 1.3
    t = tt(d)
    s = filt(noise(d), "band", (3500, 12000)) * np.exp(-t / 0.18) * 0.6
    for _ in range(140):
        at = abs(rng.normal(0.05, 0.28))
        if at > d - 0.1:
            continue
        f = rng.uniform(3000, 11000)
        tk = tt(0.06)
        tick = np.sin(2 * np.pi * f * tk) * np.exp(-tk / rng.uniform(0.004, 0.015))
        i = int(at * SR)
        s[i:i + len(tk)] += tick * rng.uniform(0.2, 0.7) * np.exp(-at / 0.5)
    return norm(s)


def boom(dur=2.5, f0=110, f1=34, tail=0.7):
    t = tt(dur)
    f = f1 + (f0 - f1) * np.exp(-t / 0.08)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / tail)
    s += 0.5 * filt(noise(dur), "low", 400) * np.exp(-t / 0.25)
    return norm(np.tanh(1.6 * s))


def kick():
    t = tt(0.5)
    f = 48 + 120 * np.exp(-t / 0.03)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.28)
    s += 0.4 * filt(noise(0.5), "high", 3000) * np.exp(-t / 0.003)
    return norm(np.tanh(1.8 * s))


def snare():
    t = tt(0.4)
    s = 0.8 * filt(noise(0.4), "band", (1200, 7000)) * np.exp(-t / 0.13)
    s += 0.6 * np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.06)
    return norm(s)


def hat(open_=False):
    d = 0.35 if open_ else 0.08
    t = tt(d)
    return norm(filt(noise(d), "high", 7500) * np.exp(-t / (0.12 if open_ else 0.022)))


def bass808(f, dur):
    t = tt(dur)
    s = np.sin(2 * np.pi * f * t) * np.minimum(1, t / 0.005) * np.exp(-t / (dur * 0.7))
    return np.tanh(2.5 * s) * 0.9


def saw(f, dur, detune=(0.0,)):
    t = tt(dur)
    out = np.zeros(len(t))
    for dt in detune:
        ph = (f * (1 + dt)) * t
        out += 2 * (ph - np.floor(ph + 0.5))
    return out / len(detune)


def pad(freqs, dur, lp=900, attack=1.2):
    s = sum(saw(f, dur, (-0.004, 0.0, 0.005)) for f in freqs)
    s = filt(s, "low", lp, 2)
    t = tt(dur)
    e = np.minimum(1, t / attack) * np.minimum(1, (dur - t) / 0.8)
    return norm(s * e)


def tick(pitch):
    t = tt(0.05)
    return norm(filt(noise(0.05), "band", (pitch * 0.7, pitch * 1.4)) * np.exp(-t / 0.006) + 0.5 * np.sin(2 * np.pi * pitch * t) * np.exp(-t / 0.01))


def type_click():
    t = tt(0.06)
    s = filt(noise(0.06), "high", 2500) * np.exp(-t / 0.004) + 0.4 * np.sin(2 * np.pi * 180 * t) * np.exp(-t / 0.012)
    return norm(s)


def heartbeat():
    t = tt(0.5)
    one = lambda: np.sin(2 * np.pi * np.cumsum(45 + 40 * np.exp(-t / 0.02)) / SR) * np.exp(-t / 0.08)
    s = one()
    k = int(0.17 * SR)
    s[k:] += 0.65 * one()[:-k]
    return norm(filt(s, "low", 180))


def whoosh(dur=0.6, lo=300, hi=3000):
    t = tt(dur)
    e = np.sin(np.pi * t / dur) ** 2
    return norm(filt(noise(dur), "band", (lo, hi)) * e)


def mech_click(f=2400, d=0.03):
    t = tt(0.12)
    return norm(filt(noise(0.12), "band", (f * 0.5, f * 2)) * np.exp(-t / d) + 0.4 * np.sin(2 * np.pi * f * 0.37 * t) * np.exp(-t / 0.02))


# ---------- the street: rain, hum, drone, siren ----------
def rain_bed(t0, t1, gain):
    d = t1 - t0
    t = tt(d)
    fade = np.minimum(1, t / 1.0) * np.minimum(1, (d - t) / 1.0)
    for ch, pan in ((0, -0.7), (1, 0.7)):
        r = filt(noise(d), "band", (900, 7000)) * 0.6 + filt(noise(d), "band", (120, 500)) * 0.15
        place(r * fade, t0, gain, pan)
    for _ in range(int(d * 40)):
        place(tick(rng.uniform(2500, 6000)) * 0.2, t0 + rng.uniform(0, d), gain * rng.uniform(0.2, 0.8), rng.uniform(-0.9, 0.9))


rain_bed(0.0, B["slowStart"], 0.05)
rain_bed(B["snap"] + 0.3, Q["title"]["t"], 0.045)

hum_d = Q["title"]["t"]
th = tt(hum_d)
hum = sum(np.sin(2 * np.pi * f * th) / k for k, f in enumerate((60, 120, 180, 240), 1))
place(hum * 0.012, 0.0, 1, 0.3)

# low drone through the cold open and standoff
dd = 12.5
td = tt(dd)
drone = (np.sin(2 * np.pi * 41.2 * td) + 0.6 * np.sin(2 * np.pi * 61.7 * td) + 0.4 * filt(saw(82.4, dd, (-0.003, 0.004)), "low", 220))
drone *= (0.75 + 0.25 * np.sin(2 * np.pi * 0.13 * td)) * np.minimum(1, td / 2.5) * np.minimum(1, (dd - td) / 0.6)
drone *= 1 + 0.8 * np.clip((td - 8.0) / 4.4, 0, 1)
place(drone, 0, 0.09, 0, send=0.3)

# far-off siren
sd = 4.2
ts = tt(sd)
sir = np.sin(2 * np.pi * np.cumsum(720 + 260 * np.sin(2 * np.pi * 0.42 * ts)) / SR)
sir = filt(sir, "low", 1400) * np.sin(np.pi * ts / sd) ** 2
place(sir, 0.6, 0.035, 0.75, send=0.9)

# typewriter for on-screen text
for cue in Q["typed"]:
    for i, ch in enumerate(cue["text"]):
        if ch != " ":
            place(type_click(), cue["t"] + (i + 1) / cue["cps"], 0.22 * rng.uniform(0.7, 1.0), rng.uniform(-0.3, 0.3))

# ---------- introductions ----------
place(boom(1.8, 130, 40, 0.5), Q["cards"]["deuce"], 0.6, 0, send=0.5)
place(whoosh(0.5, 400, 4000), Q["cards"]["deuce"] - 0.45, 0.22, -0.4)
# the stranger arrives: reversed swell of a dissonant cluster
ga = Q["ghostAppear"]
cl_d = 1.2
tc = tt(cl_d)
cluster = sum(np.sin(2 * np.pi * f * tc) for f in (659.3, 698.5, 987.8, 1046.5)) * (0.6 + 0.4 * np.sin(2 * np.pi * 7 * tc))
cluster = cluster * (tc / cl_d) ** 3
place(cluster, ga - cl_d + 0.15, 0.06, 0.5, send=1.2)
place(boom(2.0, 90, 30, 0.8), Q["cards"]["ghost"], 0.55, 0.3, send=0.8)
for k in range(6):
    tb = tt(0.05)
    place(np.sign(np.sin(2 * np.pi * rng.uniform(300, 1800) * tb)) * 0.5, Q["cards"]["ghost"] + k * 0.045, 0.06, 0.5)

# ---------- the standoff ----------
tb, ti = 8.0, 1.0
while tb < Q["draw"] - 0.25:
    place(heartbeat(), tb, 0.55, 0)
    tb += ti
    ti = max(0.42, ti * 0.9)
for k, tk in enumerate(np.arange(8.0, Q["draw"] - 0.2, 0.5)):
    place(tick(3200 if k % 2 == 0 else 2500), tk, 0.12, -0.2)
for c in Q["cuts"]:
    place(whoosh(0.45), c - 0.3, 0.07, rng.uniform(-0.5, 0.5))
# riser into the draw, then a breath of silence
rd = Q["draw"] - 0.06 - 11.0
tr = tt(rd)
riser = sum(sweep(f, f * 6, rd) for f in (180, 270, 405)) * 0.3 + filt(noise(rd), "high", 2000) * 0.7
riser *= (tr / rd) ** 2.4
place(riser, 11.0, 0.18, 0, send=0.4)

# ---------- the gunfight ----------
for k, s in enumerate(Q["deuceShots"]):
    first = k == 0
    final = k == len(Q["deuceShots"]) - 1
    place(gunshot(big=first or final), s, 0.95 if (first or final) else 0.72, -0.25, send=0.35)
    if first:
        place(boom(2.2, 140, 32, 0.6), s, 0.8, 0, send=0.6)
    # brass hits the pavement (same physics as the picture)
    land = s + Q["casing"]["delay"] + 0.06 * (k % 3)
    rl = unwarp(land)
    place(casing_tink(), rl, 0.13, -0.45)
    place(casing_tink(), unwarp(land + 0.14), 0.06, -0.45)
for g in Q["ghostShots"]:
    place(gunshot(ghost=True), g["t"], 0.6, 0.45, send=0.8)
for h in Q["reloadHits"]:
    place(gunshot(ghost=True), h["t"] - 0.012, 0.42, 0.55, send=0.8)
    place(metal_hit(ric=True), h["t"], 0.5, 0.25, send=0.4)
for sp in Q["sparks"]:
    place(metal_hit(ric=True), sp["t"], 0.45, 0.1, send=0.4)
place(glass_shatter(), Q["glass"]["t"], 0.55, 0.0, send=0.5)

R = Q["reload"]
place(mech_click(2600, 0.02), R["magOut"], 0.4, -0.1)
place(metal_hit() * 0.6, R["magLand"], 0.35, -0.3, send=0.3)
place(mech_click(1800, 0.03), R["magIn"], 0.55, 0)
place(filt(noise(0.09), "band", (1500, 6000)) * np.exp(-tt(0.09) / 0.03), R["rackBack"], 0.35, 0)
place(mech_click(2200, 0.025), R["rackFwd"], 0.6, 0)
place(whoosh(0.35, 200, 1600), R["end"] - 0.2, 0.2, -0.3)

# the beat (96 BPM boom-bap), muffled while Deuce hides behind the car
beat0 = Q["gunStart"]
e8 = 60 / Q["bpm"] / 2
stop = B["slowStart"]
i = 0
while beat0 + i * e8 < stop:
    tq = beat0 + i * e8
    pos = i % 8
    if pos in (0, 3, 5):
        place(kick(), tq, 0.75, 0, bus=drums)
    if pos in (2, 6):
        place(snare(), tq, 0.5, 0.05, bus=drums, send=0.25)
    place(hat(open_=(pos == 7)), tq, 0.16 if pos % 2 == 0 else 0.1, 0.3, bus=drums)
    if tq > R["end"] and pos % 2 == 1:
        place(hat(), tq + e8 / 2, 0.07, 0.35, bus=drums)
    note = {0: (41.2, 0.55), 3: (41.2, 0.3), 5: (49.0, 0.25), 6: (36.7, 0.45)}.get(pos)
    if note:
        place(bass808(*note), tq, 0.5, 0, bus=drums)
    if pos == 0 and (i // 8) % 2 == 0:
        place(norm(filt(saw(164.8, 0.5, (-0.006, 0, 0.007)) + saw(196, 0.5, (0.004,)) + saw(246.9, 0.5, (-0.003,)), "low", 1800)) * np.exp(-tt(0.5) / 0.15), tq, 0.14, 0, bus=drums, send=0.5)
    i += 1
r0, r1 = int(R["start"] * SR), int(R["end"] * SR)
drums[:, r0:r1] = np.vstack([filt(drums[0, r0:r1], "low", 380), filt(drums[1, r0:r1], "low", 380)]) * 1.4
dry += drums
# tape-stop into bullet time
place(sweep(320, 30, 0.6) * np.exp(-tt(0.6) / 0.3), stop - 0.02, 0.18, 0)

# ---------- bullet time ----------
place(boom(4.0, 90, 22, 1.6), stop, 0.7, 0, send=0.6)
slow_shot = gunshot(big=True)
slow_shot = np.interp(np.arange(len(slow_shot) * 6) / 6, np.arange(len(slow_shot)), slow_shot)
place(filt(slow_shot, "low", 900), stop + 0.02, 0.5, -0.2, send=0.8)
btd = B["fastFull"] - B["bulletStart"]
tb_ = tt(btd)
whirr = (np.sin(2 * np.pi * 88 * tb_) * (0.6 + 0.4 * np.sin(2 * np.pi * 7 * tb_)) + 0.5 * filt(noise(btd), "low", 260))
whirr *= np.minimum(1, tb_ / 0.6) * np.minimum(1, (btd - tb_) / 0.3)
pan_path = np.clip(np.interp(tb_ + B["bulletStart"], [B["bulletStart"], B["bulletEnd"]], [-0.8, 0.9]), -1, 1)
a = (pan_path + 1) * np.pi / 4
place(np.vstack([whirr * np.cos(a), whirr * np.sin(a)]), B["bulletStart"], 0.16)
sub = np.sin(2 * np.pi * 30 * tb_) * np.minimum(1, tb_ / 1.0) * np.minimum(1, (btd - tb_) / 0.3)
place(sub, B["bulletStart"], 0.16)
for k, tk in enumerate(np.arange(B["bulletStart"] + 0.05, B["bulletHit"], B["ringEvery"] * 2)):
    tw = tt(0.8)
    place(np.sin(2 * np.pi * np.cumsum(70 - 30 * tw / 0.8) / SR) * np.exp(-tw / 0.25), tk, 0.12, -0.6 + 1.4 * k / 10, send=0.6)
for tk in np.arange(B["bulletStart"] + 0.4, B["fastStart"], 1.6):
    place(filt(heartbeat(), "low", 90), tk, 0.6)
# passing through him
pt = tt(1.6)
choir = sum(np.sin(2 * np.pi * f * pt) for f in (329.6, 392.0, 493.9, 587.3)) * np.exp(-pt / 0.7) * np.minimum(1, pt / 0.05)
place(choir, B["bulletHit"], 0.07, 0.4, send=1.5)
rv = (tt(0.55) / 0.55) ** 3 * filt(noise(0.55), "high", 3000)
place(rv, B["snap"] - 0.55, 0.3, 0.2)
place(boom(3.0, 160, 30, 1.0), B["snap"], 0.85, 0, send=0.9)
place(glass_shatter(), B["snap"] + 0.01, 0.3, 0.4, send=1.0)

# ---------- aftermath ----------
ad = 3.4
ta = tt(ad)
place(np.sin(2 * np.pi * 6200 * ta) * np.exp(-ta / 1.1) * np.minimum(1, ta / 0.05), B["snap"] + 0.05, 0.03, 0)
dd0, dd1 = Q["aftermath"]["dissolve0"], Q["aftermath"]["dissolve1"]
wd = dd1 - dd0 + 1.0
tw = tt(wd)
whisper = filt(noise(wd), "band", (900, 4200)) * (0.5 + 0.5 * np.sin(2 * np.pi * 3.3 * tw) * np.sin(2 * np.pi * 0.7 * tw)) * np.sin(np.pi * tw / wd) ** 2
place(whisper, dd0, 0.07, 0.4, send=1.4)
place(pad((82.4, 164.8, 196.0, 246.9, 293.7, 370.0), Q["title"]["t"] - Q["aftermath"]["push0"] + 0.4, lp=1100, attack=1.6),
      Q["aftermath"]["push0"] - 0.4, 0.14, 0, send=0.8)
for _ in range(60):
    place(tick(rng.uniform(1500, 4000)) * 0.4, rng.uniform(Q["aftermath"]["push0"], Q["title"]["t"]), rng.uniform(0.02, 0.06), 0.3)
gl = tt(1.5)
place(sum(np.sin(2 * np.pi * f * gl) for f in (1318.5, 1975.5)) * np.exp(-gl / 0.5), Q["aftermath"]["photoGlint"], 0.03, 0.2, send=1.5)

# ---------- title ----------
T0 = Q["title"]["t"]
bd = 4.6
tb2 = tt(bd)
braam = sum(saw(f, bd, (-0.006, 0, 0.006)) for f in (41.2, 82.4, 123.5, 164.8))
cut = 200 + 1600 * np.exp(-tb2 / 0.6)
braam = np.tanh(2 * filt(braam, "low", 900)) * np.exp(-tb2 / 1.6) * np.minimum(1, tb2 / 0.02)
place(norm(braam), T0, 0.45, 0, send=0.7)
place(boom(4.0, 150, 28, 1.4), T0, 0.9, 0, send=0.8)
for k in range(9):
    tq = tt(0.04)
    place(np.sign(np.sin(2 * np.pi * rng.uniform(200, 2400) * tq)) * 0.6, T0 + 0.02 + k * 0.035, 0.07, rng.uniform(-0.6, 0.6))
place(whoosh(0.4, 600, 6000), Q["title"]["slash"] - 0.15, 0.25, 0.2)

# ---------- mix ----------
ir_d = 2.8
ti = tt(ir_d)
ir = np.vstack([filt(noise(ir_d), "low", 5500) * np.exp(-ti / 0.55) for _ in range(2)])
ir[:, : int(0.012 * SR)] = 0
ir /= np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True))
wet = np.vstack([fftconvolve(verb[c], ir[c])[:N] for c in range(2)])
mix = dry + 0.32 * wet
mix = np.vstack([filt(mix[c], "high", 28) for c in range(2)])
fo0, fo1 = Q["title"]["fadeOut"], Q["title"]["end"]
tfull = np.arange(N) / SR
mix *= np.clip((fo1 + 0.3 - tfull) / (fo1 + 0.3 - fo0), 0, 1)
mix = np.tanh(1.3 * mix / np.max(np.abs(mix)) * 1.15) / np.tanh(1.3 * 1.15)
mix *= 10 ** (-1.0 / 20)
out = Path(sys.argv[1] if len(sys.argv) > 1 else HERE / "out" / "audio.wav")
out.parent.mkdir(parents=True, exist_ok=True)
wavfile.write(out, SR, (mix.T * 32767).astype(np.int16))
print("wrote", out, f"{N / SR:.1f}s")
