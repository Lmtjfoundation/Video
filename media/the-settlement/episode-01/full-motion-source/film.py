"""Renders the picture for The Settlement, Episode 1 (full motion) and writes timeline.json for the mix.
Every picture shot is cut from AI motion clips (448x800, 24 fps), upscaled to 1080x1920. Usage: film.py OUT_DIR"""
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from script import SHOTS, SCR, clip  # noqa: E402

OUT = sys.argv[1]
VO = f"{SCR}/ch1b/vo"
BEBAS, CINZEL = f"{SCR}/fonts/BebasNeue-Regular.ttf", f"{SCR}/fonts/Cinzel.ttf"
W, H, FPS = 1080, 1920, 30
PAD, LEAD = 1.5, 0.5  # seconds of air after and before each narration line
PITCH = 0.95  # the mix plays narration 5% slower (deeper)
CLIP, SKIP = 121 / 24, 0.25  # clip length; the first frames are the source still, so skip a little


def dur_of(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]))


def esc(s):
    return s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace(",", "\\,").replace("%", "\\%")


vo_files = sorted(f for f in os.listdir(VO) if f.endswith(".wav"))
timeline, t, k = [], 0.0, 0
for i, s in enumerate(SHOTS):
    e = dict(s, index=i, start=t)
    if s.get("vo"):
        e["vo_file"] = f"{VO}/{vo_files[k]}"
        e["vo_len"] = dur_of(e["vo_file"]) / PITCH
        e["vo_at"] = t + LEAD
        k += 1
    if s["kind"] == "talk":
        e["dur"] = dur_of(s["src"]) + 0.8
        e["talk_at"] = t + 0.3
    elif "dur" not in s:
        e["dur"] = max(s.get("min_dur", 4.0), LEAD + e["vo_len"] + PAD)
    e["dur"] = round(e["dur"] * FPS) / FPS
    t += e["dur"]
    timeline.append(e)
assert k == len(vo_files), (k, len(vo_files))
os.makedirs(f"{OUT}/seg", exist_ok=True)
json.dump({"total": t, "shots": timeline}, open(f"{OUT}/timeline.json", "w"), indent=1)
print(f"film length {t:.1f} s, {len(timeline)} shots")

ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", "-r", str(FPS), "-an"]
UP = f"scale={W}:{H}:flags=lanczos,unsharp=5:5:0.55:5:5:0.0"


def card_filter(e):
    big = CINZEL if e.get("font") == "cinzel" else BEBAS
    size = 92 if e.get("font") == "cinzel" else 150
    d = e["dur"]
    fade = lambda t_in: f"'max(0,min(1,(t-{t_in})/0.4)-max(0,(t-{d - 0.55})/0.4))'"
    parts = [f"drawtext=fontfile='{big}':text='{esc(e['text'])}':fontsize={size}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-{70 if e.get('sub') else 0}:alpha={fade(0.25)}"]
    if e.get("sub"):
        parts.append(f"drawtext=fontfile='{BEBAS}':text='{esc(e['sub'])}':fontsize={130 if not e.get('end') else 96}:fontcolor={'white' if not e.get('end') else '0xd62626'}:x=(w-text_w)/2:y=(h-text_h)/2+90:alpha={fade(0.8)}")
    return ",".join(parts)


def render(e):
    out = f"{OUT}/seg/{e['index']:03d}.mp4"
    if os.path.exists(out):
        return out
    d, n = e["dur"], round(e["dur"] * FPS)
    enc = [*ENC, "-frames:v", str(n)]
    if e["kind"] in ("card", "black"):
        vf = card_filter(e) if e["kind"] == "card" else "null"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=black:s={W}x{H}:r={FPS}", "-vf", vf, *enc, out], check=True)
    elif e["kind"] == "talk":
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", e["src"], "-vf",
                        f"scale={H}:{H}:flags=lanczos,crop={W}:{H}:(iw-{W})/2:0,tpad=stop_mode=clone:stop_duration=2,"
                        f"fade=in:st=0:d=0.2,fade=out:st={d - 0.25}:d=0.25", *enc, out], check=True)
    else:
        # Split the shot between its clips; a clip shorter than its share plays slower (blended to 30 fps).
        clips = e["clips"]
        share = d / len(clips)
        ins, chains = [], []
        for j, c in enumerate(clips):
            avail = CLIP - SKIP
            speed = max(1.0, share / avail)  # >1 = slow down
            ins += ["-ss", f"{SKIP}", "-i", clip(c)]
            chains.append(f"[{j}:v]setpts={speed:.4f}*(PTS-STARTPTS),framerate={FPS},fps={FPS},{UP},trim=duration={share:.4f},setpts=PTS-STARTPTS,"
                          f"tpad=stop_mode=clone:stop_duration=1,trim=duration={share:.4f}[c{j}]")
        cat = "".join(f"[c{j}]" for j in range(len(clips)))
        post = [f"fade=in:st=0:d=0.25"] if e["index"] == 0 else []
        if e.get("flash"):
            post.append(f"eq=brightness='if(gt(t,{d - 0.45}),(t-{d - 0.45})/0.45*0.9,0)':eval=frame")
        fc = ";".join(chains) + f";{cat}concat=n={len(clips)}:v=1:a=0,fps={FPS}" + ("," + ",".join(post) if post else "") + "[v]"
        subprocess.run(["ffmpeg", "-v", "error", "-y", *ins, "-filter_complex", fc, "-map", "[v]", *enc, out], check=True)
    return out


with ThreadPoolExecutor(2) as ex:
    segs = list(ex.map(render, timeline))
with open(f"{OUT}/list.txt", "w") as f:
    f.writelines(f"file '{p}'\n" for p in segs)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", f"{OUT}/list.txt", "-c", "copy", f"{OUT}/picture-raw.mp4"], check=True)
print("picture done", dur_of(f"{OUT}/picture-raw.mp4"))
