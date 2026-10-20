"""
Ghost Post Video Engine — Ghost Post's own text- and image-to-video model server.

Runs Alibaba's open Wan 2.2 models (Apache 2.0) on your GPU so Ghost Post's Film Engine can make moving footage
without Seedance, Replicate or any per-clip fee. Two quality profiles (ENGINE_QUALITY):
  best (default)  Wan 2.2 I2V-A14B: the strongest open model, two 14B experts (high-noise layout, low-noise detail).
                  720p, 81 frames at 16 fps (about 5 seconds) from a first frame. Needs an 80 GB GPU.
                  Clips with no first frame use TI2V-5B (loaded only when first needed).
  fast            Wan 2.2 TI2V-5B: 720p, 121 frames at 24 fps (5 seconds), from text or a first frame. 24 GB and up.
The Film Engine chains clips from each last frame into beats of up to 30 seconds and adds voices and score itself.

API (every call except /health needs `Authorization: Bearer <ENGINE_TOKEN>`):
  GET  /health                 -> {"ok": true}                      (for the host's health check)
  GET  /v1/info                -> profile, models, GPU, whether loaded, queue length
  POST /v1/videos              -> {"id": ...}                       start a clip
  GET  /v1/videos/{id}         -> {"status": queued|running|succeeded|failed, "progress": 0..1, "error"?}
  GET  /v1/videos/{id}/file    -> the MP4

Settings (environment): ENGINE_TOKEN (required in production), ENGINE_QUALITY (best|fast), ENGINE_OFFLOAD
(auto|on|off: keep idle model parts in CPU memory), ENGINE_STEPS (default 40), HF_HOME (model cache).
ENGINE_MODEL=tiny / tiny-best build tiny random models of each profile for tests.
"""

from __future__ import annotations

import base64
import io
import logging
import math
import os
import queue
import secrets
import tempfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

import torch
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from PIL import Image, ImageOps
from pydantic import BaseModel, Field

log = logging.getLogger("engine")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

TINY = os.environ.get("ENGINE_MODEL", "") in ("tiny", "tiny-best")
QUALITY = "best" if os.environ.get("ENGINE_MODEL") == "tiny-best" else ("fast" if TINY else os.environ.get("ENGINE_QUALITY", "best"))
TOKEN = os.environ.get("ENGINE_TOKEN") or ""
if not TOKEN:
    TOKEN = secrets.token_urlsafe(24)
    log.warning("ENGINE_TOKEN is not set; using a one-time token for this run: %s", TOKEN)
OUT_DIR = os.environ.get("ENGINE_OUT") or os.path.join(tempfile.gettempdir(), "ghost-post-engine")
KEEP_SECONDS = 3 * 3600
FIVE_B = "Wan-AI/Wan2.2-TI2V-5B-Diffusers"
A14B = "Wan-AI/Wan2.2-I2V-A14B-Diffusers"
# Wan's own default negative prompt (it was trained with it): garish colours, overexposure, static frames, blur,
# subtitles, low quality, JPEG artefacts, ugly or deformed faces and hands, extra fingers, fused fingers, still
# images, cluttered backgrounds, three legs, crowds, walking backwards.
NEGATIVE = (
    "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，"
    "多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走"
)
ASPECTS = {"9:16": 9 / 16, "16:9": 16 / 9, "1:1": 1.0, "21:9": 21 / 9, "4:3": 4 / 3, "3:4": 3 / 4}


@dataclass(frozen=True)
class Profile:
    """How one model is driven, from its model card."""

    model: str
    fps: int
    max_frames: int  # 4n+1
    area: int  # pixels per frame at 720p
    mod: int  # both sides must be multiples of this
    guidance: float
    steps: int


PROFILES = {
    "best": Profile(A14B, fps=16, max_frames=81, area=1280 * 720, mod=16, guidance=3.5, steps=40),
    "fast": Profile(FIVE_B, fps=24, max_frames=121, area=1280 * 704, mod=32, guidance=5.0, steps=40),
}
if QUALITY not in PROFILES:
    raise SystemExit(f"ENGINE_QUALITY must be best or fast, not {QUALITY!r}")
MAIN = PROFILES[QUALITY]
TEXT = PROFILES["fast"]  # clips with no first frame (the A14B model needs one)


