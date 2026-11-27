"""Episode Studio sound design: the cinematic accents every episode gets, and a full fallback score.

    python3 score.py timeline.json fx.wav [pad.wav]

fx.wav:  a braam on every title card, a riser into it, a low hit and a short tail on every impact. Always made.
pad.wav: a score drawn from each scene's mood (sustained chords, a pulse under tense scenes, a heartbeat under dread),
         only when asked for: the engine's music model (ACE-Step) is the score when it's available.
timeline.json: {"total": s, "items": [{"kind", "start", "dur", "mood", "impacts"?: [s]}]}. 48 kHz stereo WAV out.
"""
import json
import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

SR = 48000
TL = json.load(open(sys.argv[1]))
N = int((float(TL["total"]) + 1.5) * SR)
rng = np.random.default_rng(7)


def t_(sec):
    return np.arange(int(sec * SR)) / SR


def lp(x, hz):
    return sosfilt(butter(4, hz, "low", fs=SR, output="sos"), x)


def hp(x, hz):
    return sosfilt(butter(2, hz, "high", fs=SR, output="sos"), x)


def put(buf, x, at):
    i = max(0, int(at * SR))
    n = min(len(x), len(buf) - i)
    if n > 0:
        buf[i:i + n] += x[:n]


def env(n, a=0.02, r=0.3):
    e = np.ones(n)
    ai, ri = max(1, int(a * SR)), max(1, int(r * SR))
    e[:ai] = np.linspace(0, 1, ai)
    e[-ri:] *= np.linspace(1, 0, ri)
    return e


def braam(sec=2.6):
    t = t_(sec)
    x = sum(np.sign(np.sin(2 * np.pi * f * t)) * w for f, w in ((43.65, 1.0), (43.9, 0.8), (87.3, 0.5), (65.4, 0.4)))
    x = lp(x + 0.3 * rng.normal(0, 1, len(t)), 900)
    return x * np.exp(-t / 1.4) * env(len(t), 0.01, 0.6) * 0.5


def riser(sec=1.6):
    t = t_(sec)
    x = hp(rng.normal(0, 1, len(t)), 600) * (t / sec) ** 2
    x += np.sin(2 * np.pi * (200 + 900 * (t / sec) ** 2) * t) * 0.15 * (t / sec)
    return x * 0.25


def hit():
    t = t_(1.2)
    x = np.sin(2 * np.pi * (60 * np.exp(-t * 6) + 35) * t) * np.exp(-t * 4)
    x += lp(rng.normal(0, 1, len(t)), 2500) * np.exp(-t * 18) * 0.7
    return x * 0.8


fx = np.zeros(N)
for it in TL["items"]:
    if it["kind"] == "card":
        put(fx, riser(), it["start"] - 1.6)
        put(fx, braam(min(3.2, it["dur"] + 0.8)), it["start"])
    for s in it.get("impacts") or []:
        put(fx, hit(), it["start"] + float(s))


def stereo(x, width=0.0):
    return np.stack([x * (1 - width), x * (1 + width)], axis=1)


def save(path, x):
    peak = np.max(np.abs(x)) or 1.0
    wavfile.write(path, SR, (x / peak * 0.7 * 32767).astype(np.int16))


save(sys.argv[2], stereo(fx))

if len(sys.argv) > 3:
    # Chords by mood (root Hz, intervals in semitones), a slow pad with a gentle tremolo; pulses and heartbeats on top.
    CHORDS = {
        "warm": (110, (0, 4, 7, 11)), "golden": (98, (0, 4, 7, 9)), "triumph": (98, (0, 4, 7, 12)), "romance": (110, (0, 3, 7, 10)),
        "cool": (82.4, (0, 3, 7, 10)), "night": (73.4, (0, 3, 7, 10)), "neon": (87.3, (0, 3, 7, 10)), "memory": (92.5, (0, 4, 7, 14)),
        "grief": (73.4, (0, 3, 7, 15)), "dread": (65.4, (0, 1, 6, 12)), "tension": (69.3, (0, 3, 6, 10)), "action": (82.4, (0, 7, 12, 15)),
    }
    pad = np.zeros(N)
    for it in TL["items"]:
        if it["kind"] != "shot":
            continue
        root, iv = CHORDS.get(it.get("mood", "golden"), CHORDS["golden"])
        sec = it["dur"] + 0.6
        t = t_(sec)
        x = sum(np.sin(2 * np.pi * root * 2 ** (s / 12) * t + rng.uniform(0, 6)) * (0.5 if s > 12 else 1) for s in iv)
        x = lp(x * (1 + 0.15 * np.sin(2 * np.pi * 0.3 * t)), 1800) * env(len(t), 0.3, 0.6) * 0.12
        if it.get("mood") in ("tension", "action", "night"):
            beat = 60 / 92
            k = (t % beat) < 0.08
            x += np.sin(2 * np.pi * 55 * t) * k * np.exp(-((t % beat) * 30)) * 0.5
        if it.get("mood") in ("dread", "grief"):
            hb = 60 / 58
            ph = t % hb
            x += np.sin(2 * np.pi * 48 * t) * (np.exp(-ph * 22) + 0.6 * np.exp(-np.maximum(0, ph - 0.22) * 22) * (ph > 0.22)) * 0.35
        put(pad, x, it["start"] - 0.3)
    save(sys.argv[3], stereo(pad, 0.08))
print("ok", flush=True)
