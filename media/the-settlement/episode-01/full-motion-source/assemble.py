"""Final pass: film grade, captions timed to each line, the mix, loudness. Usage: assemble.py OUT_DIR FINAL.mp4"""
import json
import re
import subprocess
import sys

OUT, FINAL = sys.argv[1], sys.argv[2]
TL = json.load(open(f"{OUT}/timeline.json"))
FONT = "/home/user/Video/assets/fonts/Poppins-Bold.ttf"


def esc(s):
    return s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace(",", "\\,").replace("%", "\\%")


def wrap(text, width=30):
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    lines.append(cur)
    return "\n".join(lines)


caps = []
for s in TL["shots"]:
    if s.get("vo") and s["kind"] not in ("card", "title"):
        # Split the line into sentences and give each its share of the spoken time.
        parts = []
        for p in (p.strip() for p in re.split(r"(?<=[.!?])\s+", s["vo"]) if p.strip()):
            # Long sentences break at commas so a caption never runs past two or three lines.
            parts += [q.strip() for q in re.split(r"(?<=,)\s+", p)] if len(p) > 60 else [p]
        merged = []
        for p in parts:  # keep very short sentences together ("Every key. Every password.")
            if merged and len(merged[-1]) + len(p) < 46:
                merged[-1] += " " + p
            else:
                merged.append(p)
        total = sum(len(p) for p in merged)
        t = s["vo_at"]
        for p in merged:
            d = s["vo_len"] * len(p) / total
            caps.append((t, t + d + 0.15, wrap(p)))
            t += d
    if s["kind"] == "talk":
        caps.append((s["talk_at"], s["start"] + s["dur"] - 0.3, wrap(f"{s['who']}: {s['line']}", 32)))

draw = ",".join(
    f"drawtext=fontfile='{FONT}':text='{esc(txt)}':fontsize=50:fontcolor=white:line_spacing=10:text_align=C"
    f":x=(w-text_w)/2:y=h*0.80:box=1:boxcolor=black@0.5:boxborderw=20:enable='between(t,{a:.2f},{b:.2f})'"
    for a, b, txt in caps
)
grade = ("eq=contrast=1.06:saturation=0.92:gamma=0.98,colorbalance=rs=-0.03:bs=0.05:rh=0.05:bh=-0.04,"
         "vignette=angle=PI/4.4,noise=alls=5:allf=t+u")
subprocess.run([
    "ffmpeg", "-v", "error", "-y", "-i", f"{OUT}/picture-raw.mp4", "-i", f"{OUT}/mix.wav",
    "-filter_complex", f"[0:v]{grade},{draw},format=yuv420p[v];[1:a]loudnorm=I=-14:TP=-1.0:LRA=11,aresample=48000[a]",
    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-profile:v", "high", "-level", "4.1", "-preset", "slow", "-crf", "20",
    "-maxrate", "7M", "-bufsize", "14M", "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", FINAL,
], check=True)
print("wrote", FINAL, len(caps), "captions")
