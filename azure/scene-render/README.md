# Vueio scene rendering on Azure

Stylized motion-graphics scenes (start keyframe → end keyframe, smooth motion between them, crisp kinetic titles), every
scene rendered **in parallel** on **Azure Container Apps serverless A100 GPUs** that scale to zero. Everything is
first-party Azure, billed to the Microsoft Nonprofit sponsorship: no Marketplace offers, no third-party AI APIs.

## How it plugs into the existing app (architecture diff)

Nothing in the front end, auth or routes changes. One branch was added inside `renderVideoPost` (`src/lib/render.ts`):

```
renderVideoPost (unchanged until the voice is recorded and every scene's length is known)
  │
  ├─ AZURE_SCENES_ACCOUNT set?  ── yes ──► renderOnAzureScenes()  (src/lib/azure-scenes.ts, new)
  │                                         1. Azure OpenAI (gpt-5.4-mini, JSON) designs each scene: start frame,
  │                                            end frame, the motion between them, 1–2 kinetic titles
  │                                         2. keyframes: Azure OpenAI image model (AZURE_AI_KEYFRAME_DEPLOYMENT),
  │                                            else FLUX.2 on Azure AI Foundry (already deployed); the end frame is
  │                                            painted from the start frame so palette and layout match
  │                                         3. scene voices (Azure AI Speech, recorded by the existing code) laid on
  │                                            one timeline; plan.json + keyframes + voice → Blob Storage
  │                                         4. one Storage Queue message per scene  ─────────────────────────┐
  │                                         5. waits; each finished clip appears in the jobs-tray live preview │
  │                                         6. downloads final.mp4 → the existing music mix, save, credits,   │
  │                                            notifications and auto-post code                              │
  │                                       any failure (no GPU quota, outage) ─► falls through to ▼          │
  └─ no ──────────────────────────────────► the motion-graphics engine (unchanged), so a video always finishes
                                                                                                             │
 Azure (infra/main.bicep)                                                                                    ▼
  Storage Queue "scene-jobs" ──KEDA azure-queue scaler (queueLength 1, min 0, max 3)──► Container Apps Job
     vueio-scene-worker on Consumption-GPU-NC24-A100: ComfyUI headless, Wan 2.1 First-Last-Frame-to-Video,
     FP8 weights → BF16 compute, SageAttention; weights read from Azure Files (/models); image streamed from ACR
        │ uploads scenes/<id>/clips/<n>.mp4
        ▼
  Event Grid (BlobCreated, …/clips/…mp4) ──► Storage Queue "stitch-jobs" ──KEDA──► Container Apps Job
     vueio-stitch-worker (CPU): the execution that sees every clip takes a lock, conforms each clip to its scene,
     scales to 4K (Lanczos), smooth xfade transitions, typography drawn at 4K, voice, H.264 -preset veryfast
        │ uploads scenes/<id>/final.mp4 + status.json  ──► the app downloads it (step 6 above)
```

**Why Container Apps *Jobs*, not a Container App with min/max replicas:** a queue-scaled *app* gets scaled in by KEDA
while a replica is still rendering (the message it holds is invisible, so the queue looks empty) and the render dies.
An event-driven *job* runs each execution to completion. Scaling is otherwise what was asked for: `minExecutions: 0`
(pays nothing when idle), `maxExecutions: 3` (three scenes at once), `queueLength: 1`.

## Files

