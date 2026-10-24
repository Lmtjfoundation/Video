"""The Settlement, Episode 1, hype cut: beat-synced picture with effects, text slams and captions.
Usage: edit.py OUT_DIR   (writes OUT_DIR/picture.mp4 and OUT_DIR/timeline.json for the score)"""
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = sys.argv[1]
S = "/tmp/claude-0/-home-user-Video/e94a2179-1832-5221-bb24-9d181da3a815/scratchpad"
SEG = f"{S}/ch1b/out/seg"
LTX = f"{S}/m30/clips"
NEW = f"{S}/hype/ltx/clips"
TALK = f"{S}/ch1/talk"
VO = f"{S}/hype/vo"
FONTS = f"{S}/trailer/fonts"
BEBAS, CINZEL = f"{FONTS}/BebasNeue-Regular.ttf", f"{FONTS}/Cinzel.ttf"
POPPINS = "/home/user/Video/assets/fonts/Poppins-Bold.ttf"
W, H, FPS = 1080, 1920, 30
BPM = 140
BEAT = 60 / BPM


def seg(n):
    return f"{SEG}/{n:03d}.mp4"


def new(n, fallback):
    """A fresh AI-motion shot if it has been made, else the depth-motion version of the same picture."""
    p = f"{NEW}/clip{n}.mp4"
    return p if os.path.exists(p) else fallback


# Each shot: source, beats, start offset in the source (s), effect. Effects: push (punch-in), shake, flash (white in),
# glitch (colour split + noise), slow (half speed), black.
SHOTS = [
    # Cold open: a flash-forward.
    dict(src=f"{LTX}/clip5.mp4", beats=4, at=0.3, fx="push"),
    dict(src=seg(3), beats=2, at=2.0, fx="flash"),
    dict(src=new(2, seg(5)), beats=2, at=1.0, fx="shake"),
    dict(src=f"{LTX}/clip6.mp4", beats=4, at=0.5, fx="push"),
    dict(src=seg(28), beats=2, at=1.0, fx="glitch"),
    dict(src=f"{LTX}/clip1.mp4", beats=6, at=0.2, fx="flash"),
    dict(src=None, beats=8, fx="black", mark="title"),
    dict(src=None, beats=4, fx="black"),
    # Houston, 2012.
    dict(src=new(1, seg(3)), beats=8, at=0.0, fx="push", mark="2012"),
    dict(src=seg(4), beats=4, at=1.0, fx="shake"),
    dict(src=seg(6), beats=4, at=2.0, fx="flash", mark="sirens"),
    dict(src=new(2, seg(5)), beats=8, at=0.5, fx="shake", mark="tasha_line"),
    dict(src=seg(7), beats=4, at=1.0, fx="push"),
    dict(src=seg(6), beats=4, at=4.0, fx="glitch"),
    dict(src=seg(4), beats=8, at=3.0, fx="push", mark="nine"),
    dict(src=None, beats=8, fx="black", mark="later"),
    # Twelve years later.
    dict(src=f"{LTX}/clip2.mp4", beats=8, at=0.0, fx="push", mark="present"),
    dict(src=seg(9), beats=4, at=2.0, fx="flash"),
    dict(src=f"{LTX}/clip3.mp4", beats=4, at=1.0, fx="push"),
    dict(src=f"{TALK}/tasha-money.mp4", beats=11, at=0.0, fx="talk", mark="tasha_talk"),
    dict(src=new(3, seg(14)), beats=8, at=0.5, fx="push"),
    dict(src=seg(16), beats=6, at=1.0, fx="push", mark="listening"),
    dict(src=seg(3), beats=3, at=5.0, fx="glitch"),
    dict(src=None, beats=4, fx="black", mark="riser"),
    # The money.
    dict(src=seg(18), beats=6, at=1.0, fx="flash", mark="drop"),
    dict(src=f"{LTX}/clip4.mp4", beats=9, at=0.5, fx="push", mark="card"),
    dict(src=f"{TALK}/marcus-bank.mp4", beats=10, at=0.0, fx="talk", mark="marcus_talk"),
    dict(src=seg(22), beats=7, at=1.0, fx="shake", mark="forged"),
    dict(src=seg(23), beats=4, at=2.0, fx="push"),
    dict(src=seg(21), beats=4, at=1.0, fx="flash"),
    dict(src=seg(17), beats=4, at=2.0, fx="push", mark="where"),
    dict(src=f"{LTX}/clip5.mp4", beats=8, at=1.0, fx="push", mark="dread"),
    dict(src=seg(25), beats=6, at=2.0, fx="push"),
    dict(src=seg(26), beats=6, at=2.0, fx="push"),
    # The reveal.
    dict(src=new(4, f"{LTX}/clip6.mp4"), beats=8, at=0.0, fx="shake", mark="buzz"),
    dict(src=seg(27), beats=4, at=3.0, fx="push"),
    dict(src=seg(28), beats=6, at=1.0, fx="glitch", mark="contact"),
    dict(src=None, beats=2, fx="black", mark="silence"),
    dict(src=None, beats=8, fx="black", mark="d"),
    dict(src=None, beats=8, fx="black", mark="next"),
    dict(src=None, beats=4, fx="black", mark="follow"),
]

