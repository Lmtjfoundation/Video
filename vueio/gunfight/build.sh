#!/usr/bin/env bash
# Builds out/ghost-post.mp4: synthesizes the soundtrack, renders every frame, then muxes.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out
python3 audio.py out/audio.wav
node render.cjs out/video.mp4
# Raise the mix and limit at 4x oversampling so intersample peaks stay under -1 dBTP after AAC.
ffmpeg -y -loglevel error -i out/video.mp4 -i out/audio.wav \
  -map 0:v -map 1:a -c:v copy \
  -af "aresample=192000,volume=3.4dB,alimiter=limit=0.62:attack=1:release=60:level=false,aresample=48000" -c:a aac -b:a 256k -ar 48000 \
  -movflags +faststart -shortest out/ghost-post.mp4
rm -f out/video.mp4 out/audio.wav
echo "Built out/ghost-post.mp4"
