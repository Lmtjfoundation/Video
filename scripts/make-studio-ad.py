#!/usr/bin/env python3
"""
Builds the "whole AI studio" ad: a tour of the real Ghost Post tools (their screens from public/promo/studio and
pictures the app made), a voiceover line per tool, music, and the link on screen the whole time, ending on a card
with the link and a QR code. 1080x1920, plus square and widescreen cuts.

  python3 scripts/make-studio-ad.py <voice dir> <music.mp3> <sfx dir> <out dir> [link]

The voice dir holds a1.wav-a9.wav (one line per beat); the sfx dir hit, swish, tick, rise and shimmer.wav (levelled). Uses scripts/make-ad.py's
helpers, so the two ads share one look.
"""
import importlib.util
import os
import sys

from PIL import Image, ImageDraw, ImageFilter
import qrcode

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("make_ad", os.path.join(ROOT, "scripts", "make-ad.py"))
ad = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ad)
W, H, FPS, MINT, INK, WHITE = ad.W, ad.H, ad.FPS, ad.MINT, ad.INK, ad.WHITE
PROMO = os.path.join(ROOT, "public", "promo")
SITE = "ghostpost.eastus.cloudapp.azure.com"


def link_bar(im):
    """The link, always on screen: a dark pill at the bottom with the logo."""
    d = ImageDraw.Draw(im)
    f = ad.POP(36)
    tw = d.textlength(SITE, font=f)
    w = tw + 120
    x, y = (W - w) / 2, H - 170
    d.rounded_rectangle((x, y, x + w, y + 84), radius=42, fill=(7, 8, 11, 235), outline=(62, 240, 168, 160), width=2)
    im.alpha_composite(Image.open(ad.LOGO).convert("RGBA").resize((48, 48)), (int(x + 22), int(y + 18)))
    d.text((x + 86, y + 20), SITE, font=f, fill=MINT)


def result_card(im, pic, label="Made in Ghost Post"):
    """A result the tool made, as a tilted-free photo card overlapping the window's lower right."""
    p = Image.open(pic).convert("RGB")
    cw, ch = 380, 676
    s = max(cw / p.width, ch / p.height)
    p = p.resize((round(p.width * s), round(p.height * s)), Image.LANCZOS)
    p = p.crop(((p.width - cw) // 2, (p.height - ch) // 2, (p.width - cw) // 2 + cw, (p.height - ch) // 2 + ch))
    card = Image.new("RGBA", (cw + 12, ch + 12), (0, 0, 0, 0))
    ImageDraw.Draw(card).rounded_rectangle((0, 0, cw + 11, ch + 11), radius=30, fill=MINT)
    m = Image.new("L", (cw, ch), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, cw, ch), radius=26, fill=255)
    card.paste(p, (6, 6), m)
    x, y = W - cw - 70, 960
    shadow = Image.new("RGBA", (card.width + 80, card.height + 80), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((40, 50, card.width + 40, card.height + 50), radius=32, fill=(0, 0, 0, 200))
    im.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(22)), (x - 40, y - 40))
    im.alpha_composite(card, (x, y))
    d = ImageDraw.Draw(im)
    f = ad.POP(28)
    tw = d.textlength(label, font=f)
    d.rounded_rectangle((x + (card.width - tw) / 2 - 18, y + card.height - 64, x + (card.width + tw) / 2 + 18, y + card.height - 18), radius=23, fill=(7, 8, 11, 235))
    d.text((x + (card.width - tw) / 2, y + card.height - 58), label, font=f, fill=MINT)