# Narration: (line file, shot mark or index, seconds after that shot starts).
LINES = [
    ("l00", 0, 0.25), ("l01", 3, 0.2),
    ("l02", "2012", 0.2), ("l03", 9, 0.95), ("l04", "tasha_line", 0.25), ("l05", 12, 0.2), ("l06", 13, 0.1), ("l07", "nine", 0.4),
    ("l08", "present", 0.3), ("l09", 20, 0.3), ("l10", "listening", 0.3),
    ("l11", "drop", 0.1), ("l12", "card", 0.15), ("l13", "forged", 0.4), ("l14", 28, 1.45), ("l15", "dread", 0.5),
    ("l16", "buzz", 0.4), ("l17", "contact", 0.3), ("l18", "d", 0.15),
]
TEXT = {
    "l00": "Twelve years ago, she saved his life.", "l01": "Now somebody wants it back.",
    "l02": "Marcus Grant ran the Southside with his best friend, Dre.", "l03": "Fast money. Short lives.",
    "l04": "TASHA: “Get in this car. Or I’m done with you.”", "l05": "He got in.", "l06": "Dre didn’t.", "l07": "Dre did nine years. For both of them.",
    "l08": "Marcus gave her everything. Every key. Every password. Every dollar.", "l09": "But Tasha wanted something of her own.", "l10": "And somebody was listening.",
    "l11": "Then the money started moving.", "l12": "A card in his name. Thirty-one thousand dollars.", "l13": "A loan on his mother’s house. His name. Not his hand.",
    "l14": "His birthday. Their anniversary. She was always somewhere else.", "l15": "One night, he came home early. Her phone went straight to voicemail.",
    "l16": "Then, behind the heels he bought her, something was buzzing.", "l17": "A second phone. One contact.", "l18": "",
}
# Text slams: (shot mark, seconds in, text, style).
SLAMS = [
    ("title", 0.0, "THE SETTLEMENT", "title"), ("2012", 0.0, "HOUSTON · 2012", "white"), ("nine", 0.0, "9 YEARS", "red"),
    ("later", 0.2, "12 YEARS LATER", "white"), ("card", 0.6, "$31,000", "red"), ("forged", 0.5, "FORGED", "stamp"),
    ("where", 0.1, "WHERE IS SHE?", "white"), ("contact", 0.3, "ONE CONTACT", "white"), ("d", 0.0, "D", "giant"),
    ("next", 0.0, "EPISODE 2\nONE CONTACT", "white"), ("follow", 0.0, "FOLLOW FOR PART 2", "red"),
]

# ── Timeline on the beat grid ─────────────────────────────────────
t_beats = 0
for i, s in enumerate(SHOTS):
    s["index"] = i
    s["start"] = round(t_beats * BEAT * FPS) / FPS
    t_beats += s["beats"]
    s["end"] = round(t_beats * BEAT * FPS) / FPS
    s["dur"] = s["end"] - s["start"]
