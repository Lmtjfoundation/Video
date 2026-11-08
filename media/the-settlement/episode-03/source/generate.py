"""Animates each Canva still with LTX-Video 2B (0.9.6 distilled, 8 steps) on the CPU, same settings as Episode 1.
Usage: generate.py SINGLE_FILE MODEL_DIR EMBEDS IMG_DIR OUT_DIR [names]"""
import os, subprocess, sys, time
import numpy as np, torch
from PIL import Image
from diffusers import AutoencoderKLLTXVideo, FlowMatchEulerDiscreteScheduler, LTXImageToVideoPipeline, LTXVideoTransformer3DModel

SF, M, EMB, IMG, OUT = sys.argv[1:6]
torch.set_num_threads(os.cpu_count())
W, H, FRAMES, FPS = 448, 800, 121, 24
emb = torch.load(EMB)
which = sys.argv[6].split(",") if len(sys.argv) > 6 else list(emb)
pipe = LTXImageToVideoPipeline(
    scheduler=FlowMatchEulerDiscreteScheduler.from_pretrained(M, subfolder="scheduler"),
    vae=AutoencoderKLLTXVideo.from_single_file(SF, torch_dtype=torch.bfloat16),
    text_encoder=None, tokenizer=None,
    transformer=LTXVideoTransformer3DModel.from_single_file(SF, torch_dtype=torch.bfloat16),
)
pipe.vae.enable_tiling()
os.makedirs(OUT, exist_ok=True)

def fit(path):
    im = Image.open(path).convert("RGB")
    r, (w, h) = W / H, im.size
    if w / h > r:
        nw = round(h * r); im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = round(w / r); im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    return im.resize((W, H), Image.LANCZOS)

for i, k in enumerate(which):
    dst = f"{OUT}/{k}.mp4"
    if os.path.exists(dst):
        continue
    t = time.time()
    with torch.inference_mode():
        frames = pipe(image=fit(f"{IMG}/{k}.png"), prompt_embeds=emb[k]["embeds"], prompt_attention_mask=emb[k]["mask"],
                      width=W, height=H, num_frames=FRAMES, frame_rate=FPS, num_inference_steps=8, guidance_scale=1.0,
                      decode_timestep=0.05, decode_noise_scale=0.025, generator=torch.Generator().manual_seed(7 + i),
                      output_type="np").frames[0]
    arr = (np.clip(frames, 0, 1) * 255).astype(np.uint8)
    ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                           "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", dst + ".tmp.mp4"], stdin=subprocess.PIPE)
    ff.stdin.write(arr.tobytes()); ff.stdin.close(); ff.wait()
    os.replace(dst + ".tmp.mp4", dst)
    print(f"{k} done in {time.time() - t:.0f}s", flush=True)
