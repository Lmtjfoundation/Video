#!/bin/bash
# Post-processing chain (runs in the postfx container). In place of Azure Media Services, which Microsoft retired
# on 30 June 2024, it does the same jobs with ffmpeg: temporal smoothing, motion blur, grade, encode and packaging.
#   postfx.sh RAW.mp4 OUT_DIR GRADE [ACCENT]
# GRADE: teal_orange (default) or mono_accent (black and white with one hue kept, e.g. ACCENT=orange)
#   - motion-compensated interpolation to 48 fps, then a 2-frame blend back to 24 fps: real motion blur
#   - deflicker + temporal-only denoise: temporal consistency, nothing pops or crawls
#   - Lanczos upscale to 1080x1920 with a light sharpen
#   - grade, vignette, fine film grain
#   - H.264 High, 24 fps, fast start (final.mp4) + HLS adaptive packaging (hls/index.m3u8, 2 s segments)
set -euo pipefail
RAW=$1; OUT=$2; GRADE=${3:-teal_orange}; ACCENT=${4:-orange}
mkdir -p "$OUT/hls"
if [ "$GRADE" = "mono_accent" ]; then
  LOOK="colorhold=color=$ACCENT:similarity=0.22:blend=0.12,eq=contrast=1.14:gamma=0.98"
else
  LOOK="eq=contrast=1.08:saturation=1.06:gamma=1.04,colorbalance=rs=-0.05:gs=-0.01:bs=0.07:rh=0.07:gh=0.01:bh=-0.06"
fi
VF="minterpolate=fps=48:mi_mode=mci:mc_mode=aobmc:vsbmc=1,tmix=frames=2:weights=1 1,fps=24,deflicker=size=5:mode=pm,hqdn3d=0:0:3:3,scale=1080:1920:flags=lanczos,unsharp=5:5:0.7:5:5:0,$LOOK,vignette=PI/5,noise=alls=4:allf=t,format=yuv420p"
ffmpeg -v error -y -i "$RAW" -vf "$VF" -r 24 -an -c:v libx264 -profile:v high -preset slow -crf 17 -movflags +faststart "$OUT/final.mp4"
ffmpeg -v error -y -i "$OUT/final.mp4" -c copy -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_filename "$OUT/hls/seg%03d.ts" "$OUT/hls/index.m3u8"
echo "postfx ok"