| File | What it is |
|---|---|
| `infra/main.bicep` | Everything: identity, ACR Premium, keyless Storage (blobs, 2 queues, 7-day cleanup), Premium Files share with SMB multichannel, Event Grid, Container Apps environment with the A100 profile, the three jobs, and a Cost Management budget (50/80/100% actual + 100% forecast alerts) |
| `infra/deploy.sh` | Two-pass deploy, `az acr build` for both images, artifact streaming, one-time model seeding |
| `gpu-worker/Dockerfile` | CUDA 12.8 runtime, PyTorch 2.9.1, ComfyUI v0.46.2, SageAttention 1.0.6, **non-root user** |
| `gpu-worker/workflows/wan21_flf2v_api.json` | ComfyUI API workflow (node names and inputs checked against ComfyUI's source) |
| `gpu-worker/worker.py` | One scene per execution: keyframes → ComfyUI → MP4 → Blob (fires Event Grid) |
| `gpu-worker/seed_models.py` | Fills the Azure Files share once (~25 GB), idempotent |
| `stitch-worker/` | CPU FFmpeg compositor (typography, transitions, voice, logo) |
| `tests/test_workers.py` | Worker tests; the stitch test renders a real video with FFmpeg |
| `src/lib/azure-scenes.ts`, `tests/azure-scenes.test.ts` | The app side and its tests |

## Deploy

```bash
ALERT_EMAIL=you@example.org bash azure/scene-render/infra/deploy.sh      # from the repo root, after `az login`
```

Then add `AZURE_SCENES_ACCOUNT=<printed name>` to `/etc/ghostpost/env` on the app server and restart the app.

**Prerequisite, not automatic:** the subscription's serverless GPU quota for Container Apps is **0** (checked 2026-11-21).
Request A100 serverless GPU quota for East US in the portal. Until it's granted the scene jobs never start, and
Vueio falls back to its motion-graphics engine after ~4 minutes (queued work expires after an hour, so it can't run
later for nothing).

## What it costs (Azure retail prices, East US, checked 2026-11-21)

| Item | Price | When |
|---|---|---|
| Serverless A100 GPU | $0.000529/s ≈ **$1.90/h** per running scene | only while a scene renders |
| Container Apps vCPU / memory | $0.000024 per vCPU-s, $0.000003 per GiB-s (monthly free grant applies) | while jobs run; if the GPU profile's 24 vCPU / 220 GiB are billed on top, an A100 execution is up to ≈ $6.35/h |
| ACR **Premium** (required for artifact streaming) | $1.67/day ≈ **$50/month** | always, even idle |
| Azure Files Premium, 100 GiB minimum | $0.16/GiB-month ≈ **$16/month** | always |
| Storage, queues, Event Grid, stitch CPU | cents per video | per use |

So the GPU side is near-$0 when idle, but **ACR Premium + Premium Files add ≈ $66/month fixed**. To make idle truly ~$0:
use ACR **Basic** ($5/month, no artifact streaming: slower cold starts) and keep Premium Files only if cold starts matter.
Per-scene GPU time hasn't been measured yet (no GPU quota to test on); expect a cold start (image streaming + loading
~16 GB of FP8 weights from Azure Files) plus the generation itself.

## Notes on the requested settings

- **FP8 on an A100:** the A100 has no FP8 tensor cores. The worker loads the FP8 weights file (half the size, so faster
  to read from Azure Files) and computes in BF16 (`--bf16-unet`), the fastest correct setting on this card.
  `fp8_e4m3fn_fast` needs Ada/Hopper GPUs.
- **SageAttention / FlashAttention:** SageAttention 1.0.6 (Triton) is installed and enabled (`--use-sage-attention`).
  The `flash-attn` package isn't built into the image (it needs a CUDA compile); PyTorch's own attention already uses
  flash kernels on the A100 if you switch the flag.
- **"Local NVMe scratch caching" for Azure Files:** Container Apps doesn't expose a local NVMe cache for mounts. SMB
  multichannel on Premium Files is configured; the weights stream from the share at load time.
- **Wan 2.2:** the Wan 2.2 first/last-frame workflow uses two 14B experts; the worker is built on Wan 2.1 FLF2V-14B
  (one model, fits an 80 GB A100 comfortably). Swapping is a workflow + seed-list change.
- **Base images** come from public registries (NVIDIA CUDA, Python) at build time only; images are built by ACR Tasks
  and served from your ACR. No third-party *services* are called at run time.
