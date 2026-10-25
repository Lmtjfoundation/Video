"""
Ghost Post Speech Engine — voices in 23 languages, voice cloning and voice-to-voice, for the AI Studio's Voiceover,
My Voices and Dubbing. Resemble AI's Chatterbox (MIT): Chatterbox Multilingual for speech from text, optionally in
the voice of a 5–20 second reference recording; Chatterbox VC to turn a recording into another voice. Every file it
makes carries Resemble's inaudible Perth watermark, so AI speech can be identified. Runs in its own environment
(requirements-speech.txt); the video engine forwards /v1/speech here (SPEECH_URL, default http://127.0.0.1:8002).

  POST /v1/speech  {"mode": "tts", "text", "language", "voice"?: base64 reference audio, "exaggeration"?, "cfg"?}
                   {"mode": "convert", "source": base64 audio to change, "voice": base64 target voice}
                   -> {"id"}; then GET /v1/speech/{id} and /v1/speech/{id}/file (WAV)
"""

from __future__ import annotations

import math
import os
import wave

from fastapi import HTTPException
from pydantic import BaseModel, Field

from sidecar import TINY, Job, create_app, decode_file

LANGUAGES = {
    "ar": "Arabic", "da": "Danish", "de": "German", "el": "Greek", "en": "English", "es": "Spanish", "fi": "Finnish",
    "fr": "French", "he": "Hebrew", "hi": "Hindi", "it": "Italian", "ja": "Japanese", "ko": "Korean", "ms": "Malay",
    "nl": "Dutch", "no": "Norwegian", "pl": "Polish", "pt": "Portuguese", "ru": "Russian", "sv": "Swedish",
    "sw": "Swahili", "tr": "Turkish", "zh": "Chinese",
}


class SpeechRequest(BaseModel):
    mode: str = Field(default="tts", pattern="^(tts|convert)$")
    text: str = Field(default="", max_length=1200)
    language: str = "en"
    voice: str | None = None
    source: str | None = None
    exaggeration: float = Field(default=0.5, ge=0.25, le=2.0)
    cfg: float = Field(default=0.5, ge=0.0, le=1.0)
    seed: int | None = None


models: dict = {}


def check(r: SpeechRequest) -> None:
    if r.mode == "tts":
        if not r.text.strip():
            raise HTTPException(400, "Text is required.")
        if r.language not in LANGUAGES:
            raise HTTPException(400, f"language must be one of {', '.join(LANGUAGES)}")
    elif not (r.source and r.voice):
        raise HTTPException(400, "Voice-to-voice needs the recording (source) and the target voice.")


def save_wav(path: str, samples, sr: int) -> None:
    import numpy as np

    x = np.clip(np.asarray(samples, dtype=np.float32).reshape(-1), -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((x * 32767).astype("<i2").tobytes())


def run(job: Job) -> str:
    r: SpeechRequest = job.req  # type: ignore[assignment]
    out = os.path.join(job.dir, "speech.wav")
    voice = decode_file(r.voice, os.path.join(job.dir, "voice.wav"), "voice sample") if r.voice else None
    if TINY:
        # No real weights in tests: a tone as long as the words would take (about 14 characters a second).
        import numpy as np

        secs = max(0.5, len(r.text) / 14) if r.mode == "tts" else 1.0
        t = np.arange(int(24000 * secs)) / 24000
        save_wav(out, 0.2 * np.sin(2 * math.pi * (180 + 40 * bool(voice)) * t), 24000)
        job.meta = {"language": r.language, "cloned": bool(voice)}
        return out
    import torch
    import torchaudio

    device = "cuda" if torch.cuda.is_available() else "cpu"
    if r.seed is not None:
        torch.manual_seed(r.seed)
    if r.mode == "tts":
        if "tts" not in models:
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS

            models["tts"] = ChatterboxMultilingualTTS.from_pretrained(device=device)
        m = models["tts"]
        job.progress = 0.2
        wav = m.generate(r.text, language_id=r.language, audio_prompt_path=voice, exaggeration=r.exaggeration, cfg_weight=r.cfg)
    else:
        if "vc" not in models:
            from chatterbox.vc import ChatterboxVC

            models["vc"] = ChatterboxVC.from_pretrained(device=device)
        m = models["vc"]
        src = decode_file(r.source, os.path.join(job.dir, "source.wav"), "recording")
        job.progress = 0.2
        wav = m.generate(src, target_voice_path=voice)
    torchaudio.save(out, wav.cpu(), m.sr)
    job.meta = {"language": r.language if r.mode == "tts" else None, "cloned": bool(voice)}
    return out


app = create_app("Ghost Post Speech Engine", "/v1/speech", SpeechRequest, run, "audio/wav", check=check,
                 info=lambda: {"model": "Chatterbox Multilingual + Chatterbox VC (MIT)", "languages": LANGUAGES})

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("SPEECH_PORT", "8002")))