TOTAL = SHOTS[-1]["end"]
mark = {s["mark"]: s for s in SHOTS if s.get("mark")}
shot_of = lambda k: mark[k] if isinstance(k, str) else SHOTS[k]


def dur_of(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]))


lines = []
for name, where, off in LINES:
    f = f"{VO}/{name}.wav"
    lines.append({"file": f, "at": shot_of(where)["start"] + off, "len": dur_of(f), "text": TEXT[name]})
# The characters' own lines (talking shots) are spoken too; nobody may talk over anyone else.
spoken = sorted([(ln["at"], ln["at"] + ln["len"], ln["file"].split("/")[-1]) for ln in lines] + [(s["start"] + 0.1, s["start"] + 0.1 + dur_of(s["src"]), s["mark"]) for s in SHOTS if s["fx"] == "talk"])
for (a0, a1, an), (b0, b1, bn) in zip(spoken, spoken[1:]):
    if b0 < a1 + 0.05:
        raise SystemExit(f"{bn} starts at {b0:.2f}s, before {an} ends at {a1:.2f}s")
os.makedirs(f"{OUT}/seg", exist_ok=True)
json.dump({"bpm": BPM, "total": TOTAL, "shots": [{k: v for k, v in s.items()} for s in SHOTS], "lines": lines, "marks": {k: v["start"] for k, v in mark.items()}}, open(f"{OUT}/timeline.json", "w"), indent=1)
print(f"hype cut {TOTAL:.1f} s, {len(SHOTS)} shots")


# ── Shots ─────────────────────────────────────────────────────────
GRADE = "eq=contrast=1.12:saturation=1.08:gamma=0.97,colorbalance=rs=-0.04:bs=0.07:rh=0.07:bh=-0.05,vignette=angle=PI/4.2"


def render(s):
    out = f"{OUT}/seg/{s['index']:03d}.mp4"
    if os.path.exists(out):
        return out
    n, d = round(s["dur"] * FPS), s["dur"]
    if s["fx"] == "black":
        cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=black:s={W}x{H}:r={FPS}", "-frames:v", str(n)]
    else:
        src = s["src"]
        length = dur_of(src)
        at = min(s.get("at", 0.0), max(0.0, length - 0.2))
        slow = d > length - at  # stretch a short source to fill the shot
        speed = f"setpts={min(4.0, d / max(0.2, length - at)):.3f}*PTS," if slow else ""
        cover = f"scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H},"
        fx = s["fx"]
        z = 0.14 if fx in ("push", "talk") else 0.06
        # Punch-in: a steady zoom across the shot, eased; shake adds a handheld jitter.
        zoom = f"scale=w='2*trunc({W}*(1+{z}*t/{d:.3f})/2)':h='2*trunc({H}*(1+{z}*t/{d:.3f})/2)':eval=frame,"
        if fx == "shake":
            crop = f"crop={W}:{H}:x='(iw-{W})/2+9*sin(37*t)+5*sin(91*t)':y='(ih-{H})/2+9*cos(41*t)+4*sin(77*t)',"
        else:
            crop = f"crop={W}:{H},"
        extra = ""
        if fx == "flash":
            extra = "fade=t=in:st=0:d=0.18:color=white,"
        if fx == "glitch":
            extra = "rgbashift=rh=-14:bh=14:gv=6,noise=alls=28:allf=t,"
        if fx == "talk":
            extra = "fade=t=in:st=0:d=0.12:color=white,"
        vf = f"{speed}fps={FPS},{cover}{zoom}{crop}{extra}{GRADE},noise=alls=6:allf=t,format=yuv420p"
        cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{at:.3f}", "-i", src, "-vf", vf, "-frames:v", str(n), "-an"]
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "17", "-r", str(FPS), "-pix_fmt", "yuv420p", out + ".tmp.mp4"]
    subprocess.run(cmd, check=True)
    os.replace(out + ".tmp.mp4", out)  # only a finished shot is ever reused
    return out


with ThreadPoolExecutor(3) as ex:
    segs = list(ex.map(render, SHOTS))
with open(f"{OUT}/list.txt", "w") as f:
    f.writelines(f"file '{p}'\n" for p in segs)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", f"{OUT}/list.txt", "-c", "copy", f"{OUT}/cut.mp4"], check=True)


