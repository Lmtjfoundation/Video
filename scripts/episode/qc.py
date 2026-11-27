"""Episode Studio clip check: does a generated shot actually move, and does it hold together to the end?

    python3 qc.py clip.mp4 [still.png]

Prints one JSON object:
  motion     median optical-flow magnitude per frame (px at 240 px wide): under ~0.045 the shot reads as a still picture
  sharpEnd   sharpness of the last eighth relative to the first eighth, centre of frame: a face that melts, smears or
             spins into a blur drops well below 1 (fast dancing also lowers it, so only a severe drop counts)
  jump       the largest frame-to-frame change relative to the median one: a glitch or a cut inside the clip
  drift      how far the last frame is from the still it started from (0-255 mean difference)
  verdict    "ok", or "frozen" (film it again); the other numbers are hints for the visual check
These thresholds were set on real clips from Vueio's engine (Wan 2.2) during Second Line episode 1.
"""
import json
import sys

import cv2
import numpy as np

path = sys.argv[1]
cap = cv2.VideoCapture(path)
frames = []
while True:
    ok, f = cap.read()
    if not ok:
        break
    frames.append(cv2.resize(f, (240, 416) if f.shape[0] >= f.shape[1] else (416, 240)))
cap.release()
if len(frames) < 3:
    print(json.dumps({"frames": len(frames), "verdict": "broken"}))
    sys.exit(0)
g = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in frames]
mags, jumps = [], []
for a, b in zip(g, g[1:]):
    flow = cv2.calcOpticalFlowFarneback(a, b, None, 0.5, 3, 15, 3, 5, 1.2, 0)
    mags.append(float(np.median(np.linalg.norm(flow, axis=2))))
    jumps.append(float(np.mean(np.abs(a.astype(np.float32) - b.astype(np.float32)))))
jumps = np.array(jumps)
jump = float(jumps.max() / (np.median(jumps) + 1e-3))
h, w = g[0].shape
sh = np.array([cv2.Laplacian(x[h // 5:h * 4 // 5, w // 6:w * 5 // 6], cv2.CV_64F).var() for x in g])
k = max(1, len(sh) // 8)
sharp_end = float(sh[-k:].mean() / max(sh[:k].mean(), 1e-6))
motion = float(np.mean(mags))
drift = None
if len(sys.argv) > 2:
    still = cv2.imread(sys.argv[2])
    if still is not None:
        still = cv2.resize(still, (frames[-1].shape[1], frames[-1].shape[0])).astype(np.float32)
        drift = float(np.mean(np.abs(still - frames[-1].astype(np.float32))))
# Only a frozen shot is rejected on numbers alone: a sharpness drop or a big jump also happens in good shots (a face
# walking into close-up, a flashlight sweep, a camera pushing into a crowd), so those go to the visual check instead.
# Calibrated on Second Line episode 1's 42 clips: the three that read as still pictures measured 0.02-0.03 here; the
# calmest good ones (quiet close-ups, a slow aerial drift) 0.06 and up.
verdict = "frozen" if motion < 0.045 else "ok"
print(json.dumps({"frames": len(frames), "motion": round(motion, 3), "sharpEnd": round(sharp_end, 3), "jump": round(jump, 1), "drift": None if drift is None else round(drift, 1), "verdict": verdict}))
