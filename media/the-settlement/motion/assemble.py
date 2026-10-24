"""Joins the six LTX-Video clips into the 30-second piece: 1080x1920 upscale, film grade, captions, title, mix."""
import subprocess

M = "/tmp/claude-0/-home-user-Video/e94a2179-1832-5221-bb24-9d181da3a815/scratchpad/m30"
FONT = "/home/user/Video/assets/fonts/Poppins-Bold.ttf"
TITLE = "/tmp/claude-0/-home-user-Video/e94a2179-1832-5221-bb24-9d181da3a815/scratchpad/trailer/fonts/Cinzel.ttf"
LINES = [
    (0.5, 3.4, "Houston. Twelve years of marriage."),
    (5.6, 8.1, "He gave her every key."),
    (10.4, 13.6, "She kept the books.\nHe never had to look."),
    (15.6, 18.3, "Then the bank started calling."),
    (20.3, 22.4, "Thirty one thousand dollars."),
    (22.4, 24.8, "A signature that wasn’t his."),
    (25.2, 28.0, "And in the back of her closet,\nsomething was buzzing."),
]


def esc(s):
    return s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace(",", "\\,").replace("%", "\\%")


inputs = []
for i in range(6):
    inputs += ["-i", f"{M}/clips/clip{i + 1}.mp4"]
scale = "".join(f"[{i}:v]trim=0:5,setpts=PTS-STARTPTS,fps=24,scale=1080:1920:flags=lanczos,unsharp=5:5:0.6,setsar=1[v{i}];" for i in range(6))
caps = ",".join(
    f"drawtext=fontfile='{FONT}':text='{esc(t)}':fontsize=50:fontcolor=white:line_spacing=10:text_align=C:x=(w-text_w)/2:y=h*0.80"
    f":box=1:boxcolor=black@0.5:boxborderw=20:enable='between(t,{a},{b})'"
    for a, b, t in LINES
)
title = (f"drawtext=fontfile='{TITLE}':text='THE SETTLEMENT':fontsize=96:fontcolor=white:x=(w-text_w)/2:y=h*0.42"
         f":alpha='if(lt(t,28.2),0,min(1,(t-28.2)/0.5))':enable='gte(t,28.2)'")
grade = ("eq=contrast=1.06:saturation=0.92:gamma=0.98,colorbalance=rs=-0.03:bs=0.05:rh=0.05:bh=-0.04,"
         "vignette=angle=PI/4.4,noise=alls=5:allf=t+u")
fc = (scale + "".join(f"[v{i}]" for i in range(6)) + "concat=n=6:v=1:a=0[cat];"
      f"[cat]{grade},fade=t=in:st=0:d=0.5,fade=t=out:st=29.2:d=0.8:color=black,{caps},{title},format=yuv420p[v];"
      "[6:a]loudnorm=I=-14:TP=-1.0:LRA=11,aresample=48000[a]")
subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-i", f"{M}/mix.wav", "-filter_complex", fc, "-map", "[v]", "-map", "[a]",
                "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", "18", "-c:a", "aac", "-b:a", "256k",
                "-t", "30", "-movflags", "+faststart", f"{M}/the-settlement-motion-30s.mp4"], check=True)
print("done")
