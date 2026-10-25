"""
Ghost Post Audio Engine — the app's own music and sound-effect models, so Ghost Post's Music, Sound Effects and Library
need no other company's credits. Runs beside the video engine on the same GPU server, in its own Python environment
(the audio models pin older transformers than the video models), and is reached through the video engine's address:
server.py forwards /v1/audio to it, so the app still has one address and one token.

  Music          ACE-Step 1.5 turbo (MIT; the model card allows commercial use of the music it makes):
                 songs or instrumentals from a description (and optional lyrics), 10 s to 4 min, 48 kHz stereo.
  Sound effects  MOSS-SoundEffect v2 (Apache 2.0): any sound from a description, up to 30 s, 48 kHz.

Each loads the first time it is asked for (ACE-Step about 10 GB, MOSS about 11 GB) and both fit beside the video model's
offloading on an 80 GB GPU; on a 24 GB card they share the GPU in turn.

API (Bearer ENGINE_TOKEN, as the video engine):
  POST /v1/audio            {"kind": "music"|"sfx", "prompt", "lyrics"?, "instrumental"?, "seconds", "bpm"?, "key"?, "seed"?}
                            -> {"id", "status"}
  GET  /v1/audio/{id}       -> {"status": queued|running|succeeded|failed, "progress", "error"?, "bpm"?, "key"?}
  GET  /v1/audio/{id}/file  -> the WAV (48 kHz)
ENGINE_MODEL=tiny makes tones instead of loading the models, for tests.
"""

from __future__ import annotations

import logging
import math
import os
import queue
import secrets
import sys
import tempfile
import threading
import time
import uuid
import wave
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

log = logging.getLogger("audio")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

TINY = os.environ.get("ENGINE_MODEL", "") in ("tiny", "tiny-best")
TOKEN = os.environ.get("ENGINE_TOKEN") or ""
if not TOKEN:
    TOKEN = secrets.token_urlsafe(24)
    log.warning("ENGINE_TOKEN is not set; using a one-time token for this run: %s", TOKEN)
