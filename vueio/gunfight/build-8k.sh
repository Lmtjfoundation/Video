#!/usr/bin/env bash
# Builds out/ghost-post-8k.mp4: native 7680x4320, 30 fps, 10-bit HEVC with AAC audio.
# Every frame is redrawn at 8K (not upscaled).
#   Stage 1: parallel browser workers draw 8K frames to disk. Resumable: re-running skips
#            frames already written, so an interruption costs only the frames in flight.
#   Stage 2: one memory-bounded HEVC encode (an 8K HEVC encoder needs ~5 GB of RAM, so
#            encoding runs alone, after drawing, never alongside it).
set -euo pipefail
cd "$(dirname "$0")"
WORKERS="${WORKERS:-3}"
FR=out/frames8k
mkdir -p "$FR"
[ -f out/audio.wav ] || python3 audio.py out/audio.wav
TOTAL=$(python3 -c "import json;c=json.load(open('cues.json'));print(round(c['duration']*c['fps']))")
rm -f "$FR"/*.tmp
HAVE=$(ls "$FR" | grep -c '\.jpg$' || true)
echo "stage 1: $HAVE/$TOTAL frames already drawn"
if (( HAVE < TOTAL )); then
  CH=$(( (TOTAL + WORKERS - 1) / WORKERS ))
  for ((w=0; w<WORKERS; w++)); do
    a=$(( w * CH )); b=$(( a + CH )); (( b > TOTAL )) && b=$TOTAL
    echo "$a $b"
  done | xargs -P "$WORKERS" -L 1 bash -c 'node render.cjs --frames '"$FR"' --scale 4 --range "$0:$1"'
fi
HAVE=$(ls "$FR" | grep -c '\.jpg$' || true)
[ "$HAVE" = "$TOTAL" ] || { echo "stage 1 incomplete: $HAVE/$TOTAL frames; re-run to resume"; exit 1; }
echo "stage 2: encoding"
ffmpeg -y -loglevel error -stats -framerate 30 -i "$FR/f_%05d.jpg" -i out/audio.wav \
  -map 0:v -map 1:a \
  -c:v libx265 -preset medium -crf 17 -pix_fmt yuv420p10le -tag:v hvc1 \
  -x265-params "log-level=error:frame-threads=1:pools=4:rc-lookahead=10:bframes=3:aq-mode=3" \
  -af "aresample=192000,volume=3.4dB,alimiter=limit=0.62:attack=1:release=60:level=false,aresample=48000" \
  -c:a aac -b:a 320k -ar 48000 -movflags +faststart -shortest out/ghost-post-8k.mp4
FRAMES=$(ffprobe -v error -count_packets -select_streams v:0 -show_entries stream=nb_read_packets -of csv=p=0 out/ghost-post-8k.mp4)
[ "$FRAMES" = "$TOTAL" ] || { echo "frame count $FRAMES != $TOTAL"; exit 1; }
rm -rf "$FR" out/audio.wav
echo "Built out/ghost-post-8k.mp4 ($FRAMES frames)"
