# Vueio stitch worker: CPU-only Container Apps Job (Consumption profile). FFmpeg composites typography, transitions
# and the voiceover into the final MP4. Build from the repository root so the fonts (SIL OFL) come along:
#   az acr build -r <acr> -t vueio-stitch-worker:<tag> -f azure/scene-render/stitch-worker/Dockerfile .
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 FONTS_DIR=/app/fonts
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/* \
 && pip install "azure-identity>=1.19,<2" "azure-storage-blob>=12.24,<13" "azure-storage-queue>=12.12,<13" \
 && useradd --create-home --uid 10001 render
COPY --chown=render:render azure/scene-render/stitch-worker/stitch.py /app/
COPY --chown=render:render assets/fonts/BebasNeue-Regular.ttf assets/fonts/Poppins-Bold.ttf assets/fonts/LICENSE.txt /app/fonts/
USER 10001
WORKDIR /app
CMD ["python3", "/app/stitch.py"]
