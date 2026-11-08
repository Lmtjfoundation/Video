"""AI upscale of LTX clips with Real-ESRGAN realesr-general-x4v3 (SRVGGNetCompact, BSD-3), then Lanczos down to
1200x2144 so the edit's 1080x1920 crop has native-looking detail. Usage: upscale.py WEIGHTS IN.mp4 OUT.mp4"""
import os, subprocess, sys, time
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F

class SRVGGNetCompact(nn.Module):
    def __init__(self, num_feat=64, num_conv=32, upscale=4):
        super().__init__()
        self.upscale = upscale
        body = [nn.Conv2d(3, num_feat, 3, 1, 1), nn.PReLU(num_parameters=num_feat)]
        for _ in range(num_conv):
            body += [nn.Conv2d(num_feat, num_feat, 3, 1, 1), nn.PReLU(num_parameters=num_feat)]
        body.append(nn.Conv2d(num_feat, 3 * upscale * upscale, 3, 1, 1))
        self.body = nn.ModuleList(body)
        self.up = nn.PixelShuffle(upscale)

    def forward(self, x):
        out = x
        for m in self.body:
            out = m(out)
        return self.up(out) + F.interpolate(x, scale_factor=self.upscale, mode="nearest")

W8, SRC, DST = sys.argv[1:4]
OW, OH = 1200, 2144
torch.set_num_threads(int(os.environ.get("THREADS", os.cpu_count())))
net = SRVGGNetCompact()
net.load_state_dict(torch.load(W8, map_location="cpu", weights_only=True)["params"])
net.eval()
w, h = map(int, subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height",
                                          "-of", "csv=p=0", SRC]).decode().strip().split(","))
dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", SRC, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{OW}x{OH}", "-r", "24", "-i", "-",
                        "-c:v", "libx264", "-preset", "medium", "-crf", "12", "-pix_fmt", "yuv420p", DST], stdin=subprocess.PIPE)
n, t0 = 0, time.time()
with torch.inference_mode():
    while True:
        buf = dec.stdout.read(w * h * 3)
        if len(buf) < w * h * 3:
            break
        x = torch.from_numpy(np.frombuffer(buf, np.uint8).reshape(h, w, 3).copy()).permute(2, 0, 1)[None].float() / 255
        y = net(x).clamp(0, 1)
        y = F.interpolate(y, size=(OH, OW), mode="bicubic", antialias=True, align_corners=False).clamp(0, 1)
        enc.stdin.write((y[0].permute(1, 2, 0) * 255 + 0.5).byte().numpy().tobytes())
        n += 1
enc.stdin.close(); enc.wait(); dec.wait()
print(os.path.basename(SRC), n, "frames", round(time.time() - t0), "s", flush=True)
