# Ghost Post Video Engine: Wan 2.2 TI2V-5B behind a small HTTP API, for any NVIDIA GPU host (RunPod, Vast.ai, Lambda…).
FROM pytorch/pytorch:2.9.1-cuda12.8-cudnn9-runtime
ENV PYTHONUNBUFFERED=1 HF_HUB_ENABLE_HF_TRANSFER=1 HF_HOME=/workspace/hf PORT=8000
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
EXPOSE 8000
CMD ["python", "server.py"]
