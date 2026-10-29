#!/usr/bin/env python3
"""
Builds the Ghost Post ad from media the app's own engines made (Flux pictures, ElevenLabs voice, music and sound
effects): a 1080x1920 vertical cut, plus square (1080x1080) and widescreen (1920x1080) cuts and a poster frame.

  python3 scripts/make-ad.py <media dir> <out dir> [link]

The media dir holds h1-h3.jpg (true-story scenes), c0-c3.jpg (a character's portrait, then three scenes with the same
face), vo1-vo6.mp3 (voiceover lines), music.mp3, and whoosh/glass/impact/riser/click.mp3. Needs ffmpeg, Pillow, qrcode.
"""
import math
import os
import subprocess
import sys
import tempfile

import qrcode
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1080, 1920, 30
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, "assets", "fonts")
LOGO = os.path.join(ROOT, "public", "icons", "icon-512.png")
INK, INK2, MINT, MINT2, WHITE, RED = (7, 8, 11), (16, 19, 26), (62, 240, 168), (125, 252, 198), (255, 255, 255), (255, 107, 107)


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


BEBAS = lambda s: font("BebasNeue-Regular.ttf", s)
POP = lambda s: font("Poppins-Bold.ttf", s)


def run(args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def seconds(f):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).decode())


def fit(img_path, out, blur=0, dark=0.0):
    """Cover-crops a picture to 1080x1920 (optionally blurred and darkened)."""
    im = Image.open(img_path).convert("RGB")
    s = max(W / im.width, H / im.height)
    im = im.resize((math.ceil(im.width * s), math.ceil(im.height * s)), Image.LANCZOS)
    x, y = (im.width - W) // 2, (im.height - H) // 2
    im = im.crop((x, y, x + W, y + H))
    if blur:
        im = im.filter(ImageFilter.GaussianBlur(blur))
    if dark:
        im = Image.blend(im, Image.new("RGB", im.size, INK), dark)
    im.save(out, quality=95)
    return out


def canvas():
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def centered(d, y, text, f, fill, stroke=0, sfill=(0, 0, 0)):
    w = d.textlength(text, font=f)
    d.text(((W - w) / 2, y), text, font=f, fill=fill, stroke_width=stroke, stroke_fill=sfill)


def wrap(d, text, f, width):
    lines, line = [], ""
    for word in text.split():
        t = f"{line} {word}".strip()
        if d.textlength(t, font=f) <= width:
            line = t
        else:
            lines.append(line)
            line = word
    return lines + [line] if line else lines


def chip(d, text, y=150):
    """The section label at the top: a dark pill with a mint dot."""
    f = POP(34)
    tw = d.textlength(text, font=f)
    w = tw + 110
    x = (W - w) / 2
    d.rounded_rectangle((x, y, x + w, y + 76), radius=38, fill=(11, 13, 18, 215), outline=(62, 240, 168, 140), width=2)
    d.ellipse((x + 34, y + 29, x + 52, y + 47), fill=MINT)
    d.text((x + 70, y + 16), text, font=f, fill=WHITE)


def bottom_shade(im, top=1150):
    """A soft dark gradient under the captions."""
    g = Image.new("L", (1, H - top))
    for i in range(H - top):
        g.putpixel((0, i), int(205 * (i / (H - top)) ** 1.3))
    shade = Image.new("RGBA", (W, H - top), (0, 0, 0, 255))
    shade.putalpha(g.resize((W, H - top)))
    im.alpha_composite(shade, (0, top))


def caption_png(text, out, y=1430):
    im = canvas()
    d = ImageDraw.Draw(im)
    f = POP(66)
    for i, line in enumerate(wrap(d, text, f, 920)):
        centered(d, y + i * 86, line, f, WHITE, stroke=6)
    im.save(out)
    return out


