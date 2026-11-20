#!/usr/bin/env python3
"""
The Vueio ad: 21 seconds of 4K motion graphics (2160x3840, 30 fps), the same kind of video Vueio makes. Every frame is
drawn here (kinetic type, a typed prompt, a live chart, a checklist, platform chips, the end card); the score and sound
effects are synthesised here too; the voiceover comes from Azure's neural voices (vo1.wav ... vo6.wav in the voice dir).

  python3 scripts/make-vueio-ad.py <voice dir> <out.mp4> [--scale 0.25] [--frames 0,90,200] [--link vueio-app...]

--scale renders smaller for a quick look; --frames writes just those frames as PNGs next to <out.mp4>.
Needs ffmpeg, Pillow and numpy/scipy. Uses assets/fonts (Bebas Neue, Poppins, SIL OFL) and the app icon.
"""
import argparse
import math
import os
import subprocess
import sys
import wave
from functools import lru_cache
from multiprocessing import Pool

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, "assets", "fonts")
LOGO = os.path.join(ROOT, "public", "icons", "icon-512.png")
FPS, DUR = 30, 21.0
INK, INK2, MINT, MINT2, WHITE, GOLD, BLUE, VIOLET = (7, 8, 11), (14, 17, 26), (62, 240, 168), (150, 252, 210), (255, 255, 255), (255, 200, 87), (64, 120, 255), (150, 92, 255)

# Scenes (seconds): hook, prompt, the video it becomes, what's included, platforms, end card.
S1, S2, S3, S4, S5, S6 = 0.0, 2.6, 6.2, 11.5, 15.2, 17.8
VO = [  # line, start
    ("Your feed moves fast.", 0.35),
    ("Type one idea.", 2.85),
    ("Vueio turns it into a 4K motion graphics video.", 6.45),
    ("Script, voice, captions and music. Done for you.", 11.55),
    ("Ready for every platform.", 15.75),
    ("Vueio. Make your first video today.", 18.15),
]
PROMPT = "Explain compound interest in 20 seconds"

args = None
W = H = 0
K = 1.0  # scale against 4K


def ease_out(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def ease_in_out(t):
    t = max(0.0, min(1.0, t))
    return 4 * t * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


def back_out(t, s=1.70158):
    t = max(0.0, min(1.0, t)) - 1
    return 1 + (s + 1) * t * t * t + s * t * t


def prog(t, a, d):
    return max(0.0, min(1.0, (t - a) / d))


@lru_cache(maxsize=64)
def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), max(4, int(size)))


BEBAS = lambda s: font("BebasNeue-Regular.ttf", s * K)
POP = lambda s: font("Poppins-Bold.ttf", s * K)


