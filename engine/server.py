"""
Ghost Post Video Engine — Ghost Post's own text- and image-to-video model server.

Runs Alibaba's open Wan 2.2 models (Apache 2.0) on your GPU so Ghost Post's Film Engine can make moving footage
without Seedance, Replicate or any per-clip fee. Two quality profiles (ENGINE_QUALITY):
  best (default)  Wan 2.2 I2V-A14B: the strongest open model, two 14B experts (high-noise layout, low-noise detail).
                  720p, 81 frames at 16 fps (about 5 seconds) from a first frame. Needs an 80 GB GPU.
                  Clips with no first frame use TI2V-5B (loaded only when first needed).
  fast            Wan 2.2 TI2V-5B: 720p, 121 frames at 24 fps (5 seconds), from text or a first frame. 24 GB and up.
The Film Engine chains clips from each last frame into beats of up to 30 seconds and adds voices and score itself.

Writing, so the app needs no paid AI service for scripts, series plans or the Director chat:
  Qwen3-8B (Apache 2.0), loaded the first time it's asked to write (ENGINE_TEXT_MODEL; ENGINE_TEXT=off turns it off).

Pictures, so the app needs no paid picture service either (both Apache 2.0, loaded the first time they're asked for):
  Qwen-Image             text to picture.
  Qwen-Image-Edit-2511   picture editing, and putting up to three reference pictures (cast portraits, a location)
                         into a new scene with their faces kept.

API (every call except /health needs `Authorization: Bearer <ENGINE_TOKEN>`):
  GET  /health                 -> {"ok": true}                      (for the host's health check)
  GET  /v1/info                -> profile, models, GPU, whether loaded, queue length
  POST /v1/videos              -> {"id": ...}                       start a clip
  GET  /v1/videos/{id}         -> {"status": queued|running|succeeded|failed, "progress": 0..1, "error"?}
  GET  /v1/videos/{id}/file    -> the MP4
  POST /v1/images              -> {"id": ...}                       start a picture (with "images": an edit)
  GET  /v1/images/{id}         -> same status shape as videos
  GET  /v1/images/{id}/file    -> the PNG
                               with "op": "upscale" (Real-ESRGAN x4, BSD-3) or "remove-bg" (BiRefNet, MIT) and one picture,
                               a picture tool instead: up to 4096 px on the long side, or a transparent PNG
  POST /v1/video-edits         -> {"id": ...}  change a clip with Wan 2.1 VACE (Apache 2.0): {"task", "video", "prompt",
                               "image"?, "box"?} where task is restyle | relight (new look, same motion), motion (the
                               picture's subject performs the clip's motion), background (new background, same subject)
                               or inpaint (regenerate the box [x, y, w, h] as fractions of the frame)
  GET  /v1/video-edits/{id}    and /v1/video-edits/{id}/file, as for videos
  POST /v1/chat                -> {"text": ...}                     write: {"system", "user", "max_tokens", "temperature"}
  /v1/audio...                 music and sound effects: forwarded to the audio engine (audio_server.py, AUDIO_URL)
  /v1/speech...                voices, voice cloning, voice-to-voice: forwarded to speech_server.py (SPEECH_URL)
  /v1/lipsync...               lip sync and talking avatars: forwarded to lipsync_server.py (LIPSYNC_URL)
  /v1/voice-design...          a new voice from a description: forwarded to voicedesign_server.py (VOICEDESIGN_URL)

Settings (environment): ENGINE_TOKEN (required in production), ENGINE_QUALITY (best|fast), ENGINE_OFFLOAD
(auto|on|off: keep idle model parts in CPU memory), ENGINE_STEPS (default 40), HF_HOME (model cache).
AUDIO_URL / SPEECH_URL / LIPSYNC_URL / VOICEDESIGN_URL (defaults 127.0.0.1:8001 / 8002 / 8003 / 8004): where the side services listen, each in
its own Python environment (start.sh runs them).
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
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, Response
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
T2I = os.environ.get("ENGINE_IMAGE_MODEL", "Qwen/Qwen-Image")
WRITER = os.environ.get("ENGINE_TEXT_MODEL", "Qwen/Qwen3-8B")
WRITING = os.environ.get("ENGINE_TEXT", "on") != "off"
EDIT = os.environ.get("ENGINE_EDIT_MODEL", "Qwen/Qwen-Image-Edit-2511")
AUDIO_URL = os.environ.get("AUDIO_URL", "http://127.0.0.1:8001").rstrip("/")
SPEECH_URL = os.environ.get("SPEECH_URL", "http://127.0.0.1:8002").rstrip("/")
LIPSYNC_URL = os.environ.get("LIPSYNC_URL", "http://127.0.0.1:8003").rstrip("/")
VOICEDESIGN_URL = os.environ.get("VOICEDESIGN_URL", "http://127.0.0.1:8004").rstrip("/")
# Qwen-Image's native sizes per frame shape (from its model card).
IMAGE_SIZES = {"1:1": (1328, 1328), "16:9": (1664, 928), "9:16": (928, 1664), "4:3": (1472, 1104), "3:4": (1104, 1472), "21:9": (1792, 768)}
A14B = "Wan-AI/Wan2.2-I2V-A14B-Diffusers"
VACE = os.environ.get("ENGINE_VACE_MODEL", "Wan-AI/Wan2.1-VACE-14B-diffusers")
DEPTH = "depth-anything/Depth-Anything-V2-Small-hf"  # Apache 2.0: the structure VACE follows when restyling
UPSCALER = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth"
VACE_SIZES = {"16:9": (832, 480), "9:16": (480, 832), "1:1": (624, 624)}
VACE_FPS, VACE_FRAMES = 16, 81
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


class ChatRequest(BaseModel):
    system: str = Field(default="", max_length=20_000)
    user: str = Field(min_length=1, max_length=60_000)
    max_tokens: int = Field(default=2500, ge=1, le=16_000)
    temperature: float = Field(default=0.7, ge=0, le=2)


class Writer:
    """The writing model, loaded on first use and shared by all requests (one at a time)."""

    def __init__(self) -> None:
        self.model = None
        self.tokenizer = None
        self.lock = threading.Lock()

    def write(self, r: ChatRequest) -> str:
        if TINY:
            # No real weights in tests: a reply that depends on the request.
            return f'{{"echo": {len(r.user)}, "system": {len(r.system)}}}'
        with self.lock:
            if self.model is None:
                from transformers import AutoModelForCausalLM, AutoTokenizer

                log.info("First writing request: loading %s", WRITER)
                self.tokenizer = AutoTokenizer.from_pretrained(WRITER)
                self.model = AutoModelForCausalLM.from_pretrained(WRITER, torch_dtype="auto", device_map="auto").eval()
            messages = ([{"role": "system", "content": r.system}] if r.system else []) + [{"role": "user", "content": r.user}]
            # Qwen3 answers directly (no hidden reasoning) so the whole budget goes to the answer.
            prompt = self.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
            inputs = self.tokenizer([prompt], return_tensors="pt").to(self.model.device)
            sample = r.temperature > 0
            with torch.inference_mode():
                out = self.model.generate(
                    **inputs, max_new_tokens=r.max_tokens, do_sample=sample, temperature=r.temperature if sample else None,
                    top_p=0.8 if sample else None, top_k=20 if sample else None,
                )
            return self.tokenizer.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True).strip()


writer = Writer()


class ImageRequest(BaseModel):
    prompt: str = Field(default="", max_length=4000)
    # "generate" (from the prompt, or an edit with images) or a picture tool on images[0].
    op: str = Field(default="generate", pattern="^(generate|upscale|remove-bg)$")
    scale: int = Field(default=4, ge=2, le=4)
    negative_prompt: str | None = Field(default=None, max_length=2000)
    # Up to three pictures, base64. With them the request is an edit: change the first picture, or put the people
    # and places from all of them into a new scene ("the woman in picture 1 at the table in picture 2").
    images: list[str] = Field(default_factory=list, max_length=3)
    aspect: str = "9:16"
    steps: int | None = Field(default=None, ge=2, le=80)
    guidance: float | None = Field(default=None, ge=1, le=12)
    seed: int | None = None


class EditRequest(BaseModel):
    task: str = Field(pattern="^(restyle|relight|motion|background|inpaint)$")
    video: str
    prompt: str = Field(min_length=1, max_length=4000)
    negative_prompt: str | None = Field(default=None, max_length=2000)
    # motion: the person or thing that performs the clip's motion; others: an optional reference for the new content.
    image: str | None = None
    # inpaint: the region to regenerate, as fractions of the frame [x, y, width, height].
    box: list[float] | None = Field(default=None, min_length=4, max_length=4)
    aspect: str = "16:9"
    seconds: float = Field(default=5, gt=0, le=5.1)
    steps: int | None = Field(default=None, ge=2, le=80)
    seed: int | None = None


@dataclass
class Job:
    id: str
    req: VideoRequest | ImageRequest | EditRequest
    status: str = "queued"
    progress: float = 0.0
    error: str | None = None
    file: str | None = None
    created: float = field(default_factory=time.time)


class Engine:
    def __init__(self) -> None:
        self.i2v = None  # first frame -> video (best: A14B; fast: TI2V-5B)
        self.t2v = None  # text -> video (TI2V-5B; in "best" loaded when first needed)
        self.t2i = None  # text -> picture (Qwen-Image), loaded when first asked for
        self.edit = None  # picture editing (Qwen-Image-Edit), loaded when first asked for
        self.vace = None  # video edits (Wan 2.1 VACE), loaded when first asked for
        self.depth = None  # depth maps for video edits (Depth Anything V2 Small)
        self.upscaler = None  # Real-ESRGAN x4plus
        self.cutout = None  # background removal (BiRefNet)
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
    def submit(self, req: VideoRequest | ImageRequest | EditRequest) -> Job:
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
                if isinstance(job.req, ImageRequest):
                    job.file = self.picture(job) if job.req.op == "generate" else self.picture_tool(job)
                elif isinstance(job.req, EditRequest):
                    job.file = self.edit_video(job)
                else:
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

    def picture(self, job: Job) -> str:
        """One picture: from the prompt alone (Qwen-Image) or an edit of up to three pictures (Qwen-Image-Edit)."""
        r = job.req
        width, height = (64, 64) if TINY else IMAGE_SIZES[r.aspect]
        os.makedirs(OUT_DIR, exist_ok=True)
        path = os.path.join(OUT_DIR, f"{job.id}.png")
        refs = [read_picture(b) for b in r.images]
        if TINY:
            # No real weights in tests: a picture that depends on the request, so the API can be checked end to end.
            seed = sum(map(ord, r.prompt)) + len(refs)
            img = Image.new("RGB", (width, height), (seed % 256, (seed * 7) % 256, (seed * 13) % 256))
            if refs:
                img.paste(ImageOps.fit(refs[0], (width // 2, height // 2)), (0, 0))
            img.save(path)
            job.progress = 1.0
            return path
        if refs:
            if self.edit is None:
                from diffusers import QwenImageEditPlusPipeline

                log.info("First picture edit: loading %s", EDIT)
                self.edit = QwenImageEditPlusPipeline.from_pretrained(EDIT, torch_dtype=self.dtype)
                self.edit.enable_model_cpu_offload()  # shares the GPU with the video model
            pipe, steps = self.edit, r.steps or 40
        else:
            if self.t2i is None:
                from diffusers import QwenImagePipeline

                log.info("First picture: loading %s", T2I)
                self.t2i = QwenImagePipeline.from_pretrained(T2I, torch_dtype=self.dtype)
                self.t2i.enable_model_cpu_offload()
            pipe, steps = self.t2i, r.steps or 50

        def on_step(_pipe, i, _t, kwargs):
            job.progress = min(0.99, (i + 1) / steps)
            return kwargs

        args = dict(
            prompt=r.prompt,
            negative_prompt=r.negative_prompt or " ",
            width=width,
            height=height,
            num_inference_steps=steps,
            true_cfg_scale=r.guidance or 4.0,
            generator=torch.Generator(device="cpu").manual_seed(r.seed if r.seed is not None else secrets.randbelow(2**31)),
            callback_on_step_end=on_step,
        )
        if refs:
            args["image"] = refs
        with torch.inference_mode():
            pipe(**args).images[0].save(path)
        return path

    def picture_tool(self, job: Job) -> str:
        """Upscale (Real-ESRGAN x4, tiled) or cut out the subject (BiRefNet through rembg) of images[0]."""
        r = job.req
        os.makedirs(OUT_DIR, exist_ok=True)
        path = os.path.join(OUT_DIR, f"{job.id}.png")
        img = read_picture(r.images[0])
        if r.op == "remove-bg":
            if TINY:
                # No real weights in tests: the left half is kept, the right half is see-through.
                out = img.convert("RGBA")
                out.paste((0, 0, 0, 0), (out.width // 2, 0, out.width, out.height))
            else:
                from rembg import new_session, remove

                if self.cutout is None:
                    self.cutout = new_session("birefnet-general")
                out = remove(img, session=self.cutout)
            out.save(path)
            return path
        # Upscale: at most 4096 px on the long side; a bigger picture is shrunk first so x4 lands there.
        target = min(4096, max(img.size) * r.scale)
        src = img if max(img.size) * 4 <= target * 1.001 else img.resize((max(1, round(img.width * target / max(img.size) / 4)), max(1, round(img.height * target / max(img.size) / 4))), Image.LANCZOS)
        if TINY:
            up = src.resize((src.width * 4, src.height * 4), Image.LANCZOS)
        else:
            up = self.upscale4(src, job)
        if max(up.size) != target:
            up = up.resize((round(up.width * target / max(up.size)), round(up.height * target / max(up.size))), Image.LANCZOS)
        up.save(path)
        return path

    def upscale4(self, img: Image.Image, job: Job) -> Image.Image:
        """Real-ESRGAN x4plus over 256 px tiles (16 px overlap), so any picture fits in memory."""
        import numpy as np

        if self.upscaler is None:
            import spandrel

            weights = os.path.join(os.environ.get("HF_HOME", tempfile.gettempdir()), "realesrgan", "RealESRGAN_x4plus.pth")
            if not os.path.exists(weights):
                import urllib.request

                os.makedirs(os.path.dirname(weights), exist_ok=True)
                urllib.request.urlretrieve(UPSCALER, weights + ".part")
                os.replace(weights + ".part", weights)
            self.upscaler = spandrel.ModelLoader().load_from_file(weights).model.eval().to(self.device).half() if self.device == "cuda" else spandrel.ModelLoader().load_from_file(weights).model.eval()
        x = torch.from_numpy(np.asarray(img.convert("RGB"), dtype=np.float32) / 255).permute(2, 0, 1)[None]
        _, _, h, w = x.shape
        out = torch.zeros(1, 3, h * 4, w * 4)
        tile, pad = 256, 16
        tiles = [(y, x0) for y in range(0, h, tile) for x0 in range(0, w, tile)]
        for i, (y, x0) in enumerate(tiles):
            y1, x1 = min(h, y + tile), min(w, x0 + tile)
            ya, xa, yb, xb = max(0, y - pad), max(0, x0 - pad), min(h, y1 + pad), min(w, x1 + pad)
            part = x[:, :, ya:yb, xa:xb].to(self.device)
            with torch.inference_mode():
                res = self.upscaler(part.half() if self.device == "cuda" else part).float().cpu()
            out[:, :, y * 4:y1 * 4, x0 * 4:x1 * 4] = res[:, :, (y - ya) * 4:(y - ya + y1 - y) * 4, (x0 - xa) * 4:(x0 - xa + x1 - x0) * 4]
            job.progress = (i + 1) / len(tiles)
        arr = (out[0].clamp(0, 1).permute(1, 2, 0).numpy() * 255).round().astype("uint8")
        return Image.fromarray(arr)

    def edit_video(self, job: Job) -> str:
        """Changes a clip with Wan 2.1 VACE: restyle, relight, motion transfer, new background or inpaint."""
        import imageio_ffmpeg
        from diffusers.utils import export_to_video

        r: EditRequest = job.req
        width, height = (32, 32) if TINY else VACE_SIZES.get(r.aspect, VACE_SIZES["16:9"])
        n = 9 if TINY else min(VACE_FRAMES, 4 * round(r.seconds * VACE_FPS / 4) + 1)
        src = os.path.join(OUT_DIR, f"{job.id}-src.mp4")
        os.makedirs(OUT_DIR, exist_ok=True)
        with open(src, "wb") as f:
            f.write(base64.b64decode(r.video.split(",", 1)[-1]))
        # Decoded by ffmpeg in its own process (no decoder threads inside the server), only as far as needed.
        reader = imageio_ffmpeg.read_frames(src)
        meta = next(reader)
        fps = float(meta.get("fps") or 24)
        need = int((n - 1) * fps / VACE_FPS) + 1
        raw = []
        try:
            for buf in reader:
                raw.append(Image.frombytes("RGB", meta["size"], buf))
                if len(raw) >= need:
                    break
        finally:
            reader.close()
            os.remove(src)
        if not raw:
            raise ValueError("The clip has no frames.")
        # Resample to the model's 16 fps and fit the frame size (cropping the edges, not stretching).
        frames = [ImageOps.fit(raw[min(len(raw) - 1, int(i * fps / VACE_FPS))], (width, height), Image.LANCZOS) for i in range(n)]
        white = Image.new("L", (width, height), 255)
        refs = [ImageOps.fit(read_picture(r.image), (width, height), Image.LANCZOS)] if r.image else None
        if r.task in ("restyle", "relight", "motion"):
            control = self.depth_frames(frames)
            masks = [white] * n
        elif r.task == "background":
            subject = self.subject_masks(frames)  # white = the person or thing to keep
            masks = [ImageOps.invert(m) for m in subject]
            control = [Image.composite(f, Image.new("RGB", (width, height), (127, 127, 127)), m) for f, m in zip(frames, subject)]
        else:
            x, y, w, h = r.box or [0.25, 0.25, 0.5, 0.5]
            box = Image.new("L", (width, height), 0)
            box.paste(255, (round(x * width), round(y * height), round((x + w) * width), round((y + h) * height)))
            masks = [box] * n
            control = [Image.composite(Image.new("RGB", (width, height), (127, 127, 127)), f, box) for f in frames]
        path = os.path.join(OUT_DIR, f"{job.id}.mp4")
        if TINY:
            # No real weights in tests: the conditioning frames themselves, so the plumbing can be checked.
            export_to_video(control, path, fps=VACE_FPS)
            return path
        if self.vace is None:
            from diffusers import AutoencoderKLWan, WanVACEPipeline

            log.info("First video edit: loading %s", VACE)
            vae = AutoencoderKLWan.from_pretrained(VACE, subfolder="vae", torch_dtype=torch.float32)
            self.vace = WanVACEPipeline.from_pretrained(VACE, vae=vae, torch_dtype=self.dtype)
            self.vace.enable_model_cpu_offload()  # shares the GPU with the other models
        steps = r.steps or 30

        def on_step(_pipe, i, _t, kwargs):
            job.progress = min(0.99, (i + 1) / steps)
            return kwargs

        with torch.inference_mode():
            video = self.vace(
                prompt=r.prompt,
                negative_prompt=r.negative_prompt or NEGATIVE,
                video=control,
                mask=masks,
                reference_images=refs,
                height=height,
                width=width,
                num_frames=n,
                num_inference_steps=steps,
                guidance_scale=5.0,
                generator=torch.Generator(device="cpu").manual_seed(r.seed if r.seed is not None else secrets.randbelow(2**31)),
                callback_on_step_end=on_step,
            ).frames[0]
        export_to_video(video, path, fps=VACE_FPS)
        return path

    def depth_frames(self, frames: list) -> list:
        """Each frame's depth as a grey picture (Depth Anything V2 Small): the shapes and motion VACE keeps."""
        if TINY:
            return [ImageOps.invert(f) for f in frames]
        from transformers import pipeline

        if self.depth is None:
            self.depth = pipeline("depth-estimation", model=DEPTH, device=0 if self.device == "cuda" else -1)
        return [d["depth"].convert("RGB").resize(f.size) for d, f in zip(self.depth(frames), frames)]

    def subject_masks(self, frames: list) -> list:
        """White where the main subject is, in every frame (BiRefNet through rembg)."""
        if TINY:
            w, h = frames[0].size
            m = Image.new("L", (w, h), 0)
            m.paste(255, (w // 4, h // 4, 3 * w // 4, h))
            return [m] * len(frames)
        from rembg import new_session, remove

        if self.cutout is None:
            self.cutout = new_session("birefnet-general")
        return [remove(f, session=self.cutout, only_mask=True).convert("L") for f in frames]

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


def read_picture(b64: str) -> Image.Image:
    try:
        raw = base64.b64decode(b64.split(",", 1)[-1], validate=False)
        return ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"A picture couldn't be read: {e}") from e


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
        "text_model_writer": WRITER if WRITING else None,
        "image_model": T2I,
        "edit_model": EDIT,
        "image_aspects": list(IMAGE_SIZES),
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


@app.post("/v1/images", dependencies=[Depends(authorised)])
def create_image(req: ImageRequest) -> dict:
    if req.aspect not in IMAGE_SIZES:
        raise HTTPException(400, f"aspect must be one of {', '.join(IMAGE_SIZES)}")
    if req.op == "generate" and not req.prompt.strip():
        raise HTTPException(400, "Describe the picture.")
    if req.op != "generate" and len(req.images) != 1:
        raise HTTPException(400, "Picture tools take exactly one picture.")
    for b in req.images:
        read_picture(b)  # reject an unreadable picture now, not minutes later
    job = engine.submit(req)
    return {"id": job.id, "status": job.status}


@app.get("/v1/images/{job_id}", dependencies=[Depends(authorised)])
def image_status(job_id: str) -> dict:
    return status(job_id)


@app.get("/v1/images/{job_id}/file", dependencies=[Depends(authorised)])
def image_file(job_id: str) -> FileResponse:
    job = engine.jobs.get(job_id)
    if not job or job.status != "succeeded" or not job.file or not isinstance(job.req, ImageRequest):
        raise HTTPException(404, "The picture isn't ready.")
    return FileResponse(job.file, media_type="image/png", filename=f"{job_id}.png")


@app.post("/v1/video-edits", dependencies=[Depends(authorised)])
def create_edit(req: EditRequest) -> dict:
    if engine.load_error:
        raise HTTPException(503, f"The model couldn't load: {engine.load_error}")
    if req.task == "motion" and not req.image:
        raise HTTPException(400, "Motion control needs a picture of who (or what) performs the motion.")
    if req.image:
        read_picture(req.image)
    if len(req.video) < 100:
        raise HTTPException(400, "The clip is empty.")
    job = engine.submit(req)
    return {"id": job.id, "status": job.status}


@app.get("/v1/video-edits/{job_id}", dependencies=[Depends(authorised)])
def edit_status(job_id: str) -> dict:
    return status(job_id)


@app.get("/v1/video-edits/{job_id}/file", dependencies=[Depends(authorised)])
def edit_file(job_id: str) -> FileResponse:
    job = engine.jobs.get(job_id)
    if not job or job.status != "succeeded" or not job.file or not isinstance(job.req, EditRequest):
        raise HTTPException(404, "The clip isn't ready.")
    return FileResponse(job.file, media_type="video/mp4", filename=f"{job_id}.mp4")


@app.post("/v1/chat", dependencies=[Depends(authorised)])
def chat(req: ChatRequest) -> dict:
    if not WRITING:
        raise HTTPException(503, "Writing is switched off on this engine (ENGINE_TEXT=off).")
    try:
        return {"text": writer.write(req), "model": WRITER}
    except Exception as e:  # noqa: BLE001
        log.exception("Writing failed")
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        raise HTTPException(500, f"{type(e).__name__}: {e}"[:500]) from e


async def forward(request: Request, url: str, what: str) -> Response:
    """Passes a call through to a side service on this server (its own Python environment), with the same token."""
    import urllib.error
    import urllib.request

    data = await request.body() if request.method == "POST" else None
    req = urllib.request.Request(url, data=data, method=request.method,
                                 headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:  # noqa: S310 - our own side service
            return Response(r.read(), status_code=r.status, media_type=r.headers.get("Content-Type"))
    except urllib.error.HTTPError as e:
        return Response(e.read(), status_code=e.code, media_type=e.headers.get("Content-Type"))
    except OSError as e:
        raise HTTPException(503, f"The {what} isn't running on this server ({e}). start.sh starts it beside the video engine.") from e


@app.api_route("/v1/audio", methods=["POST"], dependencies=[Depends(authorised)])
@app.api_route("/v1/audio/{rest:path}", methods=["GET"], dependencies=[Depends(authorised)])
async def audio(request: Request, rest: str = "") -> Response:
    """Music and sound effects: audio_server.py."""
    return await forward(request, f"{AUDIO_URL}/v1/audio" + (f"/{rest}" if rest else ""), "audio engine")


@app.api_route("/v1/speech", methods=["POST"], dependencies=[Depends(authorised)])
@app.api_route("/v1/speech/{rest:path}", methods=["GET"], dependencies=[Depends(authorised)])
async def speech(request: Request, rest: str = "") -> Response:
    """Voices in 23 languages, voice cloning, voice-to-voice: speech_server.py."""
    return await forward(request, f"{SPEECH_URL}/v1/speech" + (f"/{rest}" if rest else ""), "speech engine")


@app.api_route("/v1/lipsync", methods=["POST"], dependencies=[Depends(authorised)])
@app.api_route("/v1/lipsync/{rest:path}", methods=["GET"], dependencies=[Depends(authorised)])
async def lipsync(request: Request, rest: str = "") -> Response:
    """Lip sync and talking avatars: lipsync_server.py."""
    return await forward(request, f"{LIPSYNC_URL}/v1/lipsync" + (f"/{rest}" if rest else ""), "lip-sync engine")


@app.api_route("/v1/voice-design", methods=["POST"], dependencies=[Depends(authorised)])
@app.api_route("/v1/voice-design/{rest:path}", methods=["GET"], dependencies=[Depends(authorised)])
async def voice_design(request: Request, rest: str = "") -> Response:
    """A new voice from a description: voicedesign_server.py."""
    return await forward(request, f"{VOICEDESIGN_URL}/v1/voice-design" + (f"/{rest}" if rest else ""), "voice-design engine")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