def still_clip(img, out, dur, move="in", fx=""):
    """A picture with a slow camera move (2x supersampled so the motion is smooth)."""
    n = round(dur * FPS)
    z = {"in": "1+0.10*on/{n}", "out": "1.10-0.10*on/{n}", "punch": "1.04+0.12*(1-pow(1-on/{n},3))"}[move].format(n=n)
    vf = f"scale={W*2}:{H*2},zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s={W}x{H}:fps={FPS}"
    vf += ",eq=contrast=1.06:saturation=1.08,vignette=PI/5"
    if fx:
        vf += "," + fx
    run(["-i", img, "-vf", vf + ",format=yuv420p", "-frames:v", str(n), "-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "17", out])
    return out


def overlay(base, out, layers):
    """layers: [(png, start, end, fade_in)] composited over a clip."""
    args, chain, last = ["-i", base], [], "0:v"
    for i, (png, a, b, fade) in enumerate(layers):
        args += ["-loop", "1", "-i", png]
        chain.append(f"[{i+1}:v]format=rgba,fade=in:st={a}:d={fade}:alpha=1[o{i}]")
        chain.append(f"[{last}][o{i}]overlay=0:0:enable='between(t,{a},{b})':shortest=1[v{i}]")
        last = f"v{i}"
    run([*args, "-filter_complex", ";".join(chain), "-map", f"[{last}]", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-r", str(FPS), out])
    return out


def concat(parts, out):
    lst = out + ".txt"
    with open(lst, "w") as fh:
        fh.writelines(f"file '{p}'\n" for p in parts)
    run(["-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", out])
    return out


def main():
    media, outdir = sys.argv[1], sys.argv[2]
    link = sys.argv[3] if len(sys.argv) > 3 else "https://ghostpost.eastus.cloudapp.azure.com/welcome?src=ad"
    os.makedirs(outdir, exist_ok=True)
    m = lambda n: os.path.join(media, n)
    tmp = tempfile.mkdtemp(prefix="ghostpost-ad-")
    t = lambda n: os.path.join(tmp, n)
    vo = {i: seconds(m(f"vo{i}.mp3")) for i in range(1, 7)}

    # Segment lengths follow the voiceover.
    d0 = round(vo[1] + 0.35, 2)
    d1 = round(vo[2] + 0.45, 2)
    d2 = round(vo[3] + 0.55, 2)
    d3 = round(vo[4] + 0.45, 2)
    d4 = round(vo[5] + 0.55, 2)
    d5 = 4.2
    starts = [0]
    for d in (d0, d1, d2, d3, d4):
        starts.append(round(starts[-1] + d, 2))
    parts = []

    # 0. Hook: a fast montage of what the app makes, under big type.
    shots = ["h2.jpg", "c1.jpg", "h3.jpg", "c2.jpg"]
    each = d0 / len(shots)
    hook = [still_clip(fit(m(s), t(f"hook{i}.jpg"), dark=0.35), t(f"hook{i}.mp4"), each, "punch") for i, s in enumerate(shots)]
    concat(hook, t("hook.mp4"))
    a = canvas()
    da = ImageDraw.Draw(a)
    lg = Image.open(LOGO).convert("RGBA").resize((120, 120))
    a.alpha_composite(lg, ((W - 120) // 2, 170))
    centered(da, 310, "GHOST POST", BEBAS(64), WHITE)
    a.save(t("hook-logo.png"))
    b = canvas()
    db = ImageDraw.Draw(b)
    centered(db, 700, "THIS WHOLE VIDEO", BEBAS(150), WHITE, stroke=4)
    b.save(t("hook-1.png"))
    c = canvas()
    dc = ImageDraw.Draw(c)
    centered(dc, 860, "WAS MADE BY AI", BEBAS(178), MINT, stroke=4, sfill=INK)
    c.save(t("hook-2.png"))
    e = canvas()
    de = ImageDraw.Draw(e)
    centered(de, 1080, "pictures · motion · voice · captions", POP(42), WHITE, stroke=3)
    e.save(t("hook-3.png"))
    parts.append(overlay(t("hook.mp4"), t("seg0.mp4"), [(t("hook-logo.png"), 0, d0, 0.3), (t("hook-1.png"), 0.15, d0, 0.2), (t("hook-2.png"), 0.8, d0, 0.2), (t("hook-3.png"), 1.8, d0, 0.3)]))

    # 1. A true story, told by the app: three scenes with camera moves, the power cut, the smash, the fire.
    s1 = round(d1 / 3, 2)
    flicker = "eq=brightness='if(gt(t,1.4),-0.16+0.05*sin(t*40)*lt(t,1.9),0)':eval=frame"
    shake = "crop=iw-40:ih-40:20+12*sin(t*53):20+12*cos(t*47),scale=1080:1920,eq=brightness='0.35*max(0,1-t*4)':eval=frame"
    fire = "eq=brightness='0.03*sin(t*17)+0.02*sin(t*29)':saturation=1.15:eval=frame"
    heist = [
        still_clip(fit(m("h1.jpg"), t("h1.jpg")), t("h1.mp4"), s1, "in", flicker),
        still_clip(fit(m("h2.jpg"), t("h2.jpg")), t("h2.mp4"), s1, "punch", shake),
        still_clip(fit(m("h3.jpg"), t("h3.jpg")), t("h3.mp4"), round(d1 - 2 * s1, 2), "out", fire),
    ]
    concat(heist, t("heist.mp4"))
    top = canvas()
    bottom_shade(top)
    chip(ImageDraw.Draw(top), "STORY TO VIDEO  ·  TRUE STORY")
    top.save(t("heist-top.png"))
    phrases = ["November 2019.", "Thieves cut the power to Dresden's Green Vault,", "smashed a display case,", "and escaped with 21 pieces of royal jewellery."]
    weights = [len(p) + 12 for p in phrases]
    layers, at = [(t("heist-top.png"), 0, d1, 0.2)], 0.15
    for i, p in enumerate(phrases):
        dur = vo[2] * weights[i] / sum(weights)
        layers.append((caption_png(p, t(f"cap1-{i}.png")), round(at, 2), round(at + dur, 2), 0.08))
        at += dur
    parts.append(overlay(t("heist.mp4"), t("seg1.mp4"), layers))

    # 2. Characters: one portrait as the reference, the same face in three different scenes.
    s2 = round(d2 / 3, 2)
    chars = [still_clip(fit(m(f"c{i}.jpg"), t(f"c{i}.jpg")), t(f"c{i}.mp4"), s2 if i < 3 else round(d2 - 2 * s2, 2), "in" if i % 2 else "out") for i in (1, 2, 3)]
    concat(chars, t("chars.mp4"))
    ov = canvas()
    bottom_shade(ov)
    dv = ImageDraw.Draw(ov)
    chip(dv, "CHARACTERS")
    ref = Image.open(m("c0.jpg")).convert("RGB")
    rs = 300 / ref.width
    ref = ref.resize((300, round(ref.height * rs)), Image.LANCZOS).crop((0, 0, 300, 400))
    mask = Image.new("L", ref.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 300, 400), radius=28, fill=255)
    dv.rounded_rectangle((706, 296, 1014, 704), radius=32, fill=MINT)
    ov.paste(ref, (710, 300), mask)
    dv.rounded_rectangle((736, 660, 988, 716), radius=28, fill=(7, 8, 11, 230))
    f = POP(30)
    dv.text((862 - dv.textlength("Reference", font=f) / 2, 668), "Reference", font=f, fill=MINT)
    ov.save(t("chars-top.png"))
    parts.append(overlay(t("chars.mp4"), t("seg2.mp4"), [(t("chars-top.png"), 0, d2, 0.2), (caption_png("Same face. Every scene.", t("cap2.png")), 0.2, d2, 0.15)]))

    # 3. Voice Lab: your voice replaces the AI voice, the music stays. The waveform is the line being spoken.
    bg = fit(m("c3.jpg"), t("vl-bg.jpg"), blur=18, dark=0.55)
    still_clip(bg, t("vl-bg.mp4"), d3, "in")
    card = canvas()
    dc = ImageDraw.Draw(card)
    chip(dc, "VOICE LAB")
    dc.rounded_rectangle((70, 520, 1010, 1330), radius=48, fill=(16, 19, 26, 238), outline=(62, 240, 168, 120), width=3)
    dc.text((130, 580), "Record your voice", font=POP(58), fill=WHITE)
    dc.text((130, 660), "over any video you made", font=POP(38), fill=(255, 255, 255, 170))
    dc.rounded_rectangle((130, 760, 950, 1000), radius=28, fill=(7, 8, 11, 255))
    rows = [("AI voice", "removed", RED), ("Your voice", "added", MINT), ("Music & effects", "kept", MINT)]
    for i, (k, v, col) in enumerate(rows):
        y = 1050 + i * 82
        dc.text((150, y), k, font=POP(40), fill=WHITE)
        vw = dc.textlength(v, font=POP(36))
        dc.rounded_rectangle((930 - vw - 40, y - 4, 930, y + 56), radius=30, fill=(*col, 60), outline=col, width=2)
        dc.text((930 - vw - 20, y + 4), v, font=POP(36), fill=col)
    card.save(t("vl-card.png"))
    wave = t("vl-wave.mp4")
    run(["-i", m("vo4.mp3"), "-filter_complex", f"[0:a]apad=pad_dur={d3},volume=5,showwaves=s=780x200:mode=cline:draw=full:rate={FPS}:colors=0x3ef0a8:scale=sqrt,format=rgba[w]", "-map", "[w]", "-t", str(d3), "-c:v", "qtrle", t("vl-wave.mov")])
    run(["-i", t("vl-bg.mp4"), "-loop", "1", "-i", t("vl-card.png"), "-i", t("vl-wave.mov"), "-filter_complex",
         f"[1:v]format=rgba,fade=in:st=0:d=0.25:alpha=1[c];[0:v][c]overlay=0:0:shortest=1[a];[a][2:v]overlay=150:780:eof_action=pass[v]",
         "-map", "[v]", "-t", str(d3), "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-r", str(FPS), wave])
    parts.append(wave)

    # 4. Autopilot: the post the app wrote, scheduled to every network.
    bg = fit(m("h2.jpg"), t("ap-bg.jpg"), blur=22, dark=0.6)
    still_clip(bg, t("ap-bg.mp4"), d4, "out")
    phone = canvas()
    dp = ImageDraw.Draw(phone)
    chip(dp, "AUTOPILOT")
    dp.rounded_rectangle((150, 290, 930, 1660), radius=64, fill=(16, 19, 26, 245), outline=(255, 255, 255, 40), width=3)
    th = Image.open(t("h2.jpg")).convert("RGB").crop((0, 520, 1080, 1240)).resize((700, 467), Image.LANCZOS)
    tmask = Image.new("L", th.size, 0)
    ImageDraw.Draw(tmask).rounded_rectangle((0, 0, 700, 467), radius=32, fill=255)
    phone.paste(th, (190, 330), tmask)
    dp.text((200, 830), "Caption written by Ghost Post", font=POP(28), fill=MINT)
    for i, line in enumerate(wrap(dp, "Thieves cut the power to Dresden's Green Vault. 21 pieces. 4,300+ diamonds. Here's how it unravelled.", POP(34), 680)):
        dp.text((200, 880 + i * 48), line, font=POP(34), fill=WHITE)
    dp.text((200, 880 + 4 * 48 + 10), "#truecrime #history #heist", font=POP(30), fill=(125, 252, 198, 220))
    phone.save(t("ap-phone.png"))
    layers = [(t("ap-phone.png"), 0, d4, 0.2)]
    nets = ["TikTok", "Instagram", "YouTube", "Facebook"]
    for i, net in enumerate(nets):
        im = canvas()
        di = ImageDraw.Draw(im)
        x, y = 200 + (i % 2) * 350, 1250 + (i // 2) * 100
        di.rounded_rectangle((x, y, x + 330, y + 80), radius=40, fill=(62, 240, 168, 40), outline=MINT, width=2)
        di.line([(x + 30, y + 41), (x + 44, y + 55), (x + 66, y + 27)], fill=MINT, width=7, joint="curve")
        di.text((x + 78, y + 20), net, font=POP(34), fill=WHITE)
        im.save(t(f"ap-net{i}.png"))
        layers.append((t(f"ap-net{i}.png"), round(0.9 + i * 0.45, 2), d4, 0.12))
    sch = canvas()
    ds = ImageDraw.Draw(sch)
    ds.rounded_rectangle((200, 1480, 880, 1580), radius=50, fill=MINT)
    centered(ds, 1503, "Scheduled · Today 7:00 PM", POP(40), INK)
    sch.save(t("ap-sched.png"))
    layers.append((t("ap-sched.png"), round(0.9 + 4 * 0.45, 2), d4, 0.15))
    parts.append(overlay(t("ap-bg.mp4"), t("seg4.mp4"), layers))

    # 5. End card: what to do next, the link and a QR code.
    end = Image.new("RGB", (W, H), INK)
    glow = Image.new("RGB", (W, H), INK)
    ImageDraw.Draw(glow).ellipse((-200, 300, 1280, 1500), fill=(18, 70, 52))
    end = Image.blend(end, glow.filter(ImageFilter.GaussianBlur(160)), 1.0).convert("RGBA")
    de = ImageDraw.Draw(end)
    end.alpha_composite(Image.open(LOGO).convert("RGBA").resize((200, 200)), ((W - 200) // 2, 230))
    centered(de, 460, "GHOST POST", BEBAS(130), WHITE)
    centered(de, 600, "Faceless videos that post themselves.", POP(44), (255, 255, 255, 210))
    de.rounded_rectangle((190, 730, 890, 870), radius=70, fill=MINT)
    centered(de, 752, "START FREE", BEBAS(104), INK)
    centered(de, 900, "No card needed · cancel any time", POP(36), (255, 255, 255, 170))
    qr = qrcode.QRCode(border=2, box_size=10)
    qr.add_data(link)
    qr.make(fit=True)
    q = qr.make_image(fill_color="black", back_color="white").convert("RGB").resize((400, 400), Image.NEAREST)
    de.rounded_rectangle((330, 1010, 750, 1430), radius=36, fill=WHITE)
    end.paste(q, (340, 1020))
    centered(de, 1480, "Scan, or tap the link", POP(36), (255, 255, 255, 170))
    centered(de, 1540, "ghostpost.eastus.cloudapp.azure.com", POP(40), MINT)
    end.convert("RGB").save(t("end.jpg"), quality=95)
    parts.append(still_clip(t("end.jpg"), t("seg5.mp4"), d5, "in"))

    video = concat(parts, t("video.mp4"))
    total = seconds(video)

    # Sound: music ducked under the voice, the voice placed per segment, effects on the cuts.
    vo_at = [starts[0] + 0.1, starts[1] + 0.15, starts[2] + 0.2, starts[3] + 0.2, starts[4] + 0.2, starts[5] + 0.6]
    sfx = [("impact", 0.0, 0.9), ("riser", max(0, starts[1] - 2.4), 0.5), ("whoosh", starts[1] - 0.35, 0.8), ("glass", starts[1] + s1, 1.0),
           ("whoosh", starts[2] - 0.35, 0.8), ("whoosh", starts[3] - 0.35, 0.8), ("whoosh", starts[4] - 0.35, 0.8),
           *[("click", starts[4] + 0.9 + i * 0.45, 0.6) for i in range(5)], ("impact", starts[5], 1.0)]
    ins = ["-i", m("music.mp3")] + sum([["-i", m(f"vo{i}.mp3")] for i in range(1, 7)], []) + sum([["-i", m(f"{n}.mp3")] for n, _, _ in sfx], [])
    f = [f"[0:a]atrim=0:{total},afade=t=in:d=0.4,afade=t=out:st={total-1.6}:d=1.6,volume=0.55[mus]"]
    for i in range(6):
        f.append(f"[{i+1}:a]adelay={int(vo_at[i]*1000)}:all=1,volume=1.15[v{i}]")
    f.append("".join(f"[v{i}]" for i in range(6)) + "amix=inputs=6:normalize=0,apad[vo]")
    f.append("[vo]asplit=2[vo1][vo2]")
    f.append("[mus][vo1]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck]")
    for j, (_, at, vol) in enumerate(sfx):
        f.append(f"[{7+j}:a]adelay={int(at*1000)}:all=1,volume={vol}[s{j}]")
    f.append("[duck][vo2]" + "".join(f"[s{j}]" for j in range(len(sfx))) + f"amix=inputs={2+len(sfx)}:normalize=0,atrim=0:{total},loudnorm=I=-14:TP=-1.5:LRA=9,volume=2dB,alimiter=limit=0.84:level=0,aresample=48000[a]")
    run([*ins, "-filter_complex", ";".join(f), "-map", "[a]", "-c:a", "pcm_s16le", t("mix.wav")])

    vertical = os.path.join(outdir, "ad-2026.mp4")
    run(["-i", video, "-i", t("mix.wav"), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", vertical])
    # Square and widescreen: the vertical cut over a blurred, enlarged copy of itself.
    for name, (w, h) in (("ad-2026-square.mp4", (1080, 1080)), ("ad-2026-wide.mp4", (1920, 1080))):
        run(["-i", vertical, "-filter_complex",
             f"[0:v]split[a][b];[a]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},gblur=sigma=40,eq=brightness=-0.18[bg];[b]scale=-2:{h}[fg];[bg][fg]overlay=(W-w)/2:0,format=yuv420p[v]",
             "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-c:a", "copy", "-movflags", "+faststart", os.path.join(outdir, name)])
    run(["-ss", str(starts[1] + s1 + 0.6), "-i", vertical, "-frames:v", "1", "-q:v", "2", os.path.join(outdir, "ad-2026.jpg")])
    print(f"done: {total:.1f}s ->", outdir)


if __name__ == "__main__":
    main()
