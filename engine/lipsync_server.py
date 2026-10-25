"""
Ghost Post Lip Sync Engine — makes the mouth in a video match new speech, for the AI Studio's Lip sync, Avatars
(a picture brought to life by the video engine, then synced to a voice) and Dubbing. Runs TME Lyra Lab's MuseTalk 1.5
(code MIT; "the trained models are available for any purpose, even commercially"; its helpers: S3FD face detection
and face-alignment, BSD; DWPose, Apache 2.0; BiSeNet face parsing, MIT; Whisper tiny, MIT; sd-vae-ft-mse, OpenRAIL-M).
A video shorter than the speech is played forwards and back until the speech ends.
Runs in its own Python 3.10 environment with MuseTalk's pinned packages (start.sh / the Azure script set it up in
vendor/MuseTalk); the video engine forwards /v1/lipsync here (LIPSYNC_URL, default http://127.0.0.1:8003).

  POST /v1/lipsync  {"video": base64 MP4, "audio": base64 WAV/MP3, "bbox_shift"?: -9..9} -> {"id"}
  GET  /v1/lipsync/{id} and /v1/lipsync/{id}/file (MP4 with the speech as its sound)
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys

from fastapi import HTTPException
from pydantic import BaseModel, Field

from sidecar import TINY, Job, create_app, decode_file

MUSETALK = os.environ.get("ENGINE_MUSETALK_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor", "MuseTalk"))


class LipsyncRequest(BaseModel):
    video: str = Field(min_length=16)
    audio: str = Field(min_length=16)
    bbox_shift: int = Field(default=0, ge=-9, le=9)


def check(r: LipsyncRequest) -> None:
    if len(r.video) > 400_000_000 or len(r.audio) > 100_000_000:
        raise HTTPException(400, "The video can be up to about 300 MB and the speech up to about 75 MB.")


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-v", "error", "-y", *args], check=True, timeout=1800)


def run(job: Job) -> str:
    r: LipsyncRequest = job.req  # type: ignore[assignment]
    video = decode_file(r.video, os.path.join(job.dir, "in.mp4"), "video")
    audio = decode_file(r.audio, os.path.join(job.dir, "in-audio"), "speech")
    speech = os.path.join(job.dir, "speech.wav")
    ffmpeg("-i", audio, "-ac", "1", "-ar", "16000", speech)
    # MuseTalk works at 25 frames a second.
    clip = os.path.join(job.dir, "clip25.mp4")
    ffmpeg("-i", video, "-an", "-r", "25", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", clip)
    out = os.path.join(job.dir, "lipsync.mp4")
    if TINY:
        # No real weights in tests: the video, looped to the speech, with the speech as its sound.
        ffmpeg("-stream_loop", "-1", "-i", clip, "-i", speech, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", out)
        return out
    cfg = os.path.join(job.dir, "task.yaml")
    with open(cfg, "w") as f:
        f.write(f'task_0:\n  video_path: "{clip}"\n  audio_path: "{speech}"\n  bbox_shift: {r.bbox_shift}\n')
    result = os.path.join(job.dir, "result")
    job.progress = 0.1
    proc = subprocess.run(
        [sys.executable, "-m", "scripts.inference", "--inference_config", cfg, "--result_dir", result, "--version", "v15",
         "--unet_model_path", "models/musetalkV15/unet.pth", "--unet_config", "models/musetalkV15/musetalk.json",
         "--output_vid_name", "out.mp4", "--ffmpeg_path", os.path.dirname(shutil.which("ffmpeg") or "/usr/bin/ffmpeg"), "--use_float16"],
        cwd=MUSETALK, capture_output=True, text=True, timeout=3 * 3600,
    )
    made = os.path.join(result, "v15", "out.mp4")
    if proc.returncode != 0 or not os.path.exists(made):
        tail = (proc.stderr or proc.stdout or "")[-400:]
        raise RuntimeError(f"MuseTalk couldn't sync this video (is there one clear face in it?): {tail}")
    # Even quality and sound for every player.
    ffmpeg("-i", made, "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out)
    return out


app = create_app("Ghost Post Lip Sync Engine", "/v1/lipsync", LipsyncRequest, run, "video/mp4", check=check,
                 info=lambda: {"model": "MuseTalk 1.5 (MIT)", "installed": os.path.isdir(os.path.join(MUSETALK, "models", "musetalkV15"))})

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("LIPSYNC_PORT", "8003")))
