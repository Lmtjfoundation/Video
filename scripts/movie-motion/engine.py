#!/usr/bin/env python3
"""
Ghost Post motion engine: turns still pictures into movie-style shots on a CPU.

  python engine.py film.json out.mp4

film.json: {"w":1080,"h":1920,"fps":30,"grade":"cadmium_purple","fiction":true,"scenes":[{
   "image": "scene.png", "dur": 4.0,
   "move": "push_in|pull_back|tilt_up|crane_down|dolly|circle|track|crash_zoom|handheld|static",
   "effects": ["fog","dust","beam","frost","flicker","shake","quake","rain","shatter","bubbles","ghost","wounds",
               "salt","steam","embers","glow","whip_in","flash_in","leak_in","bars","bars_open"],
   "title": "Midnight deadline.", "title_style": "slam|type|whisper", "caption": "K-Von: \"...\"",
   "focus": [0.5, 0.45]   # where effects like shatter/steam/ghost centre (fractions of the frame)
 }]}

Each shot gets a real 2.5D camera move: a depth map (Depth-Anything-V2-Small) separates near from far, so the
foreground slides over the background as the camera moves. Effects, colour grade, grain, gate weave, vignette,
cinema bars and kinetic titles are drawn on every frame, and the frames go straight into ffmpeg.
"""
import json
import math
import os
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FONTS = os.path.join(ROOT, "assets", "fonts")
SS = 1.22  # source oversize, so camera moves never show an edge

_depth_pipe = None


def depth_of(path, cache):
    """Depth map in 0..1 (1 = near), cached next to the picture."""
    global _depth_pipe
    if os.path.exists(cache):
        return cv2.imread(cache, cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255.0
    if _depth_pipe is None:
        try:
            if os.environ.get("MOVIE_DEPTH") == "0":
                raise ImportError("depth switched off")
            from transformers import pipeline

            _depth_pipe = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device="cpu")
        except Exception as e:  # no depth model on this server: a soft "near at the bottom, far at the top" guess
            print(f"depth model unavailable ({e}); using a gradient", flush=True)
            _depth_pipe = False
    if _depth_pipe is False:
        h, w = cv2.imread(path, cv2.IMREAD_GRAYSCALE).shape
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        return np.clip(0.25 + 0.6 * yy / h - 0.25 * np.abs(xx / w - 0.5), 0, 1)
    d = np.asarray(_depth_pipe(Image.open(path).convert("RGB"))["depth"], dtype=np.float32)
    d = (d - d.min()) / max(1e-6, d.max() - d.min())
    cv2.imwrite(cache, (d * 255).astype(np.uint8))
    return d


def cover(img, w, h):
    """Cover-resize an image (numpy HxWxC) to exactly w x h."""
    ih, iw = img.shape[:2]
    s = max(w / iw, h / ih)
    r = cv2.resize(img, (math.ceil(iw * s), math.ceil(ih * s)), interpolation=cv2.INTER_LANCZOS4 if s > 1 else cv2.INTER_AREA)
    y, x = (r.shape[0] - h) // 2, (r.shape[1] - w) // 2
    return r[y : y + h, x : x + w]


ease = lambda u: u * u * (3 - 2 * u)
ease_out = lambda u: 1 - (1 - u) ** 3


def camera(move, u, rng_walk):
    """Zoom, pan (fractions of the frame) and parallax strength for a move at progress u (0..1)."""
    e = ease(u)
    z, tx, ty, par = 1.06, 0.0, 0.0, 0.035
    if move == "push_in":
        z, par = 1.0 + 0.16 * e, 0.03 + 0.03 * e
    elif move == "pull_back":
        z, par = 1.18 - 0.16 * e, 0.06 - 0.03 * e
    elif move == "tilt_up":
        z, ty, par = 1.12, 0.09 - 0.18 * e, 0.04
    elif move == "crane_down":
        z, ty, par = 1.16 - 0.08 * e, -0.09 + 0.16 * e, 0.05
    elif move == "dolly":
        z, par = 1.0 + 0.24 * e, 0.05 + 0.04 * e
    elif move == "circle":
        a = (u - 0.5) * math.pi * 0.9
        z, tx, ty, par = 1.13, 0.06 * math.sin(a), 0.02 * math.cos(a), 0.06
    elif move == "track":
        z, tx, par = 1.12, -0.07 + 0.14 * e, 0.06
    elif move == "crash_zoom":
        z, par = 1.0 + 0.42 * ease_out(min(1.0, u / 0.22)) + 0.04 * u, 0.04
    elif move == "handheld":
        z, par = 1.1 + 0.03 * e, 0.035
    elif move == "punch":  # a tight punch-in on the subject (the second shot of a scene)
        z, par = 1.3 + 0.05 * e, 0.03
    elif move == "static":
        z, par = 1.06 + 0.015 * e, 0.02
    hx, hy = rng_walk
    return z, tx + hx, ty + hy, par


