#!/usr/bin/env bash
# Starts the Ghost Post engine on a GPU host (see README.md): the side services (music and sound effects on 8001,
# speech on 8002, lip sync on 8003, each in its own environment) and the video engine on $PORT (8000), which answers
# for all of them.
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
# Speech (voices, cloning, dubbing) and lip sync, each in its own environment (set up once by setup-sidecars.sh).
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
PATH="$HOME/.local/bin:$PATH" ./setup-sidecars.sh
.speech-venv/bin/python speech_server.py &
.lipsync-venv/bin/python lipsync_server.py &
exec python server.py
