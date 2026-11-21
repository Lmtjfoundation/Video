"""
One-time (and idempotent) fill of the Azure Files share mounted at /models with the Wan 2.1 First-Last-Frame weights,
so GPU executions never download from the internet at start-up. Run as the "vueio-seed-models" job (CPU only).
Files already present at the right size are skipped; downloads go to a .part file and are renamed when complete.
"""
import os
import sys
import urllib.request
from pathlib import Path

REPO = "https://huggingface.co/Comfy-Org/Wan-2.1/resolve/main/split_files"
FILES = {
    "diffusion_models/wan2.1_flf2v_720p_14B_fp8_e4m3fn.safetensors": "diffusion_models/wan2.1_flf2v_720p_14B_fp8_e4m3fn.safetensors",
    "text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors": "text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors",
    "vae/wan_2.1_vae.safetensors": "vae/wan_2.1_vae.safetensors",
    "clip_vision/clip_vision_h.safetensors": "clip_vision/clip_vision_h.safetensors",
}
ROOT = Path(os.environ.get("MODELS_DIR", "/models"))


def remote_size(url: str) -> int:
    with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=60) as r:
        return int(r.headers.get("Content-Length", "0"))


def fetch(src: str, dest: Path):
    url = f"{REPO}/{src}"
    size = remote_size(url)
    if dest.exists() and dest.stat().st_size == size:
        print(f"have {dest} ({size / 1e9:.1f} GB)")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    print(f"downloading {src} ({size / 1e9:.1f} GB)", flush=True)
    with urllib.request.urlopen(url, timeout=120) as r, open(part, "wb") as out:
        while chunk := r.read(16 * 1024 * 1024):
            out.write(chunk)
    if part.stat().st_size != size:
        sys.exit(f"{src}: got {part.stat().st_size} bytes, expected {size}")
    part.rename(dest)


if __name__ == "__main__":
    for src, dest in FILES.items():
        fetch(src, ROOT / dest)
    print("models ready")
