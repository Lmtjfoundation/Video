"""
Vueio's GPU engine on Modal (serverless GPUs): the same container as Dockerfile (video, pictures, voices, music and
lip sync), started only when Vueio sends work and stopped after it sits idle, so it bills by the second while working.

One-time setup, from a computer with Python (or a Claude session that has MODAL_TOKEN_ID / MODAL_TOKEN_SECRET):

    pip install modal
    modal token new                                   # or set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET
    modal secret create vueio-engine ENGINE_TOKEN=<a long random password>
    modal deploy engine/modal_app.py

It prints the address (https://<workspace>--vueio-engine-engine.modal.run). In Vueio: Admin -> Integrations ->
Video Engine (GPU), paste that address and the same ENGINE_TOKEN, then Save & test. The first start downloads the
models into a Modal Volume (about 126 GB for "best"), so it takes a while once; later starts reuse them.

Settings (environment variables when deploying):
    VUEIO_GPU          Modal GPU type, default "H100" (80 GB: Wan 2.2 A14B "best"). "L40S" (48 GB) suits ENGINE_QUALITY=fast.
    ENGINE_QUALITY     "best" (default) or "fast", passed to the engine.
    VUEIO_IDLE_MINUTES Minutes with no requests before the GPU stops (default 15).
"""
import os
import subprocess
from pathlib import Path

import modal

HERE = Path(__file__).parent
GPU = os.environ.get("VUEIO_GPU", "H100")
QUALITY = os.environ.get("ENGINE_QUALITY", "best")
IDLE_MINUTES = int(os.environ.get("VUEIO_IDLE_MINUTES", "15"))

app = modal.App("vueio-engine")
image = modal.Image.from_dockerfile(HERE / "Dockerfile", context_dir=HERE).env({"ENGINE_QUALITY": QUALITY, "PORT": "8000"})
models = modal.Volume.from_name("vueio-engine-hf", create_if_missing=True)

# The engine keeps its jobs in memory, so all work goes to one container at a time (max_containers=1), which answers
# many requests at once.
ENGINE_CMD = (
    ".audio-venv/bin/python audio_server.py & .speech-venv/bin/python speech_server.py & "
    ".lipsync-venv/bin/python lipsync_server.py & .design-venv/bin/python voicedesign_server.py & exec python server.py"
)


@app.function(
    image=image,
    gpu=GPU,
    volumes={"/workspace/hf": models},
    secrets=[modal.Secret.from_name("vueio-engine")],
    timeout=24 * 3600,
    scaledown_window=IDLE_MINUTES * 60,
    min_containers=0,
    max_containers=1,
)
@modal.concurrent(max_inputs=100)
@modal.web_server(port=8000, startup_timeout=60 * 60)
def engine():
    subprocess.Popen(["sh", "-c", ENGINE_CMD], cwd="/app")
