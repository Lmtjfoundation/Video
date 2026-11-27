"""Episode Studio finishing pass: every shot conformed to its slot in the edit, graded by scene mood, film grain and a
vignette, impact shakes, dissolves into and out of flashbacks, location supers, character name tags, speaker-labelled
captions, designed title cards, then the final mix at broadcast loudness. Vertical (1080x1920) or wide (1920x1080).

    python3 finish.py spec.json out.mp4

The spec (written by src/lib/episode-studio/run.ts):
  w, h, fps, total, fonts (folder with Cinzel-Variable.ttf, BebasNeue-Regular.ttf, Poppins-Bold.ttf), mix (WAV),
  accent [r, g, b], note (small line on the title card), limit (optional: stop early, for previews),
  items:    [{kind: "shot", id, start, dur, mood, clip, still?, in?, out?, impacts?: [seconds]},
             {kind: "card", start, dur, text, sub?, style: "series" | "title" | "card" | "next"}]
  captions: [{start, dur, speaker | null, text}]          (already split into readable chunks)
  supers:   {shotId: {title, sub?, seconds}}               (location / time, top left)
  tags:     {shotId: {name, role}}                         (a character's first appearance)
Prints one progress line per item ("item k/n"), then "done".
"""
import json
import math
import os
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

SPEC = json.load(open(sys.argv[1]))
OUT = sys.argv[2]
W, H, FPS = int(SPEC.get("w", 1080)), int(SPEC.get("h", 1920)), int(SPEC.get("fps", 24))
WIDE = W > H
U = min(W, H) / 1080  # type and layout scale with the short side
FONTS = SPEC["fonts"]
CINZEL, BEBAS, POP = (os.path.join(FONTS, f) for f in ("Cinzel-Variable.ttf", "BebasNeue-Regular.ttf", "Poppins-Bold.ttf"))
TOTAL = float(SPEC["total"])
END = min(TOTAL, float(SPEC.get("limit") or TOTAL))
NF = int(round(END * FPS))
ACCENT = tuple(int(c) for c in SPEC.get("accent", (232, 196, 112)))


def font(path, size):
    return ImageFont.truetype(path, max(8, int(size)))


# ───────────── grades (float RGB 0..1) ─────────────
def tone(f, shadow, high, amt, sat=1.0, contrast=1.0, lift=0.0):
    lum = (f @ np.array([0.299, 0.587, 0.114], np.float32))[..., None]
    f = lum + (f - lum) * sat
    t = np.array(shadow, np.float32) * (1 - lum) + np.array(high, np.float32) * lum
    f = f * (1 - amt) + lum * t * amt * 1.6
    return np.clip((f - 0.5) * contrast + 0.5 + lift, 0, 1)


