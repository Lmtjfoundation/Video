#!/usr/bin/env bash
# Builds out/ghost-post.mp4: synthesizes the soundtrack, renders every frame, then muxes.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out
python3 audio.py out/audio.wav
node render.cjs out/video.mp4
# Bring the cinematic mix up to streaming loudness with a true-peak-safe limiter.
ffmpeg -y -loglevel error -i out/video.mp4 -i out/audio.wav \
  -map 0:v -map 1:a -c:v copy \
  -af "volume=3.4dB,alimiter=limit=0.89:level=false" -c:a aac -b:a 256k -ar 48000 \
  -movflags +faststart -shortest out/ghost-post.mp4
rm -f out/video.mp4 out/audio.wav
echo "Built out/ghost-post.mp4"
