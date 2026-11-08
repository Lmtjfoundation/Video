"""Final pass: film grade, captions timed to each line (speaker names on character lines), the mix, loudness.
Writes the vertical master and a 16:9 version (vertical picture over a blurred, darkened fill).
Usage: assemble.py ROOT OUT_DIR VERTICAL.mp4 WIDE.mp4"""
import json, os, re, subprocess, sys

TEST = os.environ.get("TEST")  # e.g. "40:20" renders 20 s from 40 s, fast preset, to check layout

ROOT, OUT, FINAL, WIDE = sys.argv[1:5]
TL = json.load(open(f"{OUT}/timeline.json"))
FONT = f"{ROOT}/fonts/Poppins-Bold.ttf"
NAME = {"D": "DRE", "M": "MARCUS", "T": "TASHA"}


def esc(s):
    return s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace(",", "\\,").replace("%", "\\%")


def wrap(text, width=30):
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width and cur:
            lines.append(cur); cur = w
        else:
            cur = f"{cur} {w}".strip()
    lines.append(cur)
    return "\n".join(lines)


caps = []
for s in TL["shots"]:
    if not s.get("vo"):
        continue
    who, text = s["vo"]
    parts = []
    for p in (p.strip() for p in re.split(r"(?<=[.!?])\s+", text) if p.strip()):
        parts += [q.strip() for q in re.split(r"(?<=,)\s+", p)] if len(p) > 60 else [p]
    merged = []
    for p in parts:
        if merged and len(merged[-1]) + len(p) < 44:
            merged[-1] += " " + p
        else:
            merged.append(p)
    total = sum(len(p) for p in merged)
    t = s["vo_at"]
    for k, p in enumerate(merged):
        d = s["vo_len"] * len(p) / total
        label = f"{NAME[who]}: " if who in NAME and k == 0 else ""
        caps.append((t, t + d + 0.15, wrap(label + p), who != "N"))
        t += d


def draw(size, y):
    return ",".join(
        f"drawtext=fontfile='{FONT}':text='{esc(txt)}':fontsize={size}:fontcolor={'0xffd36b' if ch else 'white'}:line_spacing=10:text_align=C"
        f":x=(w-text_w)/2:y={y}:box=1:boxcolor=black@0.5:boxborderw=20:enable='between(t,{a:.2f},{b:.2f})'"
        for a, b, txt, ch in caps)


grade = ("eq=contrast=1.06:saturation=0.94:gamma=0.98,colorbalance=rs=-0.03:bs=0.05:rh=0.05:bh=-0.04,"
         "vignette=angle=PI/4.4,noise=alls=5:allf=t+u")
AUD = "[1:a]loudnorm=I=-14:TP=-1.0:LRA=11,aresample=48000[a]"
ENC = ["-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", "19",
       "-maxrate", "9M", "-bufsize", "18M", "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart"]
IN = ["-i", f"{OUT}/picture-raw.mp4", "-i", f"{OUT}/mix.wav"]
if TEST:
    ENC = [*ENC, "-ss", TEST.split(":")[0], "-t", TEST.split(":")[1]]
    ENC[ENC.index("slow")] = "ultrafast"
subprocess.run(["ffmpeg", "-v", "error", "-y", *IN, "-filter_complex",
                f"[0:v]{grade},{draw(50, 'h*0.80')},format=yuv420p[v];{AUD}", *ENC, FINAL], check=True)
wide = (f"[0:v]{grade},split[a][b];[a]scale=1920:-2,crop=1920:1080,gblur=sigma=40,eq=brightness=-0.10:saturation=0.75[bg];"
        f"[b]scale=-2:1080[fg];[bg][fg]overlay=(W-w)/2:0,{draw(44, 'h*0.84')},format=yuv420p[v];{AUD}")
subprocess.run(["ffmpeg", "-v", "error", "-y", *IN, "-filter_complex", wide,
                *ENC, WIDE], check=True)
print("wrote", FINAL, WIDE, len(caps), "captions")