GRADES = {
    "warm": lambda f: tone(f, (0.20, 0.16, 0.12), (1.0, 0.82, 0.55), 0.28, 1.12, 1.06),
    "golden": lambda f: tone(f, (0.12, 0.09, 0.06), (1.0, 0.80, 0.55), 0.35, 0.95, 1.12),
    "cool": lambda f: tone(f, (0.08, 0.20, 0.24), (0.90, 0.85, 0.80), 0.35, 0.80, 1.10),
    "night": lambda f: tone(f, (0.05, 0.12, 0.25), (0.95, 0.85, 0.80), 0.35, 0.95, 1.14),
    "neon": lambda f: tone(f, (0.16, 0.06, 0.22), (1.0, 0.70, 0.95), 0.30, 1.15, 1.08),
    "dread": lambda f: tone(f, (0.10, 0.16, 0.18), (0.95, 0.80, 0.62), 0.30, 0.92, 1.10),
    "action": lambda f: tone(f, (0.12, 0.10, 0.10), (1.0, 0.85, 0.70), 0.25, 0.80, 1.18),
    "grief": lambda f: tone(f, (0.08, 0.22, 0.26), (0.80, 0.92, 0.95), 0.40, 0.70, 1.04),
    "tension": lambda f: tone(f, (0.05, 0.12, 0.25), (0.95, 0.85, 0.80), 0.38, 0.90, 1.16),
    "memory": lambda f: tone(f, (0.12, 0.11, 0.10), (0.95, 0.88, 0.76), 0.65, 0.25, 1.08, 0.02),
    "triumph": lambda f: tone(f, (0.12, 0.08, 0.05), (1.0, 0.78, 0.50), 0.40, 0.95, 1.18),
    "romance": lambda f: tone(f, (0.18, 0.10, 0.12), (1.0, 0.84, 0.76), 0.30, 1.05, 1.04, 0.01),
}
yy, xx = np.ogrid[:H, :W]
VIG = (1 - 0.38 * (((xx - W / 2) / (W / 2)) ** 2 * 0.8 + ((yy - H / 2) / (H / 2)) ** 2) ** 1.3).astype(np.float32)[..., None]
GRAIN = [cv2.resize(np.random.default_rng(i).normal(0, 1, (H // 3, W // 3)).astype(np.float32), (W, H))[..., None] for i in range(8)]


# ───────────── text layers (RGBA float) ─────────────
def layer():
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def to_arr(im):
    return np.asarray(im, np.float32) / 255


def over(f, rgba, alpha=1.0):
    a = rgba[..., 3:4] * alpha
    return f * (1 - a) + rgba[..., :3] * a


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
        w_ += 12
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


def card_frame(text, sub, t, dur, style):
    """Title cards: black, the title rising in, a slow light sweep, a small subtitle."""
    im = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(im)
    p = min(1, t / 0.9)
    out = max(0, min(1, (dur - t) / 0.5))
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
    fs = font(POP, (40 if sub and len(sub) < 14 else 30) * U)
    y = H * 0.44 + (1 - p) * 30 * U
    d.text(((W - tw) / 2, y), text, font=f, fill=ACCENT if big else (240, 240, 240))
    if sub:
        sw = d.textlength(sub, font=fs)
        d.text(((W - sw) / 2, y + (190 if big else 150) * U), sub, font=fs, fill=(205, 60, 50) if style == "next" else (200, 200, 200))
    if style == "title" and SPEC.get("note"):
        fn = font(POP, 22 * U)
        note = SPEC["note"]
        d.text(((W - d.textlength(note, font=fn)) / 2, H - (260 if not WIDE else 90) * U), note, font=fn, fill=(120, 120, 120))
    a = p * out
    f_ = np.asarray(im, np.float32) / 255 * a
    sweep = np.exp(-(((xx - (-300 + (W + 600) * min(1, t / max(dur, 0.1)))) / 260.0) ** 2)).astype(np.float32)[..., None]
    return np.clip(f_ + f_ * sweep * 0.6, 0, 1)


def probe_duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True).stdout
    try:
        return float(out)
    except ValueError:
        return 0.0


def read_clip(it, n):
    """The shot's frames, exactly n of them. A trimmed take (in/out) is retimed to fill its slot with motion
    interpolation; a clip that is a little short is stretched evenly rather than frozen on its last frame. A missing
    clip falls back to a slow push-in on the shot's still, so a failed shot never leaves a black hole."""
    path, dur = it.get("clip"), it["dur"]
    if not path or not os.path.exists(path):
        still = it.get("still")
        if not still or not os.path.exists(still):
            return np.zeros((n, H, W, 3), np.uint8)
        im = cv2.cvtColor(cv2.imread(still), cv2.COLOR_BGR2RGB)
        s = max(W / im.shape[1], H / im.shape[0])
        im = cv2.resize(im, (int(im.shape[1] * s + 1), int(im.shape[0] * s + 1)), interpolation=cv2.INTER_LANCZOS4)
        y0, x0 = (im.shape[0] - H) // 2, (im.shape[1] - W) // 2
        im = im[y0:y0 + H, x0:x0 + W]
        frames = []
        for i in range(n):
            M = cv2.getRotationMatrix2D((W / 2, H / 2), 0, 1 + 0.06 * i / max(1, n - 1))
            frames.append(cv2.warpAffine(im, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT))
        return np.stack(frames)
    vf = f"fps={FPS}"
    if "in" in it or "out" in it:
        a = float(it.get("in", 0))
        b = min(float(it.get("out", 1e9)), probe_duration(path))
        if b - a > 0.3:
            k = dur / (b - a)
            vf = f"trim=start={a}:end={b},setpts=(PTS-STARTPTS)*{k:.4f}"
            vf += f",minterpolate=fps={FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1" if k > 1.02 else f",fps={FPS}"
    # Engine clips are smaller than the frame: scale with Lanczos, then a light unsharp mask.
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", f"{vf},scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H},unsharp=5:5:0.8:5:5:0.0",
                        "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    fr = np.frombuffer(p, np.uint8).reshape(-1, H, W, 3)
    if not len(fr):
        return np.zeros((n, H, W, 3), np.uint8)
    if len(fr) < n:
        fr = fr[np.linspace(0, len(fr) - 1, n).round().astype(int)]
    return fr[:n]


CAPS = [(c["start"], c["start"] + c["dur"], caption_layer(c.get("speaker"), c["text"])) for c in SPEC.get("captions", [])]
SUPERS = {k: (super_layer(v["title"], v.get("sub")), float(v.get("seconds", 3.0))) for k, v in SPEC.get("supers", {}).items()}
TAGS = {k: nametag_layer(v["name"], v.get("role", "")) for k, v in SPEC.get("tags", {}).items()}

enc = subprocess.Popen(
    ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
     "-i", SPEC["mix"], "-map", "0:v", "-map", "1:a",
     "-af", "loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.85:level=false" + (f",afade=t=out:st={END - 1.5:.2f}:d=1.5" if END < TOTAL else ""),
     "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k",
     "-t", f"{END:.3f}", "-movflags", "+faststart", OUT],
    stdin=subprocess.PIPE,
)

k = 0
prev_last = None
items = SPEC["items"]
for ii, it in enumerate(items):
    if it["start"] >= END:
        break
    n = int(round((it["start"] + it["dur"]) * FPS)) - int(round(it["start"] * FPS))
    f = None
    if it["kind"] == "card":
        src = None
    else:
        src = read_clip(it, n)
    mood = it.get("mood", "golden")
    grade = GRADES.get(mood, GRADES["golden"])
    impacts = [float(x) for x in it.get("impacts", [])]
    for i in range(n):
        t = k / FPS
        lt = i / FPS
        if src is None:
            f = card_frame(it["text"], it.get("sub"), lt, it["dur"], it.get("style", "card"))
        else:
            f = src[i].astype(np.float32) / 255
            for st in impacts:  # a hit, a shot, a slam: a short shake and one bright frame
                if 0 <= lt - st < 0.35:
                    a = 14 * U * math.exp(-(lt - st) / 0.08)
                    r = np.random.default_rng(k)
                    M = np.float32([[1.04, 0, -W * 0.02 + r.uniform(-a, a)], [0, 1.04, -H * 0.02 + r.uniform(-a, a)]])
                    f = cv2.warpAffine(f, M, (W, H), borderMode=cv2.BORDER_REFLECT)
                if 0 <= lt - st < 1 / FPS:
                    f = np.clip(f * 1.5 + 0.12, 0, 1)
            f = grade(f)
            if mood == "memory":  # old film: flicker and heavier grain
                f = f * (0.93 + 0.07 * np.random.default_rng(k).random())
            f = f * VIG + GRAIN[k % 8] * (0.045 if mood == "memory" else 0.022)
            sid = it["id"]
            if sid in SUPERS and lt < SUPERS[sid][1]:
                f = over(f, SUPERS[sid][0], min(1, lt / 0.35, (SUPERS[sid][1] - lt) / 0.35))
            if sid in TAGS and 0.4 <= lt < 3.4:
                f = over(f, TAGS[sid], min(1, (lt - 0.4) / 0.3, (3.4 - lt) / 0.3))
            # dissolve into and out of a flashback
            if ii > 0 and items[ii - 1]["kind"] == "shot" and items[ii - 1].get("mood") != mood and "memory" in (mood, items[ii - 1].get("mood")) and lt < 0.4 and prev_last is not None:
                a = lt / 0.4
                f = f * a + prev_last * (1 - a)
        for c0, c1, cl in CAPS:
            if c0 <= t < c1:
                f = over(f, cl, min(1, (t - c0) / 0.12, (c1 - t) / 0.12))
                break
        f = np.clip(f, 0, 1) * max(0, min(1, t / 0.4, (END - t) / 0.8))
        if k >= NF:
            break
        enc.stdin.write((f * 255).astype(np.uint8).tobytes())
        k += 1
    if src is not None and f is not None:
        prev_last = f.copy()
    print(f"item {ii + 1}/{len(items)}", flush=True)
    if k >= NF:
        break
while k < NF:  # the mix runs a touch longer than the pictures: hold black
    enc.stdin.write(np.zeros((H, W, 3), np.uint8).tobytes())
    k += 1
enc.stdin.close()
code = enc.wait()
if code:
    sys.exit(f"ffmpeg failed ({code})")
print("done", OUT, k, "frames", flush=True)
