# Ghost Post Video Engine

Ghost Post's own video model, so the Film Engine can make moving footage without Seedance, Replicate or any per-clip
fee. It runs Alibaba's open **Wan 2.2** models (Apache 2.0, commercial use allowed) behind a small, token-protected web
API. Two quality settings (`ENGINE_QUALITY`):

| Setting | Model | Output | GPU |
|---|---|---|---|
| **`best`** (default) | Wan 2.2 **I2V-A14B**: the strongest open model, two 14B experts (one lays out the motion, one adds the detail) | 720p, about 5 s per clip at 16 fps, from a first frame | **80 GB** (H100, A100 80 GB) |
| `fast` | Wan 2.2 **TI2V-5B** | 720p, 5 s per clip at 24 fps, from text or a first frame | 24 GB and up (48 GB+ is quicker) |

The same engine also makes **pictures** and does the **writing**, so Ghost Post needs no other company's AI credits:

| Job | Model | License | Download |
|---|---|---|---|
| Pictures from a description | Qwen-Image | Apache 2.0 | 58 GB |
| Picture edits, and characters placed into scenes (up to 3 reference pictures) | Qwen-Image-Edit-2511 | Apache 2.0 | 58 GB |
| Writing (scripts, series plans, the Director chat) | Qwen3-8B | Apache 2.0 | 16 GB |

And the **sound** for the Library and AI Studio (music, sound effects), in a second process with its own Python
environment (`audio_server.py`, `requirements-audio.txt`; the video engine forwards `/v1/audio` to it, so the app still
uses one address and one token):

| Job | Model | License | Download |
|---|---|---|---|
| Music: songs and instrumentals, 10 s to 4 min, from a description and optional lyrics | ACE-Step 1.5 turbo | MIT (the model card allows commercial use of the music) | about 10 GB |
| Sound effects, up to 30 s, from a description | MOSS-SoundEffect v2 | Apache 2.0 | about 11 GB |

`start.sh`, the Dockerfile and the Azure script set both processes up; the audio side needs no settings of its own.

Each loads the first time it's used. With everything in use the disk needs about **300 GB**, so the Azure script makes a
512 GB disk. The app sends writing that needs to look at a picture, or to search the web, to Claude or Gemini instead
(Qwen3-8B reads text only); if the engine can't answer, the app falls back to them too. `ENGINE_TEXT=off` turns
writing off on the engine.

In `best`, a clip that has no starting picture (rare in the Film Engine, which starts from your cast portraits and
from each clip's last frame) is made with TI2V-5B, loaded the first time it is needed.

The Film Engine chains clips into beats of up to 30 seconds and adds the dialogue voices and score. Frame shapes:
9:16, 16:9, 1:1, 21:9, 4:3, 3:4.

It needs an **NVIDIA GPU**. Ghost Post's own server (Railway) has none, so the engine runs on a GPU server you rent by
the hour and Ghost Post calls it over HTTPS.

**What to rent for `best`:** one 80 GB GPU (H100 or A100 80 GB), **128 GB or more of system memory** (the idle expert
waits there between steps), and a **200 GB** volume (the A14B model is a 126 GB download and TI2V-5B another 34 GB,
both downloaded once). For `fast`: a 24–48 GB GPU and a 60 GB volume. Alibaba reports that TI2V-5B makes a 5-second
720p clip in under 9 minutes on one RTX 4090. A14B is a much larger model, so expect each clip to take longer; time a
few clips on your GPU to know your cost per second.
Check your host's current hourly price; you only pay while the server is on.

## Start it on Microsoft Azure (one command)

Good for nonprofits: Microsoft's nonprofit grant gives $2,000 of Azure credit a year. The default VM,
`Standard_NC24ads_A100_v4` (one A100 80 GB, 220 GB memory), runs the `best` setting and was $3.673 an hour in East US
in October 2026 (about 540 hours on the grant). You pay only while it runs, plus a few dollars a month for its disk.

1. **GPU quota first.** New and grant-funded subscriptions start with no GPU quota. In the Azure portal open
   **Quotas → Compute**, search **Standard NCADS_A100_v4 Family vCPUs**, choose your region (East US), and request
   **24**. Say it is for a nonprofit's AI video generation. Approval can take from minutes to a few days, and
   Microsoft can decline it for credit-funded subscriptions; if so, ask Microsoft support, or try another region.
2. Open **Cloud Shell** (the `>_` button at the top of portal.azure.com, choose Bash) and run:

   ```bash
   curl -sL https://raw.githubusercontent.com/Lmtjfoundation/Video/nexus-pulse-autopilot/engine/azure/deploy.sh | bash
   ```

   It checks your quota, creates the VM with Ubuntu 22.04, installs the NVIDIA driver, the engine and an HTTPS
   certificate, sets a daily automatic stop (07:00 UTC) and prints the engine's **address and token**.
3. The first start downloads the models (about 160 GB for `best`; allow 30–60 minutes). Then paste the address and
   token into Ghost Post (step 6 below) and press **Save & test**.
4. Stop the GPU when you aren't filming: `az vm deallocate -g ghost-post-engine -n ghost-post-engine`; start it with
   `az vm start -g ghost-post-engine -n ghost-post-engine`. The models stay on the disk.

Options go before `bash`, e.g. `| LOCATION=eastus2 bash` for another region, or `| QUALITY=fast bash` for the
quicker TI2V-5B setting. Azure's A10 VMs (NVadsA10 v5) are not recommended: Microsoft's driver page lists a known CUDA
problem with the GRID driver they install.

## Start it on RunPod (or any GPU host)

1. Create a GPU pod from a **PyTorch** template (CUDA 12.8 or newer) on an **80 GB GPU (H100 or A100 80 GB)** with a
   **200 GB network volume** mounted at `/workspace` (the models download once, on the first start). For the `fast`
   setting, a 24–48 GB GPU and 60 GB are enough; add `ENGINE_QUALITY=fast`.
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
   `ENGINE_TOKEN`, then **Save & test**. On the first start the test says the model is still loading while it
   downloads (126 GB for `best`: allow some time).
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
| `ENGINE_QUALITY` | `best` | `best` (Wan 2.2 I2V-A14B, 80 GB GPU) or `fast` (Wan 2.2 TI2V-5B) |
| `ENGINE_OFFLOAD` | `auto` | `on`/`off`: keep idle model parts in CPU memory (auto: always for `best`, as Alibaba runs it; under 40 GB for `fast`) |
| `ENGINE_STEPS` | `40` | Denoising steps per clip (more = slower, slightly finer) |
| `ENGINE_MODEL` | | `tiny` / `tiny-best`: tiny random models of each setting, for tests |
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
cd engine && ENGINE_MODEL=tiny pytest test_engine.py && ENGINE_MODEL=tiny-best pytest test_engine.py
```

This runs the real server with tiny random models of both settings (the A14B one has the same two-expert layout): the
footage is noise, but every step from the request to the MP4 is exercised.

## Licence

Wan 2.2 is released by Alibaba under the Apache 2.0 licence, which allows commercial use. You are responsible for what
you generate and for having the rights to the pictures you use as references.
