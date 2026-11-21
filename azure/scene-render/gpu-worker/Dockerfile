# Vueio scene worker: headless ComfyUI + Wan 2.1 First-Last-Frame-to-Video on Azure Container Apps serverless GPUs
# (Consumption-GPU-NC24-A100). Runs as a non-root user, as Container Apps requires. Model weights are NOT in the
# image: they come from the Azure Files share mounted at /models, which keeps the image small for ACR artifact
# streaming (the container starts while layers are still streaming in).
FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PATH=/opt/venv/bin:$PATH HF_HUB_OFFLINE=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv python3-dev build-essential git ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/venv

# PyTorch for CUDA 12.8, then ComfyUI pinned to a release, then SageAttention (Triton kernels; works on the A100).
RUN pip install torch==2.9.1 torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
ARG COMFY_VERSION=v0.46.2
RUN git clone --depth 1 --branch ${COMFY_VERSION} https://github.com/comfyanonymous/ComfyUI /opt/ComfyUI \
 && pip install -r /opt/ComfyUI/requirements.txt \
 && pip install sageattention==1.0.6 "azure-identity>=1.19,<2" "azure-storage-blob>=12.24,<13" "azure-storage-queue>=12.12,<13"

# Non-root user (Container Apps requirement). ComfyUI's input/output/temp/user folders are pointed at /tmp/comfy.
RUN useradd --create-home --uid 10001 render && mkdir -p /tmp/comfy && chown -R render:render /tmp/comfy
COPY --chown=render:render worker.py seed_models.py extra_model_paths.yaml /app/
COPY --chown=render:render workflows /app/workflows
USER 10001
WORKDIR /app
CMD ["python3", "/app/worker.py"]
