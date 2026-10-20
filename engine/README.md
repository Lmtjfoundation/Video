# Ghost Post Video Engine

Ghost Post's own video model, so the Film Engine can make moving footage without Seedance, Replicate or any per-clip
fee. It runs **Wan 2.2 TI2V-5B** (Alibaba, open weights, Apache 2.0) behind a small, token-protected web API:

- text to video, or a first frame (a cast portrait, a location, the last frame of the clip before) to video
- up to 5 seconds of 720p at 24 fps per clip; the Film Engine chains clips into beats of up to 30 seconds and adds the
  dialogue voices and score
- frame shapes: 9:16, 16:9, 1:1, 21:9, 4:3, 3:4

It needs an **NVIDIA GPU**. Ghost Post's own server (Railway) has none, so the engine runs on a GPU server you rent by
the hour and Ghost Post calls it over HTTPS.

| GPU memory | Works? | Notes |
|---|---|---|
| 80 GB (A100, H100) | Best | Whole model on the GPU: fastest clips |
| 48 GB (A6000, L40S) | Recommended | Whole model on the GPU |
| 24 GB (RTX 4090, L4) | Yes, slower | Idle parts move to CPU memory automatically (`ENGINE_OFFLOAD=auto`) |
| under 24 GB | No | |

Alibaba reports a 5-second 720p clip in under 9 minutes on a single RTX 4090 without extra optimisation; bigger GPUs are
faster. Check your host's current hourly price; you only pay while the server is on.

## Start it on RunPod (or any GPU host)

1. Create a GPU pod from a **PyTorch** template (CUDA 12.8 or newer) with a **network volume** mounted at `/workspace`
   (60 GB or more: the model is about 30 GB and is downloaded once, on the first start).
2. Expose **HTTP port 8000**.
3. Add environment variables:
   - `ENGINE_TOKEN`: a long random password you make up (letters, numbers, `-`, `_`; 24+ characters). Ghost Post sends it
     with every request; anyone without it is refused.
   - `HF_HOME=/workspace/hf` (keeps the downloaded model on the volume across restarts)
4. Start command:

   ```bash
   bash -c "git clone --depth 1 -b nexus-pulse-autopilot https://github.com/Lmtjfoundation/Video /workspace/ghost-post || git -C /workspace/ghost-post pull; bash /workspace/ghost-post/engine/start.sh"
   ```

5. When the pod is running, its address is `https://<pod-id>-8000.proxy.runpod.net`. Open
   `https://<pod-id>-8000.proxy.runpod.net/health`; it answers `{"ok":true}`.
6. In Ghost Post: **Admin → App settings → Integrations → Ghost Post Video Engine**, paste the address and the
   `ENGINE_TOKEN`, then **Save & test**. The first test may say the model is still loading while it downloads.
7. In the **Film Engine**, choose **Ghost Post engine** and film.

Stop the pod when you aren't making films; the model stays on the volume, so the next start is quick.

## Or with Docker

```bash
docker build -t ghost-post-engine engine
docker run --gpus all -p 8000:8000 -e ENGINE_TOKEN=your-long-random-token -v ghost-post-hf:/workspace/hf ghost-post-engine
```

Put it behind HTTPS (your host's proxy, Cloudflare Tunnel, Caddy…) before adding the address to Ghost Post.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `ENGINE_TOKEN` | (random each start) | Required password; set it, or the engine prints a one-time token in its log |
| `ENGINE_MODEL` | `Wan-AI/Wan2.2-TI2V-5B-Diffusers` | Model to load (`tiny` = a tiny random model for tests) |
| `ENGINE_OFFLOAD` | `auto` | `on`/`off`: move idle model parts to CPU memory (auto: under 40 GB of GPU memory) |
| `ENGINE_STEPS` | `40` | Denoising steps per clip (more = slower, slightly finer; the model card uses 50) |
| `HF_HOME` | `/workspace/hf` | Where the model is cached |
| `PORT` | `8000` | Port |

## API

Every call except `/health` needs `Authorization: Bearer <ENGINE_TOKEN>`.

- `GET /health` → `{"ok": true}`
- `GET /v1/info` → model, GPU, `ready`, queue length
- `POST /v1/videos` with `{"prompt": "...", "image": "<base64 or data: URL, optional>", "aspect": "9:16", "seconds": 5}`
  → `{"id": "..."}`
- `GET /v1/videos/{id}` → `{"status": "queued|running|succeeded|failed", "progress": 0.42, "error": null}`
- `GET /v1/videos/{id}/file` → the MP4 (kept for 3 hours)

Clips are made one at a time, in order.

## Check it without a GPU

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r engine/requirements.txt pytest httpx
pytest engine/test_engine.py
```

This runs the real server with a tiny random model (`ENGINE_MODEL=tiny`): the footage is noise, but every step from the
request to the MP4 is exercised.

## Licence

Wan 2.2 is released by Alibaba under the Apache 2.0 licence, which allows commercial use. You are responsible for what
you generate and for having the rights to the pictures you use as references.
