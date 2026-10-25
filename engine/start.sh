#!/usr/bin/env bash
# Starts the Ghost Post engine on a GPU host (see README.md): the audio engine (music and sound effects, its own
# environment in .audio-venv, on 127.0.0.1:8001) and the video engine on $PORT (8000), which also answers /v1/audio.
set -euo pipefail
cd "$(dirname "$0")"
export HF_HOME="${HF_HOME:-/workspace/hf}" HF_HUB_ENABLE_HF_TRANSFER=1
python -m pip install --no-cache-dir -q -r requirements.txt
[ -d vendor/MOSS-TTS ] || { git clone -q https://github.com/OpenMOSS/MOSS-TTS vendor/MOSS-TTS && git -C vendor/MOSS-TTS checkout -q 934d6826b084c46a0d033402174d5f8ac4ed2519; }
if [ ! -x .audio-venv/bin/python ]; then
  python -m venv --system-site-packages .audio-venv  # reuses the host's CUDA torch
fi
.audio-venv/bin/pip install --no-cache-dir -q -r requirements-audio.txt
.audio-venv/bin/pip install --no-cache-dir -q --no-deps -r requirements-audio-nodeps.txt
.audio-venv/bin/python audio_server.py &
exec python server.py