def size_for(aspect: str, p: Profile) -> tuple[int, int]:
    """Width and height for a frame shape at the profile's 720p pixel count, rounded to the model's grid."""
    if TINY:
        return (32, 32)
    r = ASPECTS[aspect]
    width = round(math.sqrt(p.area * r) / p.mod) * p.mod
    height = round(math.sqrt(p.area / r) / p.mod) * p.mod
    return width, height


def clip_frames(seconds: float, p: Profile) -> int:
    """Wan needs 4n+1 frames."""
    n = round(seconds * p.fps / 4)
    return max(17, min(p.max_frames, 4 * n + 1))


class VideoRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    negative_prompt: str | None = Field(default=None, max_length=2000)
    # The first frame, base64 (PNG/JPEG/WebP). Without it the clip is made from the prompt alone.
    image: str | None = None
    aspect: str = "16:9"
    seconds: float = Field(default=5, gt=0, le=5.1)
    steps: int | None = Field(default=None, ge=2, le=80)
    guidance: float | None = Field(default=None, ge=1, le=12)
    seed: int | None = None


@dataclass
class Job:
    id: str
    req: VideoRequest
    status: str = "queued"
    progress: float = 0.0
    error: str | None = None
    file: str | None = None
    created: float = field(default_factory=time.time)


class Engine:
    def __init__(self) -> None:
        self.i2v = None  # first frame -> video (best: A14B; fast: TI2V-5B)
        self.t2v = None  # text -> video (TI2V-5B; in "best" loaded when first needed)
        self.ready = False
        self.load_error: str | None = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.dtype = torch.bfloat16 if self.device == "cuda" else torch.float32
        mode = os.environ.get("ENGINE_OFFLOAD", "auto")
        # The A14B pair (two 14B experts plus the text encoder) doesn't fit on one GPU at once, even at 80 GB:
        # Alibaba runs it with offloading. TI2V-5B fits on 40 GB and up.
        self.offload = self.device == "cuda" and (mode == "on" or (mode == "auto" and (QUALITY == "best" or gpu_memory_gb() < 40)))
        self.jobs: dict[str, Job] = {}
        self.q: queue.Queue[str] = queue.Queue()
        self.lock = threading.Lock()

    # ── Loading ──────────────────────────────────────────────────────────────
    def load(self) -> None:
        try:
            from diffusers import WanImageToVideoPipeline

            if QUALITY == "best":
                self.i2v = WanImageToVideoPipeline(**tiny_a14b()) if TINY else WanImageToVideoPipeline.from_pretrained(A14B, torch_dtype=self.dtype)
                self.place(self.i2v)
            else:
                self.t2v = self.five_b()
                comps = {k: getattr(self.t2v, k) for k in ("tokenizer", "text_encoder", "transformer", "vae", "scheduler")}
                self.i2v = WanImageToVideoPipeline(**comps, transformer_2=None, image_encoder=None, image_processor=None, boundary_ratio=None, expand_timesteps=True)
            log.info("Ready: %s on %s (%.0f GB, offload=%s)", MAIN.model, self.device, gpu_memory_gb(), self.offload)
            self.ready = True
        except Exception as e:  # noqa: BLE001 - reported to Ghost Post through /v1/info
            self.load_error = f"{type(e).__name__}: {e}"
            log.exception("Model failed to load")

    def five_b(self):
        """TI2V-5B as a text-to-video pipeline (its VAE stays in float32, as the model card does)."""
        from diffusers import AutoencoderKLWan, WanPipeline

        if TINY:
            pipe = WanPipeline(**tiny_5b(), transformer_2=None, boundary_ratio=None, expand_timesteps=True)
        else:
            vae = AutoencoderKLWan.from_pretrained(FIVE_B, subfolder="vae", torch_dtype=torch.float32)
            pipe = WanPipeline.from_pretrained(FIVE_B, vae=vae, torch_dtype=self.dtype)
        self.place(pipe)
        return pipe

    def place(self, pipe) -> None:
        if self.offload:
            pipe.enable_model_cpu_offload()
        else:
            pipe.to(self.device)

    # ── Jobs ─────────────────────────────────────────────────────────────────
    def submit(self, req: VideoRequest) -> Job:
        job = Job(id=uuid.uuid4().hex, req=req)
        with self.lock:
            self.jobs[job.id] = job
        self.q.put(job.id)
        return job

    def worker(self) -> None:
        while True:
            job = self.jobs.get(self.q.get())
            if not job:
                continue
            while not self.ready and not self.load_error:
                time.sleep(2)
            if self.load_error:
                job.status, job.error = "failed", f"The model couldn't load: {self.load_error}"
                continue
            job.status = "running"
            try:
                job.file = self.render(job)
                job.status, job.progress = "succeeded", 1.0
            except Exception as e:  # noqa: BLE001
                log.exception("Job %s failed", job.id)
                job.status, job.error = "failed", f"{type(e).__name__}: {e}"[:500]
                if self.device == "cuda":
                    torch.cuda.empty_cache()
            self.cleanup()

    def render(self, job: Job) -> str:
        from diffusers.utils import export_to_video

        r = job.req
        has_image = bool(r.image)
        p = MAIN if has_image else TEXT
        if has_image:
            pipe = self.i2v
        else:
            if self.t2v is None:
                log.info("First clip without a starting picture: loading TI2V-5B")
                self.t2v = self.five_b()
            pipe = self.t2v
        if self.offload and QUALITY == "fast":
            pipe.enable_model_cpu_offload()  # the two "fast" pipelines share modules; this moves the hooks across
        width, height = size_for(r.aspect, p)
        steps = r.steps or int(os.environ.get("ENGINE_STEPS", p.steps))

        def on_step(_pipe, i, _t, kwargs):
            job.progress = min(0.99, (i + 1) / steps)
            return kwargs

        args = dict(
            prompt=r.prompt,
            negative_prompt=r.negative_prompt or NEGATIVE,
            height=height,
            width=width,
            num_frames=clip_frames(r.seconds, p),
            num_inference_steps=steps,
            guidance_scale=r.guidance or p.guidance,
            generator=torch.Generator(device="cpu").manual_seed(r.seed if r.seed is not None else secrets.randbelow(2**31)),
            callback_on_step_end=on_step,
        )
        if TINY:
            args["max_sequence_length"] = 16
        if has_image:
            args["image"] = first_frame(r.image, width, height)
        with torch.inference_mode():
            video = pipe(**args).frames[0]
        os.makedirs(OUT_DIR, exist_ok=True)
        path = os.path.join(OUT_DIR, f"{job.id}.mp4")
        export_to_video(video, path, fps=p.fps)
        return path

    def cleanup(self) -> None:
        cutoff = time.time() - KEEP_SECONDS
        with self.lock:
            for jid in [j.id for j in self.jobs.values() if j.created < cutoff and j.status in ("succeeded", "failed")]:
                job = self.jobs.pop(jid)
                if job.file and os.path.exists(job.file):
                    os.remove(job.file)