@lru_cache(maxsize=256)
def text_sprite(text, fname, size, color, tracking=0.0, glow=0):
    """A text layer (RGBA) with optional letter spacing and a soft glow, cropped to its ink."""
    f = font(fname, size * K)
    widths = [f.getlength(c) for c in text]
    tw = int(sum(widths) + tracking * K * max(0, len(text) - 1)) + 4
    asc, desc = f.getmetrics()
    pad = int(glow * K * 2) + 4
    img = Image.new("RGBA", (tw + 2 * pad, asc + desc + 2 * pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x = pad
    for c, w in zip(text, widths):
        d.text((x, pad), c, font=f, fill=color + (255,))
        x += w + tracking * K
    if glow:
        g = img.split()[3].filter(ImageFilter.GaussianBlur(glow * K))
        halo = Image.new("RGBA", img.size, color + (0,))
        halo.putalpha(g.point(lambda v: int(v * 0.55)))
        img = Image.alpha_composite(halo, img)
    return img


def paste(frame, sprite, cx, cy, scale=1.0, alpha=1.0, anchor="c"):
    if alpha <= 0.003 or scale <= 0.01:
        return
    s = sprite
    if abs(scale - 1) > 0.002:
        s = s.resize((max(1, int(s.width * scale)), max(1, int(s.height * scale))), Image.BILINEAR)
    if alpha < 0.999:
        a = s.split()[3].point(lambda v: int(v * alpha))
        s = s.copy()
        s.putalpha(a)
    x = int(cx - s.width / 2) if anchor == "c" else int(cx)
    y = int(cy - s.height / 2)
    frame.alpha_composite(s, (max(0, x), max(0, y)), (max(0, -x), max(0, -y)))


def word(frame, text, cx, cy, size, color=WHITE, fname="BebasNeue-Regular.ttf", scale=1.0, alpha=1.0, tracking=0, glow=0, anchor="c"):
    paste(frame, text_sprite(text, fname, size, color, tracking, glow), cx, cy, scale, alpha, anchor)


@lru_cache(maxsize=8)
def blob(color, r):
    # A soft round light: a radial falloff that reaches zero well inside the sprite, so no edge ever shows.
    size = int(r * 2.4)
    yy, xx = np.mgrid[0:size, 0:size]
    d = np.hypot(xx - size / 2, yy - size / 2) / (size / 2)
    a = (np.clip(1 - d, 0, 1) ** 2.2 * 150).astype(np.uint8)
    img = Image.new("RGBA", (size, size), color + (0,))
    img.putalpha(Image.fromarray(a, "L"))
    return img


@lru_cache(maxsize=1)
def backdrop():
    """A deep ink gradient with a fine dot grid (drawn once)."""
    y = np.linspace(0, 1, H)[:, None]
    top, bottom = np.array(INK2, float), np.array(INK, float)
    grad = (top * (1 - y) + bottom * y)[:, None, :].repeat(W, axis=1).astype(np.uint8)
    img = Image.fromarray(grad, "RGB").convert("RGBA")
    d = ImageDraw.Draw(img)
    step, r = int(84 * K), max(1, int(3 * K))
    for yy in range(step // 2, H, step):
        for xx in range(step // 2, W, step):
            d.ellipse((xx - r, yy - r, xx + r, yy + r), fill=(255, 255, 255, 18))
    return img


def background(t, accent=MINT):
    f = backdrop().copy()
    # Three soft lights drifting: mint, blue and the scene's accent.
    for i, (c, r, ox, oy, sp) in enumerate([(MINT, 1500, 0.25, 0.22, 0.11), (BLUE, 1800, 0.8, 0.62, 0.08), (accent, 1300, 0.4, 0.9, 0.14)]):
        b = blob(c, int(r * K))
        cx = W * (ox + 0.12 * math.sin(t * sp * 2 * math.pi + i))
        cy = H * (oy + 0.06 * math.cos(t * sp * 2 * math.pi + i * 1.7))
        paste(f, b, cx, cy)
    return f


def rrect(d, box, r, fill=None, outline=None, width=1):
    d.rounded_rectangle([int(v) for v in box], radius=int(r), fill=fill, outline=outline, width=max(1, int(width)))


def overlay(frame, draw_fn):
    """Draw on a transparent layer and composite it (so alpha in fills works)."""
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(layer), layer)
    frame.alpha_composite(layer)


def scene_alpha(t, start, end, fade=0.25):
    return min(prog(t, start, fade), 1 - prog(t, end - fade, fade))


# ── Scenes ──────────────────────────────────────────────────────────────────────────────────────────────────────────
def s1(f, t):
    a = scene_alpha(t, S1 - 1, S2)
    up = ease_in_out(prog(t, S2 - 0.35, 0.35)) * H * 0.06
    p1, p2 = prog(t, 0.15, 0.35), prog(t, 0.55, 0.35)
    word(f, "STOP", W / 2, H * 0.40 - up, 560, WHITE, scale=1.6 - 0.6 * back_out(p1), alpha=a * ease_out(p1 * 1.5), glow=18)
    word(f, "SCROLLING.", W / 2, H * 0.52 - up, 330, MINT, scale=1.4 - 0.4 * back_out(p2), alpha=a * ease_out(p2 * 1.5), tracking=6, glow=14)
    pw = ease_out(prog(t, 1.0, 0.5))

    def bar(d, _):
        w = W * 0.5 * pw
        rrect(d, (W / 2 - w / 2, H * 0.585 - up, W / 2 + w / 2, H * 0.585 + 18 * K - up), 9 * K, fill=MINT + (int(255 * a),))
    overlay(f, bar)
    word(f, "YOUR FEED MOVES FAST", W / 2, H * 0.64 - up, 92, WHITE, fname="Poppins-Bold.ttf", alpha=a * ease_out(prog(t, 1.2, 0.4)) * 0.8, tracking=10)


def s2(f, t):
    a = scene_alpha(t, S2, S3)
    lt = t - S2
    word(f, "TYPE ONE IDEA", W / 2, H * 0.25, 110, MINT, fname="Poppins-Bold.ttf", alpha=a * ease_out(prog(lt, 0.0, 0.4)), tracking=18)
    pop = back_out(prog(lt, 0.1, 0.5))
    cw, ch = W * 0.84, H * 0.23
    x0, y0 = W / 2 - cw / 2, H * 0.36 + (1 - pop) * H * 0.04
    n = int(len(PROMPT) * prog(lt, 0.55, 1.9))
    shown = PROMPT[:n]
    pressed = prog(lt, 2.75, 0.35)

    def card(d, layer):
        al = int(255 * a * min(1, pop))
        rrect(d, (x0, y0, x0 + cw, y0 + ch), 60 * K, fill=(20, 24, 34, int(al * 0.92)), outline=MINT + (int(al * 0.7),), width=5 * K)
        # The prompt, wrapped, with a blinking cursor while typing.
        f_ = font("Poppins-Bold.ttf", 104 * K)
        lines, cur = [], ""
        for w_ in shown.split(" "):
            test = (cur + " " + w_).strip()
            if f_.getlength(test) > cw - 200 * K and cur:
                lines.append(cur)
                cur = w_
            else:
                cur = test
        lines.append(cur)
        ty = y0 + 110 * K
        for ln in lines:
            d.text((x0 + 100 * K, ty), ln, font=f_, fill=(255, 255, 255, al))
            ty += 150 * K
        if lt < 2.6 and int(lt * 2.4) % 2 == 0:
            lx = x0 + 100 * K + f_.getlength(lines[-1]) + 14 * K
            d.rectangle((lx, ty - 150 * K + 18 * K, lx + 12 * K, ty - 150 * K + 128 * K), fill=MINT + (al,))
        # The button: "Make video", pressed.
        bs = 1 - 0.08 * math.sin(math.pi * pressed)
        bw, bh = 760 * K * bs, 200 * K * bs
        bx, by = W / 2, y0 + ch + 230 * K
        bal = int(255 * a * ease_out(prog(lt, 1.6, 0.4)))
        rrect(d, (bx - bw / 2, by - bh / 2, bx + bw / 2, by + bh / 2), bh / 2, fill=MINT + (bal,))
        fb = font("Poppins-Bold.ttf", 84 * K * bs)
        label = "Make video"
        d.text((bx - fb.getlength(label) / 2, by - 60 * K * bs), label, font=fb, fill=INK + (bal,))
        if pressed > 0:  # ripple
            rr = 900 * K * ease_out(pressed)
            d.ellipse((bx - rr, by - rr, bx + rr, by + rr), outline=MINT + (int(160 * (1 - pressed) * a),), width=int(8 * K))
    overlay(f, card)


def s3(f, t):
    a = scene_alpha(t, S3, S4)
    lt = t - S3
    word(f, "IT BECOMES THIS", W / 2, H * 0.12, 220, WHITE, alpha=a * ease_out(prog(lt, 0.0, 0.4)), tracking=8, glow=10)
    # A phone-shaped frame with a motion-graphics explainer playing inside it.
    pw, ph = W * 0.70, W * 0.70 * 16 / 9
    px, py = W / 2 - pw / 2, H * 0.19 + (1 - back_out(prog(lt, 0.1, 0.6))) * H * 0.05

    def phone(d, layer):
        al = int(255 * a)
        rrect(d, (px, py, px + pw, py + ph), 90 * K, fill=(12, 15, 24, al), outline=(255, 255, 255, int(al * 0.25)), width=6 * K)
        # Bars of money growing faster and faster (compound interest), drawn on as the clip plays.
        base_y = py + ph * 0.78
        n = 10
        bw = pw * 0.62 / n
        for i in range(n):
            g = ease_out(prog(lt, 0.6 + i * 0.12, 0.6))
            hgt = ph * 0.40 * (1.28 ** i - 1) / (1.28 ** (n - 1) - 1) * g + 6 * K
            x = px + pw * 0.19 + i * bw * 1.0
            col = MINT if i < n - 1 else GOLD
            rrect(d, (x + bw * 0.14, base_y - hgt, x + bw * 0.86, base_y), 10 * K, fill=col + (int(al * (0.55 + 0.45 * i / n)),))
        # The curve over the bars.
        pts = []
        cp = ease_in_out(prog(lt, 0.8, 2.2))
        for j in range(0, int(60 * cp) + 1):
            u = j / 60
            x = px + pw * 0.19 + u * bw * (n - 0.5)
            y = base_y - ph * 0.40 * (1.28 ** (u * (n - 1)) - 1) / (1.28 ** (n - 1) - 1) - 40 * K
            pts.append((x, y))
        if len(pts) > 1:
            d.line(pts, fill=WHITE + (al,), width=int(10 * K), joint="curve")
            ex, ey = pts[-1]
            r = 22 * K
            d.ellipse((ex - r, ey - r, ex + r, ey + r), fill=GOLD + (al,))
        # A ring turning, top right.
        rc, rr = (px + pw * 0.24, py + ph * 0.30), pw * 0.09
        ang = lt * 140
        d.arc((rc[0] - rr, rc[1] - rr, rc[0] + rr, rc[1] + rr), ang, ang + 260, fill=MINT + (al,), width=int(14 * K))
        # Axis line.
        d.line((px + pw * 0.15, base_y + 6 * K, px + pw * 0.85, base_y + 6 * K), fill=(255, 255, 255, int(al * 0.3)), width=int(4 * K))
    overlay(f, phone)
    # Kinetic captions inside the phone, one word lit at a time.
    words = ["MONEY", "THAT", "GROWS", "ITSELF"]
    lit = int(prog(lt, 0.8, 3.2) * len(words))
    cy = py + ph * 0.12
    f_ = font("BebasNeue-Regular.ttf", 150 * K)
    total = sum(f_.getlength(w_) for w_ in words) + 40 * K * (len(words) - 1)
    x = W / 2 - total / 2
    for i, w_ in enumerate(words):
        word(f, w_, x, cy, 150, GOLD if i == min(lit, len(words) - 1) else WHITE, alpha=a * ease_out(prog(lt, 0.4 + i * 0.1, 0.3)), anchor="l")
        x += f_.getlength(w_) + 40 * K
    # The 4K badge.
    bp = back_out(prog(lt, 1.6, 0.5))

    def badge(d, _):
        bx, by, r = W * 0.83, py + ph + 40 * K, 190 * K * bp
        if r > 1:
            d.ellipse((bx - r, by - r, bx + r, by + r), fill=GOLD + (int(255 * a),))
    overlay(f, badge)
    word(f, "4K", W * 0.83, py + ph + 40 * K, 210, INK, scale=max(0.01, bp), alpha=a)
    word(f, "MOTION GRAPHICS", W / 2, py + ph + 260 * K, 150, MINT, alpha=a * ease_out(prog(lt, 2.0, 0.4)), tracking=10, glow=10)


ITEMS = ["SCRIPT", "VOICEOVER", "KINETIC CAPTIONS", "MUSIC", "4K EXPORT"]


def s4(f, t):
    a = scene_alpha(t, S4, S5)
    lt = t - S4
    word(f, "DONE FOR YOU", W / 2, H * 0.17, 250, WHITE, alpha=a * ease_out(prog(lt, 0.0, 0.4)), tracking=8, glow=12)
    for i, item in enumerate(ITEMS):
        p = ease_out(prog(lt, 0.35 + i * 0.38, 0.45))
        y = H * 0.32 + i * H * 0.115
        x = W * 0.16 - (1 - p) * W * 0.4

        def row(d, _, x=x, y=y, p=p, i=i):
            al = int(255 * a * p)
            rrect(d, (x - 40 * K, y - 120 * K, W * 0.88, y + 120 * K), 60 * K, fill=(255, 255, 255, int(al * 0.06)))
            cr = 78 * K
            cx = x + 70 * K
            d.ellipse((cx - cr, y - cr, cx + cr, y + cr), fill=MINT + (al,))
            ck = back_out(prog(lt, 0.55 + i * 0.38, 0.35))
            if ck > 0:  # the tick draws itself
                pts = [(cx - 36 * K, y), (cx - 8 * K, y + 30 * K), (cx + 40 * K, y - 30 * K)]
                seg = min(1, ck * 2)
                d.line([pts[0], (pts[0][0] + (pts[1][0] - pts[0][0]) * seg, pts[0][1] + (pts[1][1] - pts[0][1]) * seg)], fill=INK + (al,), width=int(16 * K))
                if ck > 0.5:
                    s = min(1, (ck - 0.5) * 2)
                    d.line([pts[1], (pts[1][0] + (pts[2][0] - pts[1][0]) * s, pts[1][1] + (pts[2][1] - pts[1][1]) * s)], fill=INK + (al,), width=int(16 * K))
        overlay(f, row)
        word(f, item, x + 210 * K, y, 140, WHITE, alpha=a * p, anchor="l", tracking=4)


CHIPS = [("SHORTS", MINT), ("REELS", GOLD), ("TIKTOK", WHITE), ("YOUTUBE", MINT), ("LINKEDIN", GOLD), ("FACEBOOK", WHITE)]


def s5(f, t):
    a = scene_alpha(t, S5, S6)
    lt = t - S5
    word(f, "EVERY PLATFORM", W / 2, H * 0.2, 260, WHITE, alpha=a * ease_out(prog(lt, 0.0, 0.4)), tracking=8, glow=12)
    word(f, "9:16  •  16:9  •  4K", W / 2, H * 0.27, 96, MINT, fname="Poppins-Bold.ttf", alpha=a * ease_out(prog(lt, 0.3, 0.4)), tracking=6)
    for i, (name, col) in enumerate(CHIPS):
        p = back_out(prog(lt, 0.35 + i * 0.16, 0.45))
        cx = W * (0.3 if i % 2 == 0 else 0.7)
        cy = H * (0.4 + (i // 2) * 0.13) + math.sin(lt * 2 + i) * 14 * K
        f_ = font("BebasNeue-Regular.ttf", 140 * K)
        cw = f_.getlength(name) + 160 * K

        def chip(d, _, cx=cx, cy=cy, p=p, cw=cw, col=col):
            if p <= 0:
                return
            w_, h_ = cw * p, 230 * K * p
            al = int(255 * a)
            rrect(d, (cx - w_ / 2, cy - h_ / 2, cx + w_ / 2, cy + h_ / 2), h_ / 2, fill=(255, 255, 255, int(al * 0.07)), outline=col + (al,), width=6 * K)
        overlay(f, chip)
        word(f, name, cx, cy, 140, col, scale=max(0.01, p), alpha=a)


@lru_cache(maxsize=1)
def logo_sprite():
    return Image.open(LOGO).convert("RGBA")


def s6(f, t):
    lt = t - S6
    a = prog(lt, 0.0, 0.3)
    p = back_out(prog(lt, 0.1, 0.6))
    size = int(620 * K * max(0.01, p))
    if size > 2:
        lg = logo_sprite().resize((size, size), Image.LANCZOS)
        glow = blob(MINT, int(520 * K))
        f.alpha_composite(glow, (int(W / 2 - glow.width / 2), int(H * 0.33 - glow.height / 2)))
        f.alpha_composite(lg, (int(W / 2 - size / 2), int(H * 0.33 - size / 2)))
    word(f, "Vueio", W / 2, H * 0.47, 330, WHITE, fname="Poppins-Bold.ttf", alpha=a * ease_out(prog(lt, 0.4, 0.4)), glow=10)
    word(f, "MOTION GRAPHICS IN 4K", W / 2, H * 0.545, 130, MINT, alpha=a * ease_out(prog(lt, 0.7, 0.4)), tracking=14)
    bp = back_out(prog(lt, 1.1, 0.5))
    pulse = 1 + 0.03 * math.sin(max(0, lt - 1.6) * 6)

    def cta(d, _):
        if bp <= 0:
            return
        bw, bh = 1440 * K * bp * pulse, 240 * K * bp * pulse
        bx, by = W / 2, H * 0.65
        rrect(d, (bx - bw / 2, by - bh / 2, bx + bw / 2, by + bh / 2), bh / 2, fill=MINT + (255,))
    overlay(f, cta)
    word(f, "Make your first video", W / 2, H * 0.65, 100, INK, fname="Poppins-Bold.ttf", scale=max(0.01, bp * pulse))
    word(f, args.link, W / 2, H * 0.73, 64, WHITE, fname="Poppins-Bold.ttf", alpha=0.75 * ease_out(prog(lt, 1.5, 0.5)))


def frame(i):
    t = i / FPS
    accent = [VIOLET, MINT, GOLD, MINT, VIOLET, MINT][sum(t >= s for s in (S2, S3, S4, S5, S6))]
    f = background(t, accent)
    if t < S2 + 0.05:
        s1(f, t)
    if S2 - 0.05 <= t < S3 + 0.05:
        s2(f, t)
    if S3 - 0.05 <= t < S4 + 0.05:
        s3(f, t)
    if S4 - 0.05 <= t < S5 + 0.05:
        s4(f, t)
    if S5 - 0.05 <= t < S6 + 0.05:
        s5(f, t)
    if t >= S6 - 0.05:
        s6(f, t)
    # A light flash on each cut.
    for c in (S2, S3, S4, S5, S6):
        fl = 1 - prog(t, c, 0.18) if c <= t < c + 0.18 else 0
        if fl > 0:
            f.alpha_composite(Image.new("RGBA", f.size, (255, 255, 255, int(70 * fl))))
    # Fade in/out.
    edge = min(prog(t, 0, 0.2), 1 - prog(t, DUR - 0.35, 0.35))
    if edge < 1:
        f.alpha_composite(Image.new("RGBA", f.size, INK + (int(255 * (1 - edge)),)))
    return f.convert("RGB").tobytes()


# ── Sound ───────────────────────────────────────────────────────────────────────────────────────────────────────────
SR = 48000


def synth_score(path):
    from scipy.signal import butter, sosfilt

    n = int(SR * DUR)
    t = np.arange(n) / SR
    L = np.zeros(n)
    R = np.zeros(n)
    rng = np.random.default_rng(4)
    lp = lambda x, f, o=2: sosfilt(butter(o, f, fs=SR, output="sos"), x)
    hp = lambda x, f, o=2: sosfilt(butter(o, f, btype="high", fs=SR, output="sos"), x)
    bp = lambda x, a, b, o=2: sosfilt(butter(o, [a, b], btype="band", fs=SR, output="sos"), x)
    beat = 0.5  # 120 BPM

    def put(buf, x, at, g=1.0):
        i = int(at * SR)
        j = min(len(buf), i + len(x))
        if i < len(buf):
            buf[i:j] += x[: j - i] * g

    def note(f, dur, kind="saw"):
        m = int(dur * SR)
        tt = np.arange(m) / SR
        if kind == "saw":
            return sum(2 * ((f * d * tt + ph) % 1) - 1 for d, ph in ((1, 0), (1.006, 0.31), (0.994, 0.67), (2.003, 0.12))) / 4
        if kind == "tri":
            return 2 * np.abs(2 * ((f * tt) % 1) - 1) - 1
        return np.sin(2 * np.pi * f * tt)

    hz = lambda m: 440 * 2 ** ((m - 69) / 12)
    # Am - F - C - G, two bars each (4 s).
    chords = [(57, 60, 64), (53, 57, 60), (48, 55, 60), (55, 59, 62)]
    for k in range(int(DUR / 4) + 1):
        root = chords[k % 4]
        at = k * 4.0
        if at >= DUR:
            break
        # Pad: detuned saws, filtered, swelling.
        pad = sum(note(hz(m + 12), 4.0, "saw") for m in root) / 3
        cutoff = 900 if at < S2 else 2600
        pad = lp(pad, cutoff) * np.minimum(1, np.arange(len(pad)) / (0.4 * SR)) * np.minimum(1, (len(pad) - np.arange(len(pad))) / (0.3 * SR))
        put(L, pad, at, 0.16)
        put(R, pad * 0.96, at + 0.004, 0.16)
        # Bass: eighth-note pulse on the root, from the drop.
        for e in range(8 * 2):
            bt = at + e * beat / 2
            if S2 <= bt < S6 + 0.01:
                b = note(hz(root[0] - 24), beat / 2 * 0.9, "saw")
                b = lp(b, 380) * np.exp(-np.arange(len(b)) / SR * 5)
                put(L, b, bt, 0.42)
                put(R, b, bt, 0.42)
        # Arp: sixteenths through the chord.
        for s in range(32):
            st = at + s * beat / 4
            if S3 <= st < S6:
                m = root[s % 3] + 24 + (12 if s % 8 == 7 else 0)
                a = note(hz(m), 0.18, "tri") * np.exp(-np.arange(int(0.18 * SR)) / SR * 22)
                put(L if s % 2 else R, a, st, 0.09)
    # Drums from the drop to the end card.
    kick_n = int(0.45 * SR)
    kt = np.arange(kick_n) / SR
    kick = np.sin(2 * np.pi * np.cumsum(45 + 110 * np.exp(-kt * 28)) / SR) * np.exp(-kt * 7)
    kick += hp(rng.standard_normal(kick_n), 2000) * np.exp(-kt * 120) * 0.25
    hat_n = int(0.06 * SR)
    hat = hp(rng.standard_normal(hat_n), 7000) * np.exp(-np.arange(hat_n) / SR * 70)
    clap_n = int(0.25 * SR)
    clap = bp(rng.standard_normal(clap_n), 900, 3500) * np.exp(-np.arange(clap_n) / SR * 18)
    bt = S2
    while bt < S6 - 0.01:
        put(L, kick, bt, 0.85)
        put(R, kick, bt, 0.85)
        put(L, hat, bt + beat / 2, 0.22)
        put(R, hat, bt + beat / 2 + 0.003, 0.25)
        if int(round((bt - S2) / beat)) % 2 == 1:
            put(L, clap, bt, 0.35)
            put(R, clap, bt + 0.006, 0.35)
        bt += beat
    # Riser into the drop and into the end card; whooshes on the other cuts; an impact on the logo.
    for end, dur in ((S2, 2.2), (S6, 1.6)):
        m = int(dur * SR)
        tt = np.arange(m) / SR
        r = bp(rng.standard_normal(m), 600, 8000) * (tt / dur) ** 3
        put(L, r, end - dur, 0.3)
        put(R, r[::-1][::-1], end - dur, 0.3)
    for c in (S3, S4, S5):
        m = int(0.6 * SR)
        tt = np.arange(m) / SR
        w = bp(rng.standard_normal(m), 300, 5000) * np.sin(np.pi * tt / 0.6) ** 2
        put(L, w, c - 0.3, 0.25)
        put(R, w, c - 0.28, 0.25)
    m = int(2.5 * SR)
    tt = np.arange(m) / SR
    imp = np.sin(2 * np.pi * np.cumsum(30 + 70 * np.exp(-tt * 9)) / SR) * np.exp(-tt * 1.6) + bp(rng.standard_normal(m), 150, 4000) * np.exp(-tt * 9) * 0.4
    put(L, imp, S6, 0.8)
    put(R, imp, S6, 0.8)
    # Typing clicks while the prompt is typed.
    click_n = int(0.03 * SR)
    click = hp(rng.standard_normal(click_n), 3000) * np.exp(-np.arange(click_n) / SR * 200)
    for c in range(len(PROMPT)):
        ct = S2 + 0.55 + 1.9 * c / len(PROMPT)
        put(L, click, ct, 0.18)
        put(R, click, ct, 0.18)
    # Button press.
    put(L, imp[: int(0.3 * SR)] * 0.5, S2 + 2.75, 0.5)
    put(R, imp[: int(0.3 * SR)] * 0.5, S2 + 2.75, 0.5)
    fade = np.minimum(1, (DUR - t) / 0.6)
    L *= fade
    R *= fade
    peak = max(np.abs(L).max(), np.abs(R).max())
    pcm = (np.stack([L, R], 1) / peak * 0.89 * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def init(a):
    global args, W, H, K
    args = a
    K = a.scale
    W, H = int(2160 * K) // 2 * 2, int(3840 * K) // 2 * 2


def main():
    p = argparse.ArgumentParser()
    p.add_argument("voice_dir")
    p.add_argument("out")
    p.add_argument("--scale", type=float, default=1.0)
    p.add_argument("--frames", default="")
    p.add_argument("--link", default="vueio-app.eastus.cloudapp.azure.com")
    a = p.parse_args()
    init(a)
    if a.frames:
        for i in [int(x) for x in a.frames.split(",")]:
            Image.frombytes("RGB", (W, H), frame(i)).save(os.path.splitext(a.out)[0] + f"-f{i:04d}.png")
        return
    work = os.path.splitext(a.out)[0]
    score = work + "-score.wav"
    synth_score(score)
    video = work + "-video.mp4"
    total = int(DUR * FPS)
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                            "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "5.2", video], stdin=subprocess.PIPE)
    with Pool(os.cpu_count(), initializer=init, initargs=(a,)) as pool:
        for k, buf in enumerate(pool.imap(frame, range(total), chunksize=4)):
            enc.stdin.write(buf)
            if k % 60 == 0:
                print(f"frame {k}/{total}", flush=True)
    enc.stdin.close()
    enc.wait()
    # Voice lines at their cues, the score ducked under them, mastered to -14 LUFS.
    vo_in, delays = [], []
    for i, (_, at) in enumerate(VO):
        f_ = os.path.join(a.voice_dir, f"vo{i + 1}.wav")
        if os.path.exists(f_):
            vo_in += ["-i", f_]
            delays.append(int(at * 1000))
    n = len(delays)
    fc = "".join(f"[{i + 2}:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay={d}|{d},apad[v{i}];" for i, d in enumerate(delays))
    if n:
        fc += "".join(f"[v{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0:duration=longest,highpass=f=80,acompressor=threshold=-18dB:ratio=3:attack=5:release=120,volume=1.7,asplit=2[vo][key];"
        fc += "[1:a][key]sidechaincompress=threshold=0.04:ratio=6:attack=20:release=300[duck];[duck][vo]amix=inputs=2:normalize=0:duration=first,"
    else:
        fc += "[1:a]"
    fc += "loudnorm=I=-14:TP=-1.5:LRA=9,aresample=48000,alimiter=limit=0.85:level=false[au]"  # true peak under -1 dB
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", video, "-i", score, *vo_in, "-filter_complex", fc, "-map", "0:v", "-map", "[au]", "-t", str(DUR),
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", a.out], check=True)
    print("done", a.out)


if __name__ == "__main__":
    main()