OUT_DIR = os.environ.get("ENGINE_AUDIO_OUT") or os.path.join(tempfile.gettempdir(), "ghost-post-audio")
KEEP_SECONDS = 3 * 3600
SR = 48000
SFX_MODEL = os.environ.get("ENGINE_SFX_MODEL", "OpenMOSS-Team/MOSS-SoundEffect-v2.0")
# The MOSS code isn't a pip package: setup clones it here (see requirements-audio.txt).
MOSS_SRC = os.environ.get("ENGINE_MOSS_SRC", os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor", "MOSS-TTS"))
ACE_DIR = os.environ.get("ENGINE_ACE_DIR", os.path.join(os.environ.get("HF_HOME", tempfile.gettempdir()), "ace-step"))
LIMITS = {"music": (10.0, 240.0), "sfx": (0.5, 30.0)}


class AudioRequest(BaseModel):
    kind: str = Field(pattern="^(music|sfx)$")
    prompt: str = Field(min_length=1, max_length=500)
    lyrics: str = Field(default="", max_length=4000)
    instrumental: bool = True
    seconds: float = Field(default=30, gt=0, le=240)
    bpm: int | None = Field(default=None, ge=30, le=300)
    key: str | None = Field(default=None, max_length=12)
    seed: int | None = None


@dataclass
class Job:
    id: str
    req: AudioRequest
    status: str = "queued"
    progress: float = 0.0
    error: str | None = None
    file: str | None = None
    meta: dict = field(default_factory=dict)
    created: float = field(default_factory=time.time)


def write_wav(path: str, data) -> None:
    """16-bit stereo WAV from a float array shaped (channels, samples) in -1..1."""
    import numpy as np

    x = np.asarray(data, dtype=np.float32)
    if x.ndim == 1:
        x = np.stack([x, x])
    x = np.clip(x[:2].T, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())


class Audio:
    def __init__(self) -> None:
        import torch

        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.music = None  # ACE-Step DiT handler
        self.sfx = None  # MOSS pipeline
        self.jobs: dict[str, Job] = {}
        self.q: queue.Queue[str] = queue.Queue()
        self.lock = threading.Lock()

    def submit(self, req: AudioRequest) -> Job:
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
            job.status = "running"
            try:
                os.makedirs(OUT_DIR, exist_ok=True)
                job.file = os.path.join(OUT_DIR, f"{job.id}.wav")
                if TINY:
                    self.tone(job)
                elif job.req.kind == "music":
                    self.make_music(job)
                else:
                    self.make_sfx(job)
                job.status, job.progress = "succeeded", 1.0
            except Exception as e:  # noqa: BLE001
                log.exception("Audio job %s failed", job.id)
                job.status, job.error = "failed", f"{type(e).__name__}: {e}"[:500]
                self.free_gpu()
            self.cleanup()

    def tone(self, job: Job) -> None:
        """No real weights in tests: a tone whose pitch depends on the prompt, at the asked length."""
        import numpy as np

        r = job.req
        n = int(SR * min(r.seconds, 12))
        f = 220 + sum(map(ord, r.prompt)) % 440
        t = np.arange(n) / SR
        x = 0.3 * np.sin(2 * math.pi * f * t) * np.minimum(1, np.minimum(t, t[::-1]) * 20)
        write_wav(job.file, data=x)
        job.meta = {"bpm": r.bpm or (120 if r.kind == "music" else None), "key": r.key or ("C major" if r.kind == "music" else None)}

    def make_music(self, job: Job) -> None:
        import torch
        from acestep.handler import AceStepHandler
        from acestep.inference import GenerationConfig, GenerationParams, generate_music

        r = job.req
        if self.music is None:
            log.info("First music request: loading ACE-Step 1.5 turbo")
            os.makedirs(ACE_DIR, exist_ok=True)
            handler = AceStepHandler()
            msg, ok = handler.initialize_service(project_root=ACE_DIR, config_path="acestep-v15-turbo", device=self.device,
                                                 offload_to_cpu=self.device == "cuda")
            if not ok:
                raise RuntimeError(f"ACE-Step couldn't load: {msg}")
            self.music = handler
        lo, hi = LIMITS["music"]
        params = GenerationParams(
            caption=r.prompt, lyrics=r.lyrics if (r.lyrics and not r.instrumental) else "[Instrumental]", instrumental=r.instrumental,
            bpm=r.bpm, keyscale=r.key or "", duration=max(lo, min(hi, r.seconds)), inference_steps=8, thinking=False,
            seed=r.seed if r.seed is not None else -1,
        )
        config = GenerationConfig(batch_size=1, audio_format="wav", use_random_seed=r.seed is None)
        job.progress = 0.1
        with torch.inference_mode():
            res = generate_music(self.music, None, params, config, save_dir=OUT_DIR)
        if not res.success or not res.audios:
            raise RuntimeError(res.error or "ACE-Step returned no audio")
        a = res.audios[0]
        write_wav(job.file, data=a["tensor"].float().cpu().numpy())
        p = a.get("params") or {}
        job.meta = {"bpm": p.get("bpm") or r.bpm, "key": p.get("keyscale") or r.key}
        if a.get("path") and os.path.exists(a["path"]):
            os.remove(a["path"])

    def make_sfx(self, job: Job) -> None:
        import torch

        r = job.req
        if self.sfx is None:
            os.environ.setdefault("TORCHDYNAMO_DISABLE", "1")
            sys.path.insert(0, MOSS_SRC)
            from moss_soundeffect_v2 import MossSoundEffectPipeline

            log.info("First sound effect: loading %s", SFX_MODEL)
            self.sfx = MossSoundEffectPipeline.from_pretrained(SFX_MODEL, torch_dtype=torch.bfloat16, device=self.device)
        lo, hi = LIMITS["sfx"]
        secs = max(lo, min(hi, r.seconds))
        job.progress = 0.1
        with torch.inference_mode():
            audio = self.sfx(prompt=r.prompt, seconds=secs, num_inference_steps=100 if self.device == "cuda" else 40, cfg_scale=4.0,
                             sigma_shift=5.0, seed=r.seed if r.seed is not None else secrets.randbelow(2**31),
                             max_inference_seconds=max(10, math.ceil(secs)))
        write_wav(job.file, data=audio[0].detach().float().cpu().numpy())

    def free_gpu(self) -> None:
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001
            pass

    def cleanup(self) -> None:
        cutoff = time.time() - KEEP_SECONDS
        with self.lock:
            for jid in [j.id for j in self.jobs.values() if j.created < cutoff and j.status in ("succeeded", "failed")]:
                job = self.jobs.pop(jid)
                if job.file and os.path.exists(job.file):
                    os.remove(job.file)


audio = Audio()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    os.makedirs(OUT_DIR, exist_ok=True)
    threading.Thread(target=audio.worker, daemon=True).start()
    yield


app = FastAPI(title="Ghost Post Audio Engine", version="1.0", lifespan=lifespan)


def authorised(authorization: str = Header(default="")) -> None:
    if not secrets.compare_digest(authorization, f"Bearer {TOKEN}"):
        raise HTTPException(401, "Wrong or missing engine token.")


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/v1/audio/info", dependencies=[Depends(authorised)])
def info() -> dict:
    return {
        "engine": "Ghost Post Audio Engine",
        "music_model": "ACE-Step 1.5 turbo",
        "sfx_model": SFX_MODEL,
        "device": audio.device,
        "loaded": {"music": audio.music is not None, "sfx": audio.sfx is not None},
        "queue": audio.q.qsize(),
        "limits": {k: {"min": v[0], "max": v[1]} for k, v in LIMITS.items()},
    }


@app.post("/v1/audio", dependencies=[Depends(authorised)])
def create(req: AudioRequest) -> dict:
    lo, hi = LIMITS[req.kind]
    if req.seconds > hi:
        raise HTTPException(400, f"{'Music' if req.kind == 'music' else 'Sound effects'} can be up to {hi:g} seconds.")
    job = audio.submit(req)
    return {"id": job.id, "status": job.status}


@app.get("/v1/audio/{job_id}", dependencies=[Depends(authorised)])
def status(job_id: str) -> dict:
    job = audio.jobs.get(job_id)
    if not job:
        raise HTTPException(404, "No such job (finished audio is kept for 3 hours).")
    return {"id": job.id, "status": job.status, "progress": round(job.progress, 3), "error": job.error, **job.meta}


@app.get("/v1/audio/{job_id}/file", dependencies=[Depends(authorised)])
def file(job_id: str) -> FileResponse:
    job = audio.jobs.get(job_id)
    if not job or job.status != "succeeded" or not job.file:
        raise HTTPException(404, "The audio isn't ready.")
    return FileResponse(job.file, media_type="audio/wav", filename=f"{job_id}.wav")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("AUDIO_PORT", "8001")))
