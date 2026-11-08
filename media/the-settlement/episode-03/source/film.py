"""Renders the picture for The Settlement, Episode 2 and writes timeline.json for the mix.
Each motion shot is cut from LTX-Video clips (448x800, 24 fps), upscaled to 1080x1920 with a slow push so long lines stay alive.
Usage: film.py ROOT OUT_DIR   (ROOT holds clips/, vo/, fonts/)"""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from script import SHOTS  # noqa: E402

ROOT, OUT = (os.path.abspath(p) for p in sys.argv[1:3])
BEBAS, CINZEL = f"{ROOT}/fonts/BebasNeue-Regular.ttf", f"{ROOT}/fonts/Cinzel.ttf"
W, H, FPS = 1080, 1920, 30
PAD, LEAD = 1.1, 0.45  # seconds of air after and before each line
PITCH = {"N": 0.95, "D": 1.0, "M": 1.0, "T": 1.0}  # narrator (Kokoro) plays a little deeper; character voices are ElevenLabs takes at natural pitch
CLIP, SKIP = 121 / 24, 0.2


def dur_of(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]))


def esc(s):
    return s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace(",", "\\,").replace("%", "\\%")


timeline, t = [], 0.0
for i, s in enumerate(SHOTS):
    e = dict(s, index=i, start=t)
    if s.get("vo"):
        who = s["vo"][0]
        e["vo_file"] = f"{ROOT}/vo/{i:03d}_{who}.wav"
        e["pitch"] = PITCH[who]
        e["vo_len"] = dur_of(e["vo_file"]) / PITCH[who]
        e["vo_at"] = t + LEAD
    if "dur" not in s:
        e["dur"] = max(s.get("min_dur", 3.6), LEAD + e.get("vo_len", 0) + PAD)
    e["dur"] = round(e["dur"] * FPS) / FPS
    t += e["dur"]
    timeline.append(e)
os.makedirs(f"{OUT}/seg", exist_ok=True)
json.dump({"total": t, "shots": timeline}, open(f"{OUT}/timeline.json", "w"), indent=1)
print(f"film length {t:.1f} s, {len(timeline)} shots")

ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", "-r", str(FPS), "-an"]


def card_filter(e):
    d = e["dur"]
    fade = lambda t_in: f"'max(0,min(1,(t-{t_in})/0.4)-max(0,(t-{d - 0.5})/0.4))'"
    if e.get("small"):
        big, size, subsize = BEBAS, 110, 64
    elif e.get("font") == "cinzel":
        big, size, subsize = CINZEL, 96, 84 if e.get("end") else 120
    else:
        big, size, subsize = BEBAS, 160, 120
    parts = [f"drawtext=fontfile='{big}':text='{esc(e['text'])}':fontsize={size}:fontcolor=white:x=(w-text_w)/2:"
             f"y=(h-text_h)/2-{70 if e.get('sub') else 0}:alpha={fade(0.2)}"]
    if e.get("sub"):
        red = e.get("end") or e.get("red") or e["text"].startswith("EPISODE ")
        parts.append(f"drawtext=fontfile='{BEBAS}':text='{esc(e['sub'])}':fontsize={subsize}:fontcolor={'0xd62626' if red else '0xd8d8d8'}:"
                     f"x=(w-text_w)/2:y=(h-text_h)/2+{90 if not e.get('small') else 60}:alpha={fade(0.7)}")
    return ",".join(parts)


def render(e):
    out = f"{OUT}/seg/{e['index']:03d}.mp4"
    if os.path.exists(out):
        return out
    d, n = e["dur"], round(e["dur"] * FPS)
    enc = [*ENC, "-frames:v", str(n)]
    if e["kind"] in ("card", "black"):
        vf = card_filter(e) if e["kind"] == "card" else "null"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=0x050505:s={W}x{H}:r={FPS}", "-vf", vf, *enc, out], check=True)
        return out
    clips, off = e["clips"], e.get("offset", 0.0)
    share = d / len(clips)
    ins, chains = [], []
    for j, c in enumerate(clips):
        avail = CLIP - SKIP - off
        speed = max(1.0, share / avail)  # >1 = slow down, blended to 30 fps
        ins += ["-ss", f"{SKIP + off}", "-i", f"{ROOT}/clips/{c}.mp4"]
        # Upscale with a little headroom and drift slowly inward across the shot.
        z = 1.06 + 0.05 * min(1.0, share / 8)
        chains.append(
            f"[{j}:v]setpts={speed:.4f}*(PTS-STARTPTS),framerate={FPS},fps={FPS},"
            f"scale={round(W * z / 2) * 2}:{round(H * z / 2) * 2}:flags=lanczos,"
            f"crop={W}:{H}:'(iw-{W})/2':'(ih-{H})/2 - (ih-{H})/2*(1-t/{share:.3f})*0.6',"
            f"unsharp=5:5:0.5:5:5:0.0,trim=duration={share:.4f},setpts=PTS-STARTPTS,"
            f"tpad=stop_mode=clone:stop_duration=1,trim=duration={share:.4f}[c{j}]")
    cat = "".join(f"[c{j}]" for j in range(len(clips)))
    post = ["fade=in:st=0:d=0.35"] if e["index"] == 0 else []
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
