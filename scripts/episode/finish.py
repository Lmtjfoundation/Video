"""Episode Studio finishing pass, in 4K: every filmed shot conformed to its slot in the edit, graded by scene mood, film
grain and a vignette, special effects (rain, snow, embers, dust, fog, sparks, bloom, neon glow, anamorphic lens flares,
light leaks, film burn, glitches, heat haze, impact shakes and flashes), transitions between scenes (flash, whip pan,
glitch, light leak, dip to black, zoom punch, flashback dissolve), motion-graphics titles (location supers that wipe
in, name tags that slide in, animated title cards with drifting embers), speaker-labelled captions, then the mix.

    python3 finish.py spec.json out.mp4                      the whole episode, with its sound
    python3 finish.py spec.json seg.mp4 --items 10:20        items 10-19 only, pictures only (for parallel rendering;
                                                             the segments are joined and the mix added afterwards)
The spec (written by src/lib/episode-studio/run.ts):
  w, h, fps, total, fonts (folder with Cinzel-Variable.ttf, BebasNeue-Regular.ttf, Poppins-Bold.ttf), mix (WAV),
  accent [r, g, b], note (small line on the title card), limit (optional: stop early, for previews),
  items:    [{kind: "shot", id, start, dur, mood, clip, in?, out?, impacts?: [s], fx?: [name], transition?: name},
             {kind: "card", start, dur, text, sub?, style: "series" | "title" | "card" | "next", transition?: name}]
  captions: [{start, dur, speaker | null, text}]          (already split into readable chunks)
  supers:   {shotId: {title, sub?, seconds}}               (location / time, top left)
  tags:     {shotId: {name, role}}                         (a character's first appearance)
Prints one progress line per item ("item k/n"), then "done". Every effect is drawn procedurally from a fixed seed, so
a re-render (or a segment rendered on its own) comes out identical.
"""
import json
import math
import os
import subprocess
import sys
import zlib

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

SPEC = json.load(open(sys.argv[1]))
OUT = sys.argv[2]
RANGE = None
if "--items" in sys.argv:
    a, b = sys.argv[sys.argv.index("--items") + 1].split(":")
    RANGE = (int(a), int(b))
W, H, FPS = int(SPEC.get("w", 2160)), int(SPEC.get("h", 3840)), int(SPEC.get("fps", 24))
WIDE = W > H
U = min(W, H) / 1080  # type, layout and effect sizes scale with the short side
FONTS = SPEC["fonts"]
CINZEL, BEBAS, POP = (os.path.join(FONTS, f) for f in ("Cinzel-Variable.ttf", "BebasNeue-Regular.ttf", "Poppins-Bold.ttf"))
TOTAL = float(SPEC["total"])
END = min(TOTAL, float(SPEC.get("limit") or TOTAL))
ACCENT = tuple(int(c) for c in SPEC.get("accent", (232, 196, 112)))
ACC = np.array(ACCENT, np.float32) / 255
items = SPEC["items"]
frame_at = lambda s: int(round(s * FPS))


def font(path, size):
    return ImageFont.truetype(path, max(8, int(size)))


# ───────────── grades (float RGB 0..1) ─────────────
def tone(f, shadow, high, amt, sat=1.0, contrast=1.0, lift=0.0):
    lum = (f @ np.array([0.299, 0.587, 0.114], np.float32))[..., None]
    f = lum + (f - lum) * sat
    t = np.array(shadow, np.float32) * (1 - lum) + np.array(high, np.float32) * lum
    f = f * (1 - amt) + lum * t * (amt * 1.6)
    return np.clip((f - 0.5) * contrast + 0.5 + lift, 0, 1)