def first_frame(b64: str, width: int, height: int) -> Image.Image:
    """Decodes the starting picture and crops it to fill the frame (centre), as the models expect."""
    try:
        raw = base64.b64decode(b64.split(",", 1)[-1], validate=False)
        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img).convert("RGB")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"The starting picture couldn't be read: {e}") from e
    return ImageOps.fit(img, (width, height), Image.Resampling.LANCZOS)


def gpu_memory_gb() -> float:
    if not torch.cuda.is_available():
        return 0.0
    return torch.cuda.get_device_properties(0).total_memory / 1024**3


def _tiny_text():
    from transformers import AutoConfig, AutoTokenizer, T5EncoderModel

    config = AutoConfig.from_pretrained("hf-internal-testing/tiny-random-t5")
    return T5EncoderModel(config).eval(), AutoTokenizer.from_pretrained("hf-internal-testing/tiny-random-t5")


def _tiny_transformer(in_channels: int, out_channels: int):
    from diffusers import WanTransformer3DModel

    torch.manual_seed(0)
    return WanTransformer3DModel(
        patch_size=(1, 2, 2), num_attention_heads=2, attention_head_dim=12, in_channels=in_channels, out_channels=out_channels, text_dim=32,
        freq_dim=256, ffn_dim=32, num_layers=2, cross_attn_norm=True, qk_norm="rms_norm_across_heads", rope_max_seq_len=32,
    )


