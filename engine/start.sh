#!/usr/bin/env bash
# Starts the Ghost Post Video Engine on a GPU host (see README.md). Installs the pinned packages on top of the
# host's PyTorch, then runs the server on $PORT (8000).
set -euo pipefail
cd "$(dirname "$0")"
export HF_HOME="${HF_HOME:-/workspace/hf}" HF_HUB_ENABLE_HF_TRANSFER=1
python -m pip install --no-cache-dir -q -r requirements.txt
exec python server.py
