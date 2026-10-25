#!/usr/bin/env bash
# Sets up the speech and lip-sync side services, each in its own Python environment, next to this script:
#   .speech-venv   Chatterbox and Demucs (requirements-speech.txt)
#   .design-venv   Parler-TTS for voice design (requirements-voicedesign.txt)
#   .lipsync-venv  MuseTalk 1.5 in vendor/MuseTalk (Python 3.10, PyTorch 2.0.1, its pinned packages and weights)
# Safe to run again: finished steps are skipped. Needs uv (https://astral.sh/uv), git, curl and ffmpeg.
set -euo pipefail
cd "$(dirname "$0")"
export HF_HUB_ENABLE_HF_TRANSFER=0
MUSETALK_COMMIT=0a89dec45a0192b824e3cf4daf96c239440c5ed8

if [ ! -x .speech-venv/bin/python ]; then uv venv -q --seed --python 3.12 .speech-venv; fi
.speech-venv/bin/pip install -q -r requirements-speech.txt

if [ ! -x .design-venv/bin/python ]; then uv venv -q --seed --python 3.12 .design-venv; fi
.design-venv/bin/pip install -q -r requirements-voicedesign.txt

if [ ! -d vendor/MuseTalk ]; then
  git clone -q https://github.com/TMElyralab/MuseTalk vendor/MuseTalk
  git -C vendor/MuseTalk checkout -q "$MUSETALK_COMMIT"
fi
if [ ! -x .lipsync-venv/bin/python ]; then uv venv -q --seed --python 3.10 .lipsync-venv; fi
L=.lipsync-venv/bin
if [ ! -f .lipsync-venv/.ready ]; then
  $L/pip install -q torch==2.0.1 torchvision==0.15.2 torchaudio==2.0.2 --index-url https://download.pytorch.org/whl/cu118
  $L/pip install -q -r vendor/MuseTalk/requirements.txt fastapi==0.115.6 uvicorn==0.34.0 "huggingface_hub[cli]==0.30.2" openmim
  $L/mim install -q mmengine "mmcv==2.0.1" "mmdet==3.1.0" "mmpose==1.1.0"
  touch .lipsync-venv/.ready
fi
M=vendor/MuseTalk/models
if [ ! -f "$M/musetalkV15/unet.pth" ]; then
  mkdir -p $M/musetalkV15 $M/syncnet $M/dwpose $M/face-parse-bisent $M/sd-vae $M/whisper
  H=$L/huggingface-cli
  $H download TMElyralab/MuseTalk --local-dir $M --include "musetalkV15/musetalk.json" "musetalkV15/unet.pth" "musetalk/musetalk.json" "musetalk/pytorch_model.bin"
  $H download stabilityai/sd-vae-ft-mse --local-dir $M/sd-vae --include config.json diffusion_pytorch_model.bin
  $H download openai/whisper-tiny --local-dir $M/whisper --include config.json pytorch_model.bin preprocessor_config.json
  $H download yzd-v/DWPose --local-dir $M/dwpose --include dw-ll_ucoco_384.pth
  $H download ByteDance/LatentSync --local-dir $M/syncnet --include latentsync_syncnet.pt
  $L/pip install -q gdown
  $L/gdown -q --id 154JgKpzCPW82qINcVieuPH3fZ2e0P812 -O $M/face-parse-bisent/79999_iter.pth
  curl -sL https://download.pytorch.org/models/resnet18-5c106cde.pth -o $M/face-parse-bisent/resnet18-5c106cde.pth
fi
echo "side services ready"
