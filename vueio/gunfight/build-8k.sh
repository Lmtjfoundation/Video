#!/usr/bin/env bash
# Builds out/ghost-post-8k.mp4: native 7680x4320, 30 fps, 10-bit HEVC with AAC audio.
# Every frame is redrawn at 8K (not upscaled). Frames render in parallel workers, each
# encoding its own segment; the segments are then joined without re-encoding.
set -euo pipefail
cd "$(dirname "$0")"
WORKERS="${WORKERS:-3}"
mkdir -p out/seg
python3 audio.py out/audio.wav
TOTAL=$(python3 -c "import json;c=json.load(open('cues.json'));print(round(c['duration']*c['fps']))")
CHUNK=$(( (TOTAL + WORKERS - 1) / WORKERS ))
pids=()
: > out/seg/list.txt
for ((w=0; w<WORKERS; w++)); do
  a=$(( w * CHUNK )); b=$(( a + CHUNK )); (( b > TOTAL )) && b=$TOTAL
  node render.cjs "out/seg/seg$w.mp4" --scale 4 --range "$a:$b" &
  pids+=($!)
  echo "file 'seg$w.mp4'" >> out/seg/list.txt
done
for p in "${pids[@]}"; do wait "$p"; done
ffmpeg -y -loglevel error -f concat -safe 0 -i out/seg/list.txt -i out/audio.wav \
  -map 0:v -map 1:a -c:v copy -tag:v hvc1 \
  -af "volume=3.4dB,alimiter=limit=0.89:level=false" -c:a aac -b:a 320k -ar 48000 \
  -movflags +faststart -shortest out/ghost-post-8k.mp4
rm -rf out/seg out/audio.wav
echo "Built out/ghost-post-8k.mp4"