class Noise:
    """Tileable fractal noise textures for fog, mist and frost."""

    def __init__(self, w, h, seed):
        rng = np.random.default_rng(seed)
        acc = np.zeros((h, w), np.float32)
        for octave, amp in ((6, 0.5), (12, 0.25), (24, 0.15), (48, 0.1)):
            small = rng.random((max(2, h * octave // w), octave)).astype(np.float32)
            acc += amp * cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)
        self.tex = cv2.normalize(acc, None, 0, 1, cv2.NORM_MINMAX)

    def sample(self, dx, dy):
        return np.roll(np.roll(self.tex, int(dy) % self.tex.shape[0], 0), int(dx) % self.tex.shape[1], 1)


class Particles:
    def __init__(self, n, w, h, seed, kind):
        r = np.random.default_rng(seed)
        self.kind, self.w, self.h = kind, w, h
        self.x, self.y = r.random(n) * w, r.random(n) * h
        self.s = r.random(n)
        self.ph = r.random(n) * 6.28
        self.vx = (r.random(n) - 0.5) * (2 if kind == "dust" else 0.6)
        self.vy = {"dust": -0.25, "salt": 9.0, "rain": 34.0, "bubbles": -3.5, "embers": -2.2}[kind] * (0.6 + r.random(n))

    def draw(self, t, layer):
        x = (self.x + self.vx * t * 30 + (6 * np.sin(t * 1.3 + self.ph) if self.kind == "dust" else 0)) % self.w
        y = (self.y + self.vy * t * 30) % self.h
        for i in range(len(x)):
            xi, yi = int(x[i]), int(y[i])
            if self.kind == "rain":
                cv2.line(layer, (xi, yi), (xi - 3, yi - 26), 0.55, 1, cv2.LINE_AA)
            elif self.kind == "bubbles":
                r_ = 2 + int(self.s[i] * 7)
                cv2.circle(layer, (xi, yi), r_, 0.8, 1, cv2.LINE_AA)
                cv2.circle(layer, (xi - r_ // 3, yi - r_ // 3), max(1, r_ // 4), 1.0, -1, cv2.LINE_AA)
            else:
                r_ = 1 + int(self.s[i] * (3 if self.kind == "salt" else 2))
                b = 0.5 + 0.5 * math.sin(t * 7 + self.ph[i]) if self.kind in ("salt", "embers") else 0.4 + 0.6 * self.s[i]
                cv2.circle(layer, (xi, yi), r_, float(b), -1, cv2.LINE_AA)


def grade(f, name):
    """Split-tone colour grade with a gentle S-curve."""
    if name == "none":
        return f
    lum = f @ np.array([0.299, 0.587, 0.114], np.float32)
    lum3 = lum[..., None]
    if name == "cadmium_purple":
        shadow, high = np.array([0.42, 0.20, 0.55], np.float32), np.array([1.0, 0.80, 0.30], np.float32)
    elif name == "teal_orange":
        shadow, high = np.array([0.10, 0.35, 0.42], np.float32), np.array([1.0, 0.72, 0.45], np.float32)
    elif name == "noir":
        g = np.clip((lum3 - 0.5) * 1.35 + 0.5, 0, 1)
        return np.repeat(g, 3, axis=2)
    else:  # warm
        shadow, high = np.array([0.30, 0.22, 0.18], np.float32), np.array([1.0, 0.86, 0.66], np.float32)
    tone = shadow * (1 - lum3) + high * lum3
    out = f * 0.62 + (lum3 * tone) * 0.55
    out = np.clip((out - 0.5) * 1.12 + 0.5, 0, 1)
    return out


def text_layer(w, h, text, style, kind):
    """RGBA picture of a title or caption."""
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if kind == "caption":
        f = ImageFont.truetype(os.path.join(FONTS, "Poppins-Bold.ttf"), 50)
        words, lines, line = text.split(), [], ""
        for wd in words:
            tst = (line + " " + wd).strip()
            if d.textlength(tst, font=f) > w - 160:
                lines.append(line)
                line = wd
            else:
                line = tst
        lines.append(line)
        y = int(h * 0.70)
        for ln in lines:
            tw = d.textlength(ln, font=f)
            d.text(((w - tw) / 2, y), ln, font=f, fill=(255, 255, 255, 255), stroke_width=5, stroke_fill=(0, 0, 0, 255))
            y += 66
        return im
    size = {"slam": 150, "type": 96, "whisper": 70}.get(style, 120)
    f = ImageFont.truetype(os.path.join(FONTS, "BebasNeue-Regular.ttf"), size)
    txt = text.upper()
    track = {"slam": 4, "type": 10, "whisper": 14}.get(style, 6)
    widths = [d.textlength(c, font=f) for c in txt]
    total = sum(widths) + track * (len(txt) - 1)
    if total > w - 120:  # wrap long titles onto two lines
        mid = len(txt) // 2
        cut = txt.rfind(" ", 0, mid + 1) if " " in txt else mid
        cut = cut if cut > 0 else mid
        for i, part in enumerate((txt[:cut].strip(), txt[cut:].strip())):
            sub = text_layer(w, h, part, style, "title")
            im.alpha_composite(sub, (0, int((i - 0.5) * size * 0.95)))
        return im
    x, y = (w - total) / 2, h * 0.16
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for c, cw in zip(txt, widths):
        gd.text((x, y), c, font=f, fill=(255, 196, 70, 255))
        d.text((x, y), c, font=f, fill=(255, 246, 228, 255), stroke_width=2, stroke_fill=(0, 0, 0, 200))
        x += cw + track
    glow = glow.filter(ImageFilter.GaussianBlur(18))
    out = Image.alpha_composite(glow, im)
    return out


def crack_layer(w, h, cx, cy, seed):
    r = np.random.default_rng(seed)
    layer = np.zeros((h, w), np.float32)
    for _ in range(14):
        a = r.random() * 6.283
        x, y = cx, cy
        for _ in range(9):
            nx = x + math.cos(a) * r.uniform(40, 120)
            ny = y + math.sin(a) * r.uniform(40, 120)
            cv2.line(layer, (int(x), int(y)), (int(nx), int(ny)), 1.0, 2, cv2.LINE_AA)
            x, y, a = nx, ny, a + r.uniform(-0.5, 0.5)
    return cv2.GaussianBlur(layer, (3, 3), 0)


def encoder(path, W, H, FPS, fast=False):
    return subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-preset", "veryfast" if fast else "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path],
        stdin=subprocess.PIPE,
    )


def render(film, out):
    """Render the film to `out`. With "split": true, `out` is a file prefix and each scene group ("group", default the
    scene's index) goes to its own file, <out><group:03d>.mp4: a video maker can then put its own captions on each."""
    W, H, FPS = film.get("w", 1080), film.get("h", 1920), film.get("fps", 30)
    gname = film.get("grade", "cadmium_purple")
    split = bool(film.get("split"))
    clean = bool(film.get("clean"))
    group = None
    enc = None if split else encoder(out, W, H, FPS)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    vign = 1 - 0.55 * (((xx - W / 2) / (W * 0.75)) ** 2 + ((yy - H / 2) / (H * 0.68)) ** 2)
    vign = np.clip(vign, 0.35, 1)[..., None].astype(np.float32)
    grains = [np.random.default_rng(i).normal(0, 1, (H // 2, W // 2)).astype(np.float32) for i in range(6)]
    grains = [cv2.resize(g, (W, H), interpolation=cv2.INTER_LINEAR)[..., None] for g in grains]
    fogs = [Noise(W, H, 11), Noise(W, H, 23)]
    fiction = None
    if film.get("fiction"):
        fiction = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        fd = ImageDraw.Draw(fiction)
        fd.text((44, 40), "FICTION", font=ImageFont.truetype(os.path.join(FONTS, "Poppins-Bold.ttf"), 30), fill=(255, 255, 255, 120))
        fiction = np.asarray(fiction, np.float32) / 255.0
    frame_no = 0
    for si, sc in enumerate(film["scenes"]):
        fx = set(sc.get("effects", []))
        if split and sc.get("group", si) != group:
            if enc is not None:
                enc.stdin.close()
                enc.wait()
            group = sc.get("group", si)
            enc = encoder(f"{out}{int(group):03d}.mp4", W, H, FPS, fast=True)
        n = max(1, round(sc["dur"] * FPS))
        Sw, Sh = int(W * SS), int(H * SS)
        if sc.get("image"):
            src = cv2.cvtColor(cv2.imread(sc["image"]), cv2.COLOR_BGR2RGB)
            src = cover(src, Sw, Sh).astype(np.float32) / 255.0
            dep = depth_of(sc["image"], os.path.splitext(sc["image"])[0] + ".depth.png")
            dep = cv2.GaussianBlur(cover(dep, Sw, Sh).astype(np.float32), (0, 0), 6)
        else:
            src = np.zeros((Sh, Sw, 3), np.float32)
            dep = np.zeros((Sh, Sw), np.float32)
        title = text_layer(W, H, sc["title"], sc.get("title_style", "slam"), "title") if sc.get("title") else None
        title = np.asarray(title, np.float32) / 255.0 if title is not None else None
        cap = np.asarray(text_layer(W, H, sc["caption"], "", "caption"), np.float32) / 255.0 if sc.get("caption") else None
        fcx, fcy = sc.get("focus", [0.5, 0.45])
        parts = {k: Particles(c, W, H, si * 7 + j, k) for j, (k, c) in enumerate((("dust", 160), ("salt", 140), ("rain", 220), ("bubbles", 60), ("embers", 70))) if k in fx or (k == "dust" and "beam" in fx)}
        crack = crack_layer(W, H, int(W * fcx), int(H * fcy), si) if "shatter" in fx else None
        rng = np.random.default_rng(1000 + si)
        walk = np.cumsum(rng.normal(0, 0.0012, (n, 2)), axis=0) if sc.get("move") == "handheld" or "shake" in fx else np.zeros((n, 2))
        flick = np.clip(1 - np.abs(rng.normal(0, 0.12, n)) * (rng.random(n) < 0.35), 0.45, 1)
        for k in range(n):
            u = k / max(1, n - 1)
            t = k / FPS
            z, tx, ty, par = camera(sc.get("move", "push_in"), u, walk[k])
            # 2.5D camera: output pixel -> source pixel, near things (depth ~1) shift more than far ones.
            cx, cy = Sw / 2 + tx * W, Sh / 2 + ty * H
            cx, cy, z = float(cx), float(cy), float(z)
            bx = (cx + (xx - W / 2) / z).astype(np.float32)
            by = (cy + (yy - H / 2) / z).astype(np.float32)
            d = cv2.remap(dep, bx, by, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT) - 0.5
            drift = (u - 0.5) * 2
            mx = bx - par * W * d * (0.6 * drift + (tx * 6))
            my = by - par * H * 0.35 * d * (z - 1.0) * 6 - par * H * d * ty * 4
            f = cv2.remap(src, mx.astype(np.float32), my.astype(np.float32), cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
            # Effects
            if "fog" in fx or "steam" in fx or "ghost" in fx:
                fog = 0.55 * fogs[0].sample(t * 22, t * 6) + 0.45 * fogs[1].sample(-t * 15, t * 3)
                if "fog" in fx:
                    a = (0.10 + 0.22 * (yy / H)) * fog
                    f = f * (1 - a[..., None]) + np.array([0.62, 0.58, 0.72], np.float32) * a[..., None]
                if "steam" in fx:
                    rise = np.clip(1 - np.abs(xx - W * fcx) / (W * 0.35), 0, 1) * np.clip((yy - (H * fcy - u * H * 0.6)) / (H * 0.3), 0, 1)
                    a = 0.55 * rise * fog * min(1, u * 3)
                    f = f * (1 - a[..., None]) + np.array([0.78, 0.78, 0.8], np.float32) * a[..., None]
                if "ghost" in fx:
                    blob = np.exp(-(((xx - W * fcx) / (W * 0.22)) ** 2 + ((yy - H * fcy) / (H * 0.24)) ** 2))
                    a = np.clip(blob * (0.4 + fog) * min(1, u * 1.8) * 0.85, 0, 0.85)
                    f = f * (1 - a[..., None]) + np.array([0.70, 0.78, 0.86], np.float32) * a[..., None]
            if "beam" in fx:
                beam = np.clip(1 - np.abs(xx - W * fcx - (yy - H * fcy) * 0.15) / (W * 0.18 + np.abs(yy - H * fcy) * 0.25), 0, 1)
                f = f + beam[..., None] * np.array([0.22, 0.20, 0.16], np.float32)
            if parts:
                layer = np.zeros((H, W), np.float32)
                for p in parts.values():
                    p.draw(t, layer)
                layer = cv2.GaussianBlur(layer, (0, 0), 1.2)
                if "beam" in fx:
                    layer *= 0.4 + 0.6 * beam
                tint = np.array([1.0, 0.9, 0.7], np.float32) if "embers" in parts else np.array([0.95, 0.95, 1.0], np.float32)
                f = f + layer[..., None] * tint * 0.9
            if "frost" in fx:
                fr = fogs[1].sample(0, 0)
                edge = np.clip(1 - np.minimum(np.minimum(xx, W - xx), np.minimum(yy, H - yy)) / (W * (0.08 + 0.35 * ease(u))), 0, 1)
                crys = np.clip((fr - 0.45) * 6, 0, 1) * edge
                f = f * (1 - 0.7 * crys[..., None]) + np.array([0.82, 0.9, 1.0], np.float32) * 0.7 * crys[..., None]
            if "wounds" in fx and u > 0.15:
                pulse = 0.6 + 0.4 * math.sin(t * 9)
                for dxw in (-28, 0, 26):
                    g = np.exp(-(((xx - (W * fcx + dxw)) / 14) ** 2 + ((yy - (H * fcy + 160 + abs(dxw))) / 14) ** 2))
                    f = f + g[..., None] * np.array([0.3, 0.6, 1.0], np.float32) * pulse
            if crack is not None:
                grow = min(1, max(0, (u - 0.1) / 0.25))
                rr = np.sqrt((xx - W * fcx) ** 2 + (yy - H * fcy) ** 2)
                m = crack * (rr < grow * W * 0.9)
                f = f * (1 - 0.6 * m[..., None]) + 0.95 * m[..., None]
                if 0.1 < u < 0.2:
                    f = f + (1 - abs(u - 0.15) / 0.05) * 0.6
            if "flicker" in fx:
                f = f * flick[k]
            if "glow" in fx:
                f = f + cv2.GaussianBlur(np.clip(f - 0.6, 0, 1), (0, 0), 24) * 0.9
            # Finish: grade, shake, weave, vignette, grain
            f = grade(np.clip(f, 0, 1), gname)
            if "shake" in fx or "quake" in fx:
                amp = 26 if "quake" in fx else 9
                ox, oy = rng.normal(0, amp), rng.normal(0, amp)
                f = cv2.warpAffine(f, np.float32([[1, 0, ox], [0, 1, oy]]), (W, H), borderMode=cv2.BORDER_REFLECT)
            elif frame_no % 2 == 0 and not clean:
                f = cv2.warpAffine(f, np.float32([[1, 0, rng.normal(0, 0.6)], [0, 1, rng.normal(0, 0.6)]]), (W, H), borderMode=cv2.BORDER_REFLECT)
            # "clean": a sharp picture for films that add their own grade and grain afterwards.
            f = f if clean else f * vign + grains[frame_no % len(grains)] * 0.035
            # Transitions in
            if "whip_in" in fx and t < 0.25:
                kk = int(90 * (1 - t / 0.25)) * 2 + 1
                f = cv2.blur(f, (kk, 1))
            if "flash_in" in fx and t < 0.3:
                f = f + (1 - t / 0.3) * 0.9
            if "leak_in" in fx and t < 0.6:
                leak = np.clip(1 - xx / (W * 0.9), 0, 1) * (1 - t / 0.6)
                f = f + leak[..., None] * np.array([0.55, 0.25, 0.05], np.float32)
            if t < 0.12 and si > 0 and not ({"whip_in", "flash_in", "cut"} & fx):
                f = f * (t / 0.12)
            # Bars: cinema bars, opening on big moments
            bars = 0.0
            if "bars" in fx:
                bars = 0.11
            if "bars_open" in fx:
                bars = 0.11 * (1 - ease(min(1, u * 3)))
            if bars > 0:
                b = int(H * bars)
                f[:b] = 0
                f[H - b :] = 0
            # Titles and captions
            if title is not None:
                ta = min(1, t / 0.35) * min(1, (sc["dur"] - t) / 0.3)
                if sc.get("title_style", "slam") == "slam" and t < 0.35:
                    s = 1.25 - 0.25 * ease_out(t / 0.35)
                    M = cv2.getRotationMatrix2D((W / 2, H * 0.2), 0, s)
                    tl = cv2.warpAffine(title, M, (W, H))
                else:
                    tl = title
                a = tl[..., 3:4] * ta
                f = f * (1 - a) + tl[..., :3] * a
            if cap is not None:
                ca = min(1, max(0, (t - 0.15) / 0.2)) * min(1, (sc["dur"] - t) / 0.2)
                a = cap[..., 3:4] * ca
                f = f * (1 - a) + cap[..., :3] * a
            if fiction is not None:
                a = fiction[..., 3:4]
                f = f * (1 - a) + fiction[..., :3] * a
            enc.stdin.write((np.clip(f, 0, 1) * 255).astype(np.uint8).tobytes())
            frame_no += 1
        print(f"scene {si + 1}/{len(film['scenes'])} done ({n} frames)", flush=True)
    if enc is not None:
        enc.stdin.close()
        enc.wait()


if __name__ == "__main__":
    render(json.load(open(sys.argv[1])), sys.argv[2])
