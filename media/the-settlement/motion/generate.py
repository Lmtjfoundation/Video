"""Animates each still with LTX-Video 2B (0.9.6 distilled, 8 steps) on the CPU. Usage: generate.py MODEL EMBEDS OUTDIR [indexes]"""
import os, subprocess, sys, time
import numpy as np
import torch
from PIL import Image
from diffusers import AutoencoderKLLTXVideo, FlowMatchEulerDiscreteScheduler, LTXImageToVideoPipeline, LTXVideoTransformer3DModel

M, EMB, OUT = sys.argv[1:4]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prompts import SHOTS

torch.set_num_threads(os.cpu_count())
W, H, FRAMES, FPS = 448, 800, 121, 24  # 9:16, 5 seconds
which = [int(x) for x in sys.argv[4].split(",")] if len(sys.argv) > 4 else range(len(SHOTS))

pipe = LTXImageToVideoPipeline(
    scheduler=FlowMatchEulerDiscreteScheduler.from_pretrained(M, subfolder="scheduler"),
    vae=AutoencoderKLLTXVideo.from_pretrained(M, subfolder="vae", torch_dtype=torch.bfloat16),
    text_encoder=None,
    tokenizer=None,
    transformer=LTXVideoTransformer3DModel.from_pretrained(M, subfolder="transformer", variant="bf16", torch_dtype=torch.bfloat16),
)
pipe.vae.enable_tiling()
emb = torch.load(EMB)
os.makedirs(OUT, exist_ok=True)


def fit(path):
    im = Image.open(path).convert("RGB")
    r = W / H
    w, h = im.size
    if w / h > r:
        nw = round(h * r)
        im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = round(w / r)
        im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    return im.resize((W, H), Image.LANCZOS)


for i in which:
    dst = f"{OUT}/clip{i + 1}.mp4"
    if os.path.exists(dst):
        continue
    t = time.time()
    with torch.inference_mode():
        frames = pipe(
            image=fit(SHOTS[i][0]),
            prompt_embeds=emb[i]["embeds"],
            prompt_attention_mask=emb[i]["mask"],
            width=W, height=H, num_frames=FRAMES, frame_rate=FPS,
            num_inference_steps=8, guidance_scale=1.0,
            decode_timestep=0.05, decode_noise_scale=0.025,
            generator=torch.Generator().manual_seed(42 + i),
            output_type="np",
        ).frames[0]
    arr = (np.clip(frames, 0, 1) * 255).astype(np.uint8)
    ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                           "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", dst + ".tmp.mp4"], stdin=subprocess.PIPE)
    ff.stdin.write(arr.tobytes())
    ff.stdin.close()
    ff.wait()
    os.replace(dst + ".tmp.mp4", dst)
    print(f"clip{i + 1} done in {time.time() - t:.0f}s", flush=True)