GRADES = {
    "warm": ((0.20, 0.16, 0.12), (1.0, 0.82, 0.55), 0.28, 1.12, 1.06, 0.0),
    "golden": ((0.12, 0.09, 0.06), (1.0, 0.80, 0.55), 0.35, 0.95, 1.12, 0.0),
    "cool": ((0.08, 0.20, 0.24), (0.90, 0.85, 0.80), 0.35, 0.80, 1.10, 0.0),
    "night": ((0.05, 0.12, 0.25), (0.95, 0.85, 0.80), 0.35, 0.95, 1.14, 0.0),
    "neon": ((0.16, 0.06, 0.22), (1.0, 0.70, 0.95), 0.30, 1.15, 1.08, 0.0),
    "dread": ((0.10, 0.16, 0.18), (0.95, 0.80, 0.62), 0.30, 0.92, 1.10, 0.0),
    "action": ((0.12, 0.10, 0.10), (1.0, 0.85, 0.70), 0.25, 0.80, 1.18, 0.0),
    "grief": ((0.08, 0.22, 0.26), (0.80, 0.92, 0.95), 0.40, 0.70, 1.04, 0.0),
    "tension": ((0.05, 0.12, 0.25), (0.95, 0.85, 0.80), 0.38, 0.90, 1.16, 0.0),
    "memory": ((0.12, 0.11, 0.10), (0.95, 0.88, 0.76), 0.65, 0.25, 1.08, 0.02),
    "triumph": ((0.12, 0.08, 0.05), (1.0, 0.78, 0.50), 0.40, 0.95, 1.18, 0.0),
    "romance": ((0.18, 0.10, 0.12), (1.0, 0.84, 0.76), 0.30, 1.05, 1.04, 0.01),
}
yy, xx = np.ogrid[:H, :W]
VIG = (1 - 0.38 * (((xx - W / 2) / (W / 2)) ** 2 * 0.8 + ((yy - H / 2) / (H / 2)) ** 2) ** 1.3).astype(np.float32)[..., None]
GRAIN = [cv2.resize(np.random.default_rng(i).normal(0, 1, (H // 3, W // 3)).astype(np.float32), (W, H))[..., None] for i in range(6)]
LW, LH = W // 4, H // 4  # the low-resolution canvas most effects are drawn on, then scaled up


def up(x):
    return cv2.resize(x, (W, H), interpolation=cv2.INTER_LINEAR)


def screen(f, layer):
    return 1 - (1 - f) * (1 - np.clip(layer, 0, 1))


# ───────────── special effects ─────────────
class FX:
    """One shot's effects, each drawn from the shot's own seed so every frame is reproducible."""

    def __init__(self, names, seed, dur, impacts):
        self.names = set(names or [])
        self.rng = np.random.default_rng(seed)
        self.dur = dur
        self.impacts = impacts
        r = self.rng
        self.p = {}
        if "rain" in self.names:
            n = 420
            self.p["rain"] = (r.uniform(0, LW, n), r.uniform(0, LH, n), r.uniform(0.8, 1.2, n))
        if "snow" in self.names:
            n = 260
            self.p["snow"] = (r.uniform(0, LW, n), r.uniform(0, LH, n), r.uniform(0.5, 1.5, n), r.uniform(0, 6.3, n))
        if "embers" in self.names:
            n = 110
            self.p["embers"] = (r.uniform(0, LW, n), r.uniform(0, LH, n), r.uniform(0.6, 1.4, n), r.uniform(0, 6.3, n))
        if "dust" in self.names:
            n = 160
            self.p["dust"] = (r.uniform(0, LW, n), r.uniform(0, LH, n), r.uniform(0.3, 1.0, n), r.uniform(0, 6.3, n))
        if "fog" in self.names:
            self.p["fog"] = [cv2.GaussianBlur(r.random((LH // 4, LW // 2)).astype(np.float32), (0, 0), 3) for _ in range(2)]
        if "sparks" in self.names or impacts:
            bursts = list(impacts) or [dur * 0.3, dur * 0.7]
            self.p["sparks"] = [(t0, r.uniform(LW * 0.3, LW * 0.7), r.uniform(LH * 0.45, LH * 0.75), r.uniform(-1, 1, 60), r.uniform(-1.6, -0.2, 60)) for t0 in bursts]
        if "glitch" in self.names:
            self.p["glitch"] = sorted(r.uniform(0.2, max(0.3, dur - 0.3), 3))
        if "lens_flare" in self.names:
            self.p["flare"] = None  # placed on the brightest point of the first frame
        if "light_leak" in self.names:
            self.p["leak"] = (r.uniform(0, 1), r.choice([-1, 1]))

    def apply(self, f, lt, k):
        n = self.names
        if "heat_haze" in n:
            if "haze" not in self.p:
                self.p["haze"] = (np.repeat(np.arange(H, dtype=np.float32)[:, None], W, axis=1), np.arange(H, dtype=np.float32)[:, None], np.arange(W, dtype=np.float32)[None, :])
            my, rows, cols = self.p["haze"]
            mx = cols + (np.sin(rows / (H / 40) + lt * 6) * 1.2 * U).astype(np.float32)
            f = cv2.remap(f, np.ascontiguousarray(np.broadcast_to(mx, (H, W))), my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        if "bloom" in n or "neon" in n:
            small = cv2.resize(f, (LW, LH), interpolation=cv2.INTER_AREA)
            lum = small @ np.array([0.299, 0.587, 0.114], np.float32)
            hl = small * np.clip((lum - 0.62) / 0.3, 0, 1)[..., None]
            glow = cv2.GaussianBlur(hl, (0, 0), 10 * U / 2)
            if "neon" in n:
                glow = glow * np.array([1.15, 0.7, 1.2], np.float32)
            f = f + up(glow) * (0.75 if "neon" in n else 0.45)
        if "fog" in n:
            a, b = self.p["fog"]
            fh, fw = a.shape
            drift = lambda fld, speed: cv2.warpAffine(fld, np.float32([[1, 0, -lt * speed], [0, 1, 0]]), (fw, fh), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
            fog = cv2.resize(drift(a, 3.0) * 0.6 + drift(b, -1.8) * 0.4, (W, H), interpolation=cv2.INTER_CUBIC)
            f = screen(f, (fog[..., None] * 0.32) * np.array([0.78, 0.82, 0.86], np.float32))
        layer = np.zeros((LH, LW, 3), np.float32)
        if "rain" in n:
            x0, y0, s = self.p["rain"]
            vy = LH * 1.7 * s
            y = (y0 + vy * lt) % LH
            x = (x0 + vy * 0.12 * lt) % LW
            L = LH * 0.04
            for xi, yi in zip(x.astype(int), y.astype(int)):
                cv2.line(layer, (xi, yi), (int(xi - L * 0.12), int(yi - L)), (0.55, 0.6, 0.68), 1, cv2.LINE_AA)
            f = f * 0.93 + np.array([0.0, 0.005, 0.02], np.float32)
        if "snow" in n:
            x0, y0, s, ph = self.p["snow"]
            y = (y0 + LH * 0.09 * s * lt) % LH
            x = (x0 + np.sin(lt * 1.3 + ph) * LW * 0.015) % LW
            for xi, yi, si in zip(x.astype(int), y.astype(int), s):
                cv2.circle(layer, (xi, yi), max(1, int(si * 1.4)), (0.9, 0.92, 0.95), -1, cv2.LINE_AA)
        if "dust" in n:
            x0, y0, s, ph = self.p["dust"]
            y = (y0 - LH * 0.01 * s * lt + np.sin(lt * 0.7 + ph) * 3) % LH
            x = (x0 + LW * 0.012 * s * lt) % LW
            for xi, yi, si in zip(x.astype(int), y.astype(int), s):
                cv2.circle(layer, (xi, yi), 1, (0.35 * si, 0.32 * si, 0.26 * si), -1, cv2.LINE_AA)
        if "embers" in n:
            x0, y0, s, ph = self.p["embers"]
            y = (y0 - LH * 0.12 * s * lt) % LH
            x = (x0 + np.sin(lt * 2 + ph) * LW * 0.02) % LW
            flick = 0.6 + 0.4 * np.sin(lt * 9 + ph * 3)
            for xi, yi, si, fl in zip(x.astype(int), y.astype(int), s, flick):
                cv2.circle(layer, (xi, yi), max(1, int(si * 1.2)), (1.0 * fl, 0.5 * fl, 0.12 * fl), -1, cv2.LINE_AA)
        if "sparks" in self.p:
            for t0, cx, cy, vx, vy in self.p["sparks"]:
                age = lt - t0
                if 0 <= age < 0.7:
                    g = LH * 1.2
                    px = cx + vx * LW * 0.35 * age
                    py = cy + vy * LH * 0.35 * age + 0.5 * g * age * age
                    fade = 1 - age / 0.7
                    for a, b2, c, d in zip(px, py, px - vx * 6, py - vy * 6 - g * age * 0.02):
                        cv2.line(layer, (int(a), int(b2)), (int(c), int(d)), (1.0 * fade, 0.85 * fade, 0.45 * fade), 1, cv2.LINE_AA)
        if "light_leak" in n:
            x0, d = self.p["leak"]
            cx = (x0 + d * lt / max(self.dur, 0.5)) * LW
            gy, gx = np.ogrid[:LH, :LW]
            leak = np.exp(-(((gx - cx) / (LW * 0.35)) ** 2 + ((gy - LH * 0.3) / (LH * 0.5)) ** 2)).astype(np.float32)
            layer += leak[..., None] * np.array([0.55, 0.22, 0.06], np.float32)
        if "film_burn" in n:
            p = max(0.0, 1 - lt / 0.7) + max(0.0, 1 - (self.dur - lt) / 0.6)
            if p > 0:
                gy, gx = np.ogrid[:LH, :LW]
                burn = np.exp(-((gx / (LW * 0.45)) ** 2 + ((gy - LH) / (LH * 0.5)) ** 2)).astype(np.float32) * p
                layer += burn[..., None] * np.array([1.0, 0.45, 0.1], np.float32)
        if layer.any():
            layer = cv2.GaussianBlur(layer, (0, 0), 0.8)
            if "embers" in n or "sparks" in self.p:
                layer = layer + cv2.GaussianBlur(layer, (0, 0), 3) * 1.2  # glow around hot particles
            f = screen(f, up(layer))
        if "lens_flare" in n:
            if self.p["flare"] is None:
                small = cv2.GaussianBlur(cv2.resize(f, (LW, LH)) @ np.array([0.299, 0.587, 0.114], np.float32), (0, 0), 4)
                yx = np.unravel_index(np.argmax(small), small.shape)
                self.p["flare"] = (yx[1] / LW, yx[0] / LH)
            fx_, fy_ = self.p["flare"]
            cx, cy = (fx_ + 0.03 * math.sin(lt * 0.6)) * LW, fy_ * LH
            gy, gx = np.ogrid[:LH, :LW]
            streak = np.exp(-(((gy - cy) / (1.2 * U)) ** 2) - ((gx - cx) / (LW * 0.6)) ** 2).astype(np.float32)
            core = np.exp(-(((gx - cx) / (6 * U)) ** 2 + ((gy - cy) / (6 * U)) ** 2)).astype(np.float32)
            fl = streak[..., None] * np.array([0.35, 0.55, 0.9], np.float32) * 0.8 + core[..., None] * 0.6
            for k2, sz in ((0.6, 10), (1.3, 6), (1.7, 14)):  # ghosts along the line through the centre
                gx2, gy2 = cx + (LW / 2 - cx) * k2, cy + (LH / 2 - cy) * k2
                ghost = np.exp(-(((gx - gx2) / (sz * U)) ** 2 + ((gy - gy2) / (sz * U)) ** 2)).astype(np.float32)
                fl += ghost[..., None] * np.array([0.25, 0.3, 0.45], np.float32) * 0.35
            f = screen(f, up(fl))
        if "glitch" in self.p and any(0 <= lt - g < 3 / FPS for g in self.p["glitch"]):
            f = glitch(f, k)
        for st in self.impacts:  # a hit: a short shake and one bright frame
            if 0 <= lt - st < 0.35:
                a = 14 * U * math.exp(-(lt - st) / 0.08)
                r = np.random.default_rng(k)
                M = np.float32([[1.04, 0, -W * 0.02 + r.uniform(-a, a)], [0, 1.04, -H * 0.02 + r.uniform(-a, a)]])
                f = cv2.warpAffine(f, M, (W, H), borderMode=cv2.BORDER_REFLECT)
            if 0 <= lt - st < 1 / FPS:
                f = np.clip(f * 1.5 + 0.12, 0, 1)
        return f


def glitch(f, k, strength=1.0):
    r = np.random.default_rng(k + 99)
    d = int(r.integers(8, 22) * U * strength)
    g = f.copy()
    g[..., 0] = np.roll(f[..., 0], -d, axis=1)
    g[..., 2] = np.roll(f[..., 2], d, axis=1)
    for _ in range(int(6 * strength) + 1):
        y0 = int(r.integers(0, H - 10))
        hh = int(r.integers(4, 60) * U)
        g[y0:y0 + hh] = np.roll(g[y0:y0 + hh], int(r.integers(-80, 80) * U), axis=1)
    g[::max(2, int(3 * U))] *= 0.85  # scanlines
    return g


# ───────────── transitions (into an item, over its first moments) ─────────────
def transition(kind, f, prev, lt, k):
    if kind == "flash" and lt < 0.3:
        return f + (1 - f) * (1 - lt / 0.3) ** 2
    if kind == "dip_black" and lt < 0.35:
        return f * (lt / 0.35)
    if kind == "zoom_punch" and lt < 0.3:
        s = 1 + 0.12 * (1 - lt / 0.3) ** 2
        M = cv2.getRotationMatrix2D((W / 2, H / 2), 0, s)
        f = cv2.warpAffine(f, M, (W, H), borderMode=cv2.BORDER_REFLECT)
        return f + (1 - f) * max(0, 0.35 - lt) * 1.5
    if prev is None:
        return f
    if kind == "whip" and lt < 0.28:
        a = lt / 0.28
        shift = int((1 - a) * W * 0.35)
        inc = np.roll(f, shift, axis=1)
        out = np.roll(prev, shift - int(W * 0.35), axis=1)
        mix = inc * a + out * (1 - a)
        k_ = max(1, int((1 - a) * W * 0.06))
        return cv2.blur(mix, (k_, 1))
    if kind == "glitch" and lt < 0.3:
        a = lt / 0.3
        return glitch(f * a + prev * (1 - a), k, 1.5 * (1 - a))
    if kind == "light_leak" and lt < 0.5:
        a = lt / 0.5
        base = f * min(1, a * 2) + prev * max(0, 1 - a * 2)
        gy, gx = np.ogrid[:LH, :LW]
        leak = np.exp(-(((gx - LW * (0.2 + 0.6 * a)) / (LW * 0.5)) ** 2 + ((gy - LH * 0.4) / (LH * 0.6)) ** 2)).astype(np.float32)
        return screen(base, up(leak[..., None] * np.array([1.0, 0.55, 0.2], np.float32) * (1 - a) * 1.2))
    if kind == "dissolve" and lt < 0.4:
        a = lt / 0.4
        return f * a + prev * (1 - a)
    return f


# ───────────── motion-graphics text layers (RGBA float) ─────────────
def layer():
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def to_arr(im):
    return np.asarray(im, np.float32) / 255


def over(f, rgba, alpha=1.0, dx=0, wipe=None):
    a = rgba[..., 3:4] * alpha
    rgb = rgba[..., :3]
    if dx:
        a = np.roll(a, dx, axis=1)
        rgb = np.roll(rgb, dx, axis=1)
    if wipe is not None:
        a = a * (np.arange(W)[None, :, None] < wipe)
    return f * (1 - a) + rgb * a


def _greedy(words, fnt, maxw, draw):
    lines, cur = [], ""
    for w_ in words:
        t = (cur + " " + w_).strip()
        if not cur or draw.textlength(t, font=fnt) <= maxw:
            cur = t
        else:
            lines.append(cur)
            cur = w_
    if cur:
        lines.append(cur)
    return lines


def wrap(text, fnt, maxw, draw):
    """Balanced wrap: as many lines as a greedy wrap needs, but of even width (no one-word orphan line)."""
    words = text.split()
    best = _greedy(words, fnt, maxw, draw)
    n = len(best)
    w_ = draw.textlength(text, font=fnt) / max(1, n)
    while w_ <= maxw:
        cand = _greedy(words, fnt, w_, draw)
        if len(cand) == n:
            return cand
        w_ += 12 * U
    return best


# Captions sit above the bottom bar of TikTok, Reels and Shorts on vertical video; low and centred on wide video.
CAP_BASE = H - (430 * U if not WIDE else 120 * U)


def caption_layer(speaker, text):
    im = layer()
    d = ImageDraw.Draw(im)
    f = font(POP, 46 * U)
    fs = font(POP, 34 * U)
    lines = wrap(text, f, W - (160 * U if not WIDE else 520 * U), d)
    lh = 60 * U
    y = CAP_BASE - lh * (len(lines) - 1)
    if speaker:
        sw = d.textlength(speaker, font=fs)
        d.text(((W - sw) / 2, y - 50 * U), speaker, font=fs, fill=ACCENT + (255,), stroke_width=max(1, int(3 * U)), stroke_fill=(0, 0, 0, 200))
    for i, ln in enumerate(lines):
        tw = d.textlength(ln, font=f)
        d.text(((W - tw) / 2, y + i * lh), ln, font=f, fill=(255, 255, 255, 255), stroke_width=max(1, int(4 * U)), stroke_fill=(0, 0, 0, 220))
    return to_arr(im)


def super_layer(text, sub=None):
    im = layer()
    d = ImageDraw.Draw(im)
    f = font(BEBAS, 64 * U)
    fs = font(POP, 28 * U)
    x, y = 90 * U, (210 if not WIDE else 90) * U
    d.text((x, y), text, font=f, fill=(255, 255, 255, 235), stroke_width=max(1, int(2 * U)), stroke_fill=(0, 0, 0, 160))
    d.rectangle([x, y + 78 * U, x + 120 * U, y + 84 * U], fill=ACCENT + (230,))
    if sub:
        d.text((x, y + 98 * U), sub, font=fs, fill=(230, 230, 230, 220), stroke_width=max(1, int(2 * U)), stroke_fill=(0, 0, 0, 160))
    return to_arr(im)


def nametag_layer(name, role):
    im = layer()
    d = ImageDraw.Draw(im)
    f = font(BEBAS, 58 * U)
    fs = font(POP, 26 * U)
    x0 = 60 * U
    y = H - (780 if not WIDE else 330) * U
    w_ = max(d.textlength(name, font=f), d.textlength(role or "", font=fs)) + 60 * U
    d.rectangle([x0, y - 10 * U, x0 + w_, y + 112 * U], fill=(0, 0, 0, 150))
    d.rectangle([x0, y - 10 * U, x0 + 8 * U, y + 112 * U], fill=ACCENT + (255,))
    d.text((x0 + 30 * U, y), name, font=f, fill=(255, 255, 255, 255))
    if role:
        d.text((x0 + 30 * U, y + 66 * U), role, font=fs, fill=ACCENT + (255,))
    return to_arr(im)


CARD_FX = {}


def card_frame(it, t, k):
    """Animated title cards: the title rises in, an accent line draws itself out from the centre, embers drift up
    through a slow light sweep, the subtitle fades in after the title."""
    text, sub, dur, style = it["text"], it.get("sub"), it["dur"], it.get("style", "card")
    im = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(im)
    p = min(1, t / 0.9)
    big = style == "series"
    f = font(CINZEL, (132 if big else 96) * U)
    try:
        f.set_variation_by_axes([700])
    except Exception:
        pass
    tw = d.textlength(text, font=f)
    if tw > W - 120 * U:
        f = font(CINZEL, (132 if big else 96) * U * (W - 120 * U) / tw)
        tw = d.textlength(text, font=f)
    y = H * 0.44 + (1 - p) ** 2 * 40 * U
    d.text(((W - tw) / 2, y), text, font=f, fill=ACCENT if big else (240, 240, 240))
    line = tw * 0.6 * min(1, max(0, (t - 0.35) / 0.6))
    ly = y + (165 if big else 125) * U
    if line > 2:
        d.rectangle([W / 2 - line / 2, ly, W / 2 + line / 2, ly + 3 * U], fill=ACCENT)
    if sub:
        fs = font(POP, (40 if len(sub) < 14 else 30) * U)
        sw = d.textlength(sub, font=fs)
        sa = min(1, max(0, (t - 0.6) / 0.5))
        col = (205, 60, 50) if style == "next" else (200, 200, 200)
        d.text(((W - sw) / 2, ly + 28 * U), sub, font=fs, fill=tuple(int(c * sa) for c in col))
    if style == "title" and SPEC.get("note"):
        fn = font(POP, 22 * U)
        note = SPEC["note"]
        d.text(((W - d.textlength(note, font=fn)) / 2, H - (260 if not WIDE else 90) * U), note, font=fn, fill=(120, 120, 120))
    out = max(0, min(1, (dur - t) / 0.5))
    fr = np.asarray(im, np.float32) / 255 * (min(1, t / 0.5) * out)
    sweep = np.exp(-(((xx - (-300 * U + (W + 600 * U) * min(1, t / max(dur, 0.1)))) / (260.0 * U)) ** 2)).astype(np.float32)[..., None]
    fr = np.clip(fr + fr * sweep * 0.6, 0, 1)
    key = id(it)
    if key not in CARD_FX:
        CARD_FX[key] = FX(["embers", "dust"], int(it["start"] * 1000) + 7, dur, [])
    return np.clip(CARD_FX[key].apply(fr, t, k) * out + fr * (1 - out), 0, 1)


def probe_duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True).stdout
    try:
        return float(out)
    except ValueError:
        return 0.0


def clip_frames(it, n):
    """Streams exactly n frames of the shot at the output size (no whole clip held in memory at 4K). A trimmed take
    (in/out) or a clip shorter than its slot is retimed to fill it, with motion interpolation when slowed down."""
    path, dur = it.get("clip"), it["dur"]
    if not path or not os.path.exists(path):
        for _ in range(n):
            yield np.zeros((H, W, 3), np.float32)
        return
    have = probe_duration(path)
    a, b = float(it.get("in", 0)), min(float(it.get("out", 1e9)), have or 1e9)
    if b - a < 0.3:
        a, b = 0.0, have
    k = dur / max(0.1, b - a)
    vf = f"trim=start={a:.3f}:end={b:.3f},setpts=(PTS-STARTPTS)*{max(1.0, k):.4f}"
    vf += f",minterpolate=fps={FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1" if k > 1.02 else f",fps={FPS}"
    # Smaller sources: Lanczos to the frame, then a detail pass (an unsharp mask scaled with the upscale ratio).
    vf += f",scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H},unsharp=7:7:{0.5 + 0.15 * U:.2f}:5:5:0.0,tpad=stop_mode=clone:stop_duration=2"
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-vf", vf, "-frames:v", str(n), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    size = W * H * 3
    last = None
    for _ in range(n):
        buf = p.stdout.read(size)
        if len(buf) == size:
            last = np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.float32) / 255
        yield last if last is not None else np.zeros((H, W, 3), np.float32)
    p.stdout.close()
    p.wait()


CAPS = [(c["start"], c["start"] + c["dur"], caption_layer(c.get("speaker"), c["text"])) for c in SPEC.get("captions", [])]
SUPERS = {k: (super_layer(v["title"], v.get("sub")), float(v.get("seconds", 3.0))) for k, v in SPEC.get("supers", {}).items()}
TAGS = {k: nametag_layer(v["name"], v.get("role", "")) for k, v in SPEC.get("tags", {}).items()}


def finished_frame(f, it, lt, k):
    """Grade, film texture and the shot's motion graphics on one frame of footage."""
    mood = it.get("mood", "golden")
    g = GRADES.get(mood, GRADES["golden"])
    f = tone(f, *g)
    if mood == "memory":  # old film: flicker and heavier grain
        f = f * (0.93 + 0.07 * np.random.default_rng(k).random())
    f = f * VIG + GRAIN[k % len(GRAIN)] * (0.045 if mood == "memory" else 0.02)
    sid = it["id"]
    if sid in SUPERS and lt < SUPERS[sid][1]:
        lay, sec = SUPERS[sid]
        a = min(1, lt / 0.3, (sec - lt) / 0.35)
        f = over(f, lay, a, wipe=W * min(1, lt / 0.55) + 1)  # wipes on left to right
    if sid in TAGS and 0.4 <= lt < 3.4:
        a = min(1, (lt - 0.4) / 0.25, (3.4 - lt) / 0.3)
        slide = int(-60 * U * (1 - min(1, (lt - 0.4) / 0.35)) ** 2)
        f = over(f, TAGS[sid], a, dx=slide)
    return f


def last_frame_of(i):
    """The finished last frame of item i (for a transition at the start of a segment rendered on its own)."""
    it = items[i]
    n = frame_at(it["start"] + it["dur"]) - frame_at(it["start"])
    if it["kind"] == "card":
        return card_frame(it, it["dur"] - 1 / FPS, frame_at(it["start"]) + n - 1)
    f = None
    for f in clip_frames(it, n):
        pass
    return finished_frame(f, it, it["dur"] - 1 / FPS, frame_at(it["start"]) + n - 1) if f is not None else None


def effective_transition(ii):
    """The transition into item ii: the plan's, or a dissolve into and out of a flashback."""
    it = items[ii]
    trans = it.get("transition") or "cut"
    if trans == "cut" and ii > 0 and it["kind"] == "shot" and items[ii - 1]["kind"] == "shot":
        pm, m = items[ii - 1].get("mood"), it.get("mood")
        if m != pm and "memory" in (m, pm):
            trans = "dissolve"
    return trans


lo, hi = RANGE if RANGE else (0, len(items))
hi = min(hi, len(items))
cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-"]
if RANGE:  # a segment: pictures only, joined and mixed afterwards
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "19", "-maxrate", "45M", "-bufsize", "90M", "-pix_fmt", "yuv420p", "-an", OUT]
else:
    cmd += ["-i", SPEC["mix"], "-map", "0:v", "-map", "1:a",
            "-af", "loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.85:level=false" + (f",afade=t=out:st={END - 1.5:.2f}:d=1.5" if END < TOTAL else ""),
            "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-maxrate", "45M", "-bufsize", "90M", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k",
            "-t", f"{END:.3f}", "-movflags", "+faststart", OUT]
enc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

written = 0
prev_last = last_frame_of(lo - 1) if 0 < lo < len(items) and effective_transition(lo) != "cut" else None
for ii in range(lo, hi):
    it = items[ii]
    if frame_at(it["start"]) >= frame_at(END):
        break
    n = frame_at(it["start"] + it["dur"]) - frame_at(it["start"])
    k0 = frame_at(it["start"])
    trans = effective_transition(ii)
    fx = FX(it.get("fx"), zlib.crc32(it.get("id", "").encode()) % 65536 + 13, it["dur"], it.get("impacts") or []) if it["kind"] == "shot" else None
    src = clip_frames(it, n) if it["kind"] == "shot" else None
    f = None
    for i in range(n):
        k = k0 + i
        if k >= frame_at(END):
            break
        t = k / FPS
        lt = i / FPS
        if src is None:
            f = card_frame(it, lt, k)
        else:
            f = next(src)
            f = fx.apply(f, lt, k)
            f = finished_frame(f, it, lt, k)
        f = transition(trans, f, prev_last, lt, k)
        for c0, c1, cl in CAPS:
            if c0 <= t < c1:
                f = over(f, cl, min(1, (t - c0) / 0.12, (c1 - t) / 0.12))
                break
        f = np.clip(f, 0, 1) * max(0, min(1, t / 0.4, (END - t) / 0.8))
        enc.stdin.write((f * 255).astype(np.uint8).tobytes())
        written += 1
    if f is not None:
        prev_last = f.copy()
    print(f"item {ii + 1}/{len(items)}", flush=True)
while not RANGE and written < frame_at(END):  # the mix runs a touch longer than the pictures: hold black
    enc.stdin.write(np.zeros((H, W, 3), np.uint8).tobytes())
    written += 1
enc.stdin.close()
code = enc.wait()
if code:
    sys.exit(f"ffmpeg failed ({code})")
print("done", OUT, written, "frames", flush=True)