def characters_card(out, title, line):
    """The same character four times (reference + three scenes) in a 2x2 grid, labeled."""
    im = Image.new("RGBA", (W, H), INK + (255,))
    tiles = [("showcase/c0.jpg", "Reference"), ("showcase/c1.jpg", "City"), ("showcase/c2.jpg", "Mountain"), ("showcase/c3.jpg", "Studio")]
    tw_, th_ = W // 2, (H - 560) // 2
    for i, (src, lab) in enumerate(tiles):
        p = Image.open(os.path.join(PROMO, src)).convert("RGB")
        if "c2" in src:
            p = p.crop((int(p.width * 0.15), int(p.height * 0.1), int(p.width * 0.85), int(p.height * 0.7)))
        s = max(tw_ / p.width, th_ / p.height)
        p = p.resize((round(p.width * s) + 1, round(p.height * s) + 1), Image.LANCZOS)
        p = p.crop(((p.width - tw_) // 2, (p.height - th_) // 2, (p.width - tw_) // 2 + tw_, (p.height - th_) // 2 + th_))
        x, y = (i % 2) * tw_, 520 + (i // 2) * th_
        im.paste(p, (x, y))
        d = ImageDraw.Draw(im)
        f = ad.POP(32)
        lw = d.textlength(lab, font=f)
        d.rounded_rectangle((x + 24, y + 24, x + 24 + lw + 40, y + 78), radius=27, fill=MINT if i == 0 else (7, 8, 11, 230))
        d.text((x + 44, y + 31), lab, font=f, fill=INK if i == 0 else WHITE)
    d = ImageDraw.Draw(im)
    d.line([(W // 2, 520), (W // 2, 520 + 2 * th_)], fill=INK, width=6)
    d.line([(0, 520 + th_), (W, 520 + th_)], fill=INK, width=6)
    ad.centered(d, 230, title.upper(), ad.BEBAS(132), WHITE, stroke=3, sfill=INK)
    ad.centered(d, 380, line, ad.POP(42), MINT, stroke=2, sfill=INK)
    link_bar(im)
    im.convert("RGB").save(out, quality=95)
    return out


def screen_card(shot, out, title, line, result=None):
    """A tool's real screen as a floating window on a blurred copy of itself, with its name above."""
    bg = Image.open(shot).convert("RGB")
    s = max(W / bg.width, H / bg.height)
    bg = bg.resize((int(bg.width * s) + 1, int(bg.height * s) + 1), Image.LANCZOS)
    bg = bg.crop(((bg.width - W) // 2, (bg.height - H) // 2, (bg.width - W) // 2 + W, (bg.height - H) // 2 + H))
    bg = Image.blend(bg.filter(ImageFilter.GaussianBlur(28)), Image.new("RGB", (W, H), INK), 0.55).convert("RGBA")
    win = Image.open(shot).convert("RGB")
    ww = 1000
    win = win.resize((ww, round(win.height * ww / win.width)), Image.LANCZOS)
    wh = min(win.height, 900)
    win = win.crop((0, 0, ww, wh))
    frame = Image.new("RGBA", (ww + 8, wh + 52), (0, 0, 0, 0))
    fd = ImageDraw.Draw(frame)
    fd.rounded_rectangle((0, 0, ww + 7, wh + 51), radius=26, fill=(22, 26, 35, 255), outline=(62, 240, 168, 110), width=3)
    for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        fd.ellipse((22 + i * 28, 16, 38 + i * 28, 32), fill=c)
    frame.paste(win, (4, 48))
    shadow = Image.new("RGBA", (frame.width + 80, frame.height + 80), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((40, 50, frame.width + 40, frame.height + 50), radius=30, fill=(0, 0, 0, 170))
    bg.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(24)), ((W - shadow.width) // 2, 560 - 40))
    bg.alpha_composite(frame, ((W - frame.width) // 2, 560))
    d = ImageDraw.Draw(bg)
    ad.centered(d, 250, title.upper(), ad.BEBAS(132), WHITE, stroke=3, sfill=INK)
    ad.centered(d, 400, line, ad.POP(42), MINT, stroke=2, sfill=INK)
    if result:
        result_card(bg, os.path.join(PROMO, result))
    link_bar(bg)
    bg.convert("RGB").save(out, quality=95)
    return out


def picture_card(pic, out, title, line):
    """A picture the app made, full frame, with the tool's name and the link."""
    ad.fit(pic, out)
    im = Image.open(out).convert("RGBA")
    shade = Image.new("RGBA", (W, 560), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    for i in range(560):
        sd.line([(0, i), (W, i)], fill=(0, 0, 0, int(190 * (1 - i / 560))))
    im.alpha_composite(shade, (0, 0))
    d = ImageDraw.Draw(im)
    ad.centered(d, 230, title.upper(), ad.BEBAS(132), WHITE, stroke=3, sfill=INK)
    ad.centered(d, 380, line, ad.POP(42), MINT, stroke=2, sfill=INK)
    link_bar(im)
    im.convert("RGB").save(out, quality=95)
    return out


def main():
    voice, music, sfx, outdir = sys.argv[1:5]
    link = sys.argv[5] if len(sys.argv) > 5 else f"https://{SITE}/welcome?src=ad"
    os.makedirs(outdir, exist_ok=True)
    tmp = os.path.join(outdir, ".work")
    os.makedirs(tmp, exist_ok=True)
    t = lambda n: os.path.join(tmp, n)
    vo = [os.path.join(voice, f"a{i}.wav") for i in range(1, 10)]
    dur = [round(ad.seconds(f) + 0.45, 2) for f in vo]
    dur[-1] = max(dur[-1], 5.0)

    # 1. Hook: four things the app made, fast, under the line.
    hook_pics = ["showcase/h2.jpg", "showcase/c1.jpg", "showcase/h3.jpg", "showcase/c2.jpg"]
    each = dur[0] / len(hook_pics)
    clips = [ad.still_clip(ad.fit(os.path.join(PROMO, p), t(f"hk{i}.jpg"), dark=0.4), t(f"hk{i}.mp4"), each, "punch") for i, p in enumerate(hook_pics)]
    ad.concat(clips, t("hook.mp4"))
    top = ad.canvas()
    d = ImageDraw.Draw(top)
    top.alpha_composite(Image.open(ad.LOGO).convert("RGBA").resize((130, 130)), ((W - 130) // 2, 300))
    ad.centered(d, 690, "ONE APP.", ad.BEBAS(190), WHITE, stroke=4)
    ad.centered(d, 880, "YOUR WHOLE", ad.BEBAS(150), MINT, stroke=4, sfill=INK)
    ad.centered(d, 1030, "AI STUDIO.", ad.BEBAS(150), MINT, stroke=4, sfill=INK)
    link_bar(top)
    top.save(t("hook.png"))
    parts = [ad.overlay(t("hook.mp4"), t("seg1.mp4"), [(t("hook.png"), 0, dur[0], 0.2)])]

    # 2-8. The tour: a real screen or a real result per tool.
    beats = [
        ("screen", "studio/images.jpg", "Image Studio", "Pictures from a sentence", "in", "showcase/h2.jpg"),
        ("screen", "studio/story-video.jpg", "Story to Video", "Any idea, narrated and captioned", "out", "showcase/h1.jpg"),
        ("characters", None, "Characters", "Same face, every scene", "in", None),
        ("screen", "studio/voice-lab.jpg", "Voice Lab", "AI voices, or your own", "out", None),
        ("screen", "studio/create.jpg", "Music & Sound FX", "Made for every video", "in", None),
        ("screen", "studio/movies.jpg", "Movie Studio", "Films and series", "out", "showcase/h3.jpg"),
        ("screen", "studio/calendar.jpg", "Autopilot", "Captions written, posted everywhere", "in", "showcase/c1.jpg"),
    ]
    for i, (kind, src, title, line, move, result) in enumerate(beats):
        card = characters_card(t(f"b{i}.jpg"), title, line) if kind == "characters" else screen_card(os.path.join(PROMO, src), t(f"b{i}.jpg"), title, line, result)
        parts.append(ad.still_clip(card, t(f"seg{i + 2}.mp4"), dur[i + 1], move))

    # 9. End card: start free, the link, a QR code.
    end = Image.new("RGB", (W, H), INK)
    glow = Image.new("RGB", (W, H), INK)
    ImageDraw.Draw(glow).ellipse((-200, 260, 1280, 1460), fill=(18, 70, 52))
    end = glow.filter(ImageFilter.GaussianBlur(160)).convert("RGBA")
    de = ImageDraw.Draw(end)
    end.alpha_composite(Image.open(ad.LOGO).convert("RGBA").resize((180, 180)), ((W - 180) // 2, 200))
    ad.centered(de, 410, "GHOST POST", ad.BEBAS(130), WHITE)
    ad.centered(de, 548, "Your whole AI studio in one app.", ad.POP(42), (255, 255, 255, 215))
    de.rounded_rectangle((190, 660, 890, 800), radius=70, fill=MINT)
    ad.centered(de, 682, "START FREE", ad.BEBAS(104), INK)
    ad.centered(de, 830, "No card needed · cancel any time", ad.POP(34), (255, 255, 255, 170))
    qr = qrcode.QRCode(border=2, box_size=10)
    qr.add_data(link)
    qr.make(fit=True)
    q = qr.make_image(fill_color="black", back_color="white").convert("RGB").resize((380, 380), Image.NEAREST)
    de.rounded_rectangle((340, 930, 740, 1330), radius=34, fill=WHITE)
    end.paste(q, (350, 940))
    ad.centered(de, 1375, "Scan, or go to", ad.POP(36), (255, 255, 255, 170))
    de.rounded_rectangle((60, 1440, 1020, 1540), radius=50, fill=(16, 40, 32, 255), outline=MINT, width=3)
    ad.centered(de, 1462, SITE, ad.POP(44), MINT)
    end.convert("RGB").save(t("end.jpg"), quality=95)
    parts.append(ad.still_clip(t("end.jpg"), t("seg9.mp4"), dur[-1], "in"))

    video = ad.concat(parts, t("video.mp4"))
    total = ad.seconds(video)
    starts = [0.0]
    for d_ in dur[:-1]:
        starts.append(round(starts[-1] + d_, 2))

    # Sound: music ducked under the voice, a whoosh on every cut, a hit at the start and on the end card.
    # Sound design, kept under the voice: a soft low hit to open, a quiet air swish into each tool, a glassy tick as
    # each "Made in Ghost Post" result lands, then a swell into the end card and the hit with a light shimmer on the logo.
    with_result = [i for i, b in enumerate(beats) if b[5]]
    sfx_list = (
        [("hit", 0.0, 0.3), ("shimmer", 0.9, 0.22)]
        + [("swish", s - 0.25, 0.32) for s in starts[1:-1]]
        + [("tick", starts[i + 1] + 0.35, 0.45) for i in with_result]
        + [("rise", max(0, starts[-1] - 2.0), 0.4), ("hit", starts[-1], 0.38), ("shimmer", starts[-1] + 0.15, 0.3)]
    )
    ins = ["-i", music] + sum([["-i", f] for f in vo], []) + sum([["-i", os.path.join(sfx, f"{n}.wav")] for n, _, _ in sfx_list], [])
    f = [f"[0:a]atrim=0:{total},afade=t=in:d=0.4,afade=t=out:st={total - 1.6}:d=1.6,volume=0.5[mus]"]
    for i in range(len(vo)):
        f.append(f"[{i + 1}:a]aresample=48000,adelay={int((starts[i] + 0.15) * 1000)}:all=1,volume=1.2[v{i}]")
    f.append("".join(f"[v{i}]" for i in range(len(vo))) + f"amix=inputs={len(vo)}:normalize=0,apad[vo]")
    f.append("[vo]asplit=2[vo1][vo2]")
    f.append("[mus][vo1]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck]")
    n0 = 1 + len(vo)
    for j, (_, at, vol) in enumerate(sfx_list):
        f.append(f"[{n0 + j}:a]adelay={int(max(0, at) * 1000)}:all=1,volume={vol}[s{j}]")
    f.append("[duck][vo2]" + "".join(f"[s{j}]" for j in range(len(sfx_list))) + f"amix=inputs={2 + len(sfx_list)}:normalize=0,atrim=0:{total},loudnorm=I=-14:TP=-2:LRA=9,volume=1.5dB,alimiter=limit=0.75:level=0,aresample=48000[a]")
    ad.run([*ins, "-filter_complex", ";".join(f), "-map", "[a]", "-c:a", "pcm_s16le", t("mix.wav")])

    vertical = os.path.join(outdir, "studio-ad.mp4")
    ad.run(["-i", video, "-i", t("mix.wav"), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", vertical])
    for name, (w, h) in (("studio-ad-square.mp4", (1080, 1080)), ("studio-ad-wide.mp4", (1920, 1080))):
        ad.run(["-i", vertical, "-filter_complex",
                f"[0:v]split[a][b];[a]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},gblur=sigma=40,eq=brightness=-0.18[bg];[b]scale=-2:{h}[fg];[bg][fg]overlay=(W-w)/2:0,format=yuv420p[v]",
                "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-c:a", "copy", "-movflags", "+faststart", os.path.join(outdir, name)])
    ad.run(["-ss", "1.2", "-i", vertical, "-frames:v", "1", "-q:v", "2", os.path.join(outdir, "studio-ad.jpg")])
    print(f"done: {total:.1f}s ->", outdir)


if __name__ == "__main__":
    main()
