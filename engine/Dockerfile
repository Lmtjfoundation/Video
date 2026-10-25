# Ghost Post Video Engine: Wan 2.2 TI2V-5B behind a small HTTP API, for any NVIDIA GPU host (RunPod, Vast.ai, Lambda…).
FROM pytorch/pytorch:2.9.1-cuda12.8-cudnn9-runtime
ENV PYTHONUNBUFFERED=1 HF_HUB_ENABLE_HF_TRANSFER=1 HF_HOME=/workspace/hf PORT=8000
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Music and sound effects (audio_server.py) need older transformers: their own environment, sharing the base torch.
RUN apt-get update -q && apt-get install -y -q --no-install-recommends git ffmpeg curl && rm -rf /var/lib/apt/lists/* \
 && git clone -q https://github.com/OpenMOSS/MOSS-TTS vendor/MOSS-TTS && git -C vendor/MOSS-TTS checkout -q 934d6826b084c46a0d033402174d5f8ac4ed2519
COPY requirements-audio.txt requirements-audio-nodeps.txt ./
RUN python -m venv --system-site-packages .audio-venv && .audio-venv/bin/pip install --no-cache-dir -r requirements-audio.txt \
 && .audio-venv/bin/pip install --no-cache-dir --no-deps -r requirements-audio-nodeps.txt
# Speech (Chatterbox) and lip sync (MuseTalk) in their own environments.
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh
COPY requirements-speech.txt requirements-voicedesign.txt setup-sidecars.sh ./
RUN ./setup-sidecars.sh
COPY server.py audio_server.py sidecar.py speech_server.py lipsync_server.py voicedesign_server.py ./
EXPOSE 8000
CMD ["sh", "-c", ".audio-venv/bin/python audio_server.py & .speech-venv/bin/python speech_server.py & .lipsync-venv/bin/python lipsync_server.py & .design-venv/bin/python voicedesign_server.py & exec python server.py"]