def tiny_5b() -> dict:
    """A tiny random TI2V-5B (diffusers' own test configuration) to check the server without a GPU."""
    from diffusers import AutoencoderKLWan, UniPCMultistepScheduler

    torch.manual_seed(0)
    vae = AutoencoderKLWan(
        base_dim=3, z_dim=48, in_channels=12, out_channels=12, is_residual=True, patch_size=2, latents_mean=[0.0] * 48, latents_std=[1.0] * 48,
        dim_mult=[1, 1, 1, 1], num_res_blocks=1, scale_factor_spatial=16, scale_factor_temporal=4, temperal_downsample=[False, True, True],
    )
    text_encoder, tokenizer = _tiny_text()
    scheduler = UniPCMultistepScheduler(prediction_type="flow_prediction", use_flow_sigmas=True, flow_shift=3.0)
    return {"tokenizer": tokenizer, "text_encoder": text_encoder, "transformer": _tiny_transformer(48, 48), "vae": vae, "scheduler": scheduler}


def tiny_a14b() -> dict:
    """A tiny random I2V-A14B (two experts with a switch-over boundary), diffusers' own test configuration."""
    from diffusers import AutoencoderKLWan, UniPCMultistepScheduler

    torch.manual_seed(0)
    vae = AutoencoderKLWan(base_dim=3, z_dim=16, dim_mult=[1, 1, 1, 1], num_res_blocks=1, temperal_downsample=[False, True, True])
    text_encoder, tokenizer = _tiny_text()
    scheduler = UniPCMultistepScheduler(prediction_type="flow_prediction", use_flow_sigmas=True, flow_shift=3.0)
    return {
        "tokenizer": tokenizer, "text_encoder": text_encoder, "vae": vae, "scheduler": scheduler,
        "transformer": _tiny_transformer(36, 16), "transformer_2": _tiny_transformer(36, 16),
        "image_encoder": None, "image_processor": None, "boundary_ratio": 0.875,
    }


engine = Engine()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    os.makedirs(OUT_DIR, exist_ok=True)
    threading.Thread(target=engine.load, daemon=True).start()
    threading.Thread(target=engine.worker, daemon=True).start()
    yield


app = FastAPI(title="Ghost Post Video Engine", version="1.1", lifespan=lifespan)


def authorised(authorization: str = Header(default="")) -> None:
    if not secrets.compare_digest(authorization, f"Bearer {TOKEN}"):
        raise HTTPException(401, "Wrong or missing engine token.")


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/v1/info", dependencies=[Depends(authorised)])
def info() -> dict:
    return {
        "engine": "Ghost Post Video Engine",
        "quality": QUALITY,
        "model": MAIN.model,
        "text_model": TEXT.model,
        "ready": engine.ready,
        "error": engine.load_error,
        "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
        "vram_gb": round(gpu_memory_gb(), 1),
        "offload": engine.offload,
        "queue": engine.q.qsize(),
        "max_seconds": round(MAIN.max_frames / MAIN.fps, 2),
        "fps": MAIN.fps,
        "aspects": list(ASPECTS),
    }


@app.post("/v1/videos", dependencies=[Depends(authorised)])
def create(req: VideoRequest) -> dict:
    if engine.load_error:
        raise HTTPException(503, f"The model couldn't load: {engine.load_error}")
    if req.aspect not in ASPECTS:
        raise HTTPException(400, f"aspect must be one of {', '.join(ASPECTS)}")
    if req.image:
        first_frame(req.image, 32, 32)  # reject an unreadable picture now, not minutes later
    job = engine.submit(req)
    return {"id": job.id, "status": job.status}


@app.get("/v1/videos/{job_id}", dependencies=[Depends(authorised)])
def status(job_id: str) -> dict:
    job = engine.jobs.get(job_id)
    if not job:
        raise HTTPException(404, "No such job (finished clips are kept for 3 hours).")
    return {"id": job.id, "status": job.status, "progress": round(job.progress, 3), "error": job.error}


@app.get("/v1/videos/{job_id}/file", dependencies=[Depends(authorised)])
def file(job_id: str) -> FileResponse:
    job = engine.jobs.get(job_id)
    if not job or job.status != "succeeded" or not job.file:
        raise HTTPException(404, "The clip isn't ready.")
    return FileResponse(job.file, media_type="video/mp4", filename=f"{job_id}.mp4")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