# ── Text slams: each a short PNG sequence that hits big and settles ──
def slam_frames(i, text, style):
    d = f"{OUT}/slam{i:02d}"
    os.makedirs(d, exist_ok=True)
    font_path = CINZEL if style == "title" else BEBAS
    size = {"title": 104, "giant": 760, "stamp": 230, "red": 220, "white": 170}[style]
    colour = (226, 32, 40) if style in ("red", "stamp", "giant") else (255, 255, 255)
    frames = 8  # 0.27 s to land
    for k in range(frames + 1):
        p = k / frames
        scale = 1 + 0.55 * (1 - p) ** 3
        fnt = ImageFont.truetype(font_path, int(size * scale))
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        dr = ImageDraw.Draw(img)
        box = dr.multiline_textbbox((0, 0), text, font=fnt, align="center", spacing=int(size * 0.1))
        tw, th = box[2] - box[0], box[3] - box[1]
        x, y = (W - tw) / 2 - box[0], (H * (0.46 if style != "giant" else 0.42) - th / 2) - box[1]
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(glow).multiline_text((x, y), text, font=fnt, fill=(0, 0, 0, 235), align="center", spacing=int(size * 0.1), stroke_width=max(4, size // 18), stroke_fill=(0, 0, 0, 235))
        glow = glow.filter(ImageFilter.GaussianBlur(max(6, size // 14)))
        img.alpha_composite(glow)
        ImageDraw.Draw(img).multiline_text((x, y), text, font=fnt, fill=colour + (int(255 * min(1, 0.4 + p)),), align="center", spacing=int(size * 0.1))
        if style == "stamp":
            img = img.rotate(-8, resample=Image.BICUBIC)
        img.save(f"{d}/{k:03d}.png")
    return d, frames


inputs, chains = ["-i", f"{OUT}/cut.mp4"], []
prev = "0:v"
for i, (m, off, text, style) in enumerate(SLAMS):
    s = mark[m]
    t0 = s["start"] + off
    t1 = s["end"] - 0.02
    d, frames = slam_frames(i, text, style)
    k = inputs.count("-i")  # this slam's input number
    inputs += ["-framerate", str(FPS), "-i", f"{d}/%03d.png"]
    # The animation plays once, then its last frame holds until the shot ends.
    chains.append(f"[{k}:v]tpad=stop_mode=clone:stop_duration={t1 - t0:.3f},setpts=PTS+{t0:.3f}/TB[s{i}]")
    chains.append(f"[{prev}][s{i}]overlay=0:0:enable='between(t,{t0:.3f},{t1:.3f})':eof_action=pass[o{i}]")
    prev = f"o{i}"


def esc(s):
    return s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace(",", "\\,").replace("%", "\\%")


def wrap(text, width=26):
    words, out, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width and cur:
            out.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    out.append(cur)
    return "\n".join(out)


caps = []
for ln in lines:
    if not ln["text"]:
        continue
    parts = [p for p in ln["text"].replace(". ", ".|").replace("? ", "?|").split("|") if p]
    total = sum(len(p) for p in parts)
    t = ln["at"]
    for p in parts:
        dd = ln["len"] * len(p) / total
        caps.append((t, t + dd + 0.1, wrap(p)))
        t += dd
caps.sort()
caps = [(a, min(b, caps[k + 1][0] - 0.03) if k + 1 < len(caps) else b, txt) for k, (a, b, txt) in enumerate(caps)]  # one caption at a time
draw = ",".join(
    f"drawtext=fontfile='{POPPINS}':text='{esc(txt)}':fontsize=58:fontcolor=white:borderw=6:bordercolor=black@0.85:line_spacing=8:text_align=C"
    f":x=(w-text_w)/2:y=h*0.74:enable='between(t,{a:.2f},{b:.2f})'"
    for a, b, txt in caps
)
chains.append(f"[{prev}]{draw},format=yuv420p[v]")
subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(chains), "-map", "[v]", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", str(FPS), f"{OUT}/picture.mp4"], check=True)
print("picture done")
