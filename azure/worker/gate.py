#!/usr/bin/env python3
"""
Motion quality gate: scores a clip so nothing still-like, jittery or popping reaches the timeline.

  python gate.py clip.mp4 out.json [frames_dir]

Measures dense optical flow (Farneback) between consecutive frames at a fixed working size:
  motionScore         subject motion: flow left after removing the camera's own move (a global affine fit), taken at
                      the busiest 5% of the frame, in pixels per frame at 448 px wide. A camera push over a still
                      picture scores near zero here; a person running in a wide shot does not.
  movingFrameRatio    share of frame pairs with subject motion above 0.5 px (motion that continues, not one twitch)
  cameraMotion        mean flow including the camera move
  popRatio            share of pairs whose change is more than 4x the clip's median (cuts, flashes, pops)
  jitter              how much the global motion direction flips frame to frame (shaky, unstable output)
  seconds, fps, frames
Also writes the first, middle and last frames as PNG to frames_dir (kept as intermediates and checked for safety).
"""
import json, os, sys

import cv2
import numpy as np


def main():
    src, out = sys.argv[1], sys.argv[2]
    fdir = sys.argv[3] if len(sys.argv) > 3 else None
    cap = cv2.VideoCapture(src)
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(f)
    if len(frames) < 2:
        json.dump({"ok": False, "reason": "no frames"}, open(out, "w"))
        return
    h, w = frames[0].shape[:2]
    W = 448
    H = int(round(h * W / w))
    gray = [cv2.cvtColor(cv2.resize(f, (W, H), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY) for f in frames]
    mags, diffs, dirs, subj = [], [], [], []
    for a, b in zip(gray, gray[1:]):
        flow = cv2.calcOpticalFlowFarneback(a, b, None, 0.5, 3, 15, 3, 5, 1.2, 0)
        m = np.linalg.norm(flow, axis=2)
        mags.append(float(m.mean()))
        # Camera motion (push, pan, zoom, parallax-free) is one global affine transform: fit it on a grid of flow
        # vectors and remove it. What moves on top of it is the subject: people walking, fighting, water, sparks.
        ys, xs = np.mgrid[4:H:8, 4:W:8]
        src_pts = np.stack([xs.ravel(), ys.ravel()], 1).astype(np.float32)
        dst_pts = src_pts + flow[ys.ravel(), xs.ravel()]
        A, _ = cv2.estimateAffinePartial2D(src_pts, dst_pts, method=cv2.RANSAC, ransacReprojThreshold=1.0)
        if A is None:
            resid = m
        else:
            gx, gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
            cam = np.dstack([A[0, 0] * gx + A[0, 1] * gy + A[0, 2] - gx, A[1, 0] * gx + A[1, 1] * gy + A[1, 2] - gy])
            resid = np.linalg.norm(flow - cam, axis=2)  # noqa: F841 (kept for debugging)
        # Coherent motion only: average the leftover flow vector over 16 px blocks, so resampling noise and grain cancel
        # and a region that really moves (a limb, a body, water) survives. Then the busiest 5% of the frame, so a
        # person running in a wide shot still counts.
        rv = flow - cam if A is not None else flow
        bx = cv2.blur(rv[..., 0], (16, 16))
        by = cv2.blur(rv[..., 1], (16, 16))
        subj.append(float(np.percentile(np.hypot(bx, by), 95)))
        mean_vec = flow.reshape(-1, 2).mean(axis=0)
        dirs.append(mean_vec)
        diffs.append(float(np.abs(a.astype(np.int16) - b.astype(np.int16)).mean()))
    mags, diffs, subj = np.array(mags), np.array(diffs), np.array(subj)
    med = float(np.median(diffs)) or 1e-6
    flips = 0
    for u, v in zip(dirs, dirs[1:]):
        nu, nv = np.linalg.norm(u), np.linalg.norm(v)
        if nu > 0.05 and nv > 0.05 and float(np.dot(u, v) / (nu * nv)) < -0.5:
            flips += 1
    res = {
        "frames": len(frames),
        "fps": round(fps, 3),
        "seconds": round(len(frames) / fps, 3),
        "motionScore": round(float(subj.mean()), 4),
        "movingFrameRatio": round(float((subj > 0.5).mean()), 4),
        "cameraMotion": round(float(mags.mean()), 4),
        "popRatio": round(float((diffs > 4 * med).mean()), 4),
        "jitter": round(flips / max(1, len(dirs) - 1), 4),
    }
    if fdir:
        os.makedirs(fdir, exist_ok=True)
        for name, i in (("first", 0), ("middle", len(frames) // 2), ("last", len(frames) - 1)):
            cv2.imwrite(os.path.join(fdir, f"{name}.png"), frames[i])
    json.dump(res, open(out, "w"))
    print(json.dumps(res))


if __name__ == "__main__":
    main()
