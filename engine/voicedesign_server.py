"""
Ghost Post Voice Design — a new voice from a description, for AI Studio's Voice Lab. Parler-TTS Mini v1 (Apache 2.0)
reads a line in the voice the words describe ("a warm older man with a slight Texas drawl, close to the
microphone"). The sample is saved as a designed voice in My Voices, which the speech engine (Chatterbox) then speaks
in, in any of its 23 languages. No real person is copied. Runs in its own environment (requirements-voicedesign.txt:
Parler needs older transformers than Chatterbox); the video engine forwards /v1/voice-design here
(VOICEDESIGN_URL, default http://127.0.0.1:8004).

  POST /v1/voice-design  {"text", "description", "seed"?}
                         -> {"id"}; then GET /v1/voice-design/{id} and /v1/voice-design/{id}/file (WAV)
"""

import math
import os
import wave

from fastapi import HTTPException
from pydantic import BaseModel, Field

from sidecar import TINY, Job, create_app

MODEL = "parler-tts/parler-tts-mini-v1"


class DesignRequest(BaseModel):
    text: str = Field(default="", max_length=600)
    description: str = Field(default="", max_length=600)
    seed: int | None = None


models: dict = {}


def check(r: DesignRequest) -> None:
    if not r.text.strip() or not r.description.strip():
        raise HTTPException(400, "Voice design needs a description of the voice and a line for it to say.")


def save_wav(path: str, samples, sr: int) -> None:
    import numpy as np

    x = np.clip(np.asarray(samples, dtype=np.float32).reshape(-1), -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((x * 32767).astype("<i2").tobytes())


def run(job: Job) -> str:
    r: DesignRequest = job.req  # type: ignore[assignment]
    out = os.path.join(job.dir, "voice.wav")
    job.meta = {"designed": True}
    if TINY:
        # No real weights in tests: a tone as long as the words would take (about 14 characters a second).
        import numpy as np

        t = np.arange(int(24000 * max(0.5, len(r.text) / 14))) / 24000
        save_wav(out, 0.2 * np.sin(2 * math.pi * 150 * t), 24000)
        return out
    import torch
    from parler_tts import ParlerTTSForConditionalGeneration
    from transformers import AutoTokenizer

    device = "cuda" if torch.cuda.is_available() else "cpu"
    if r.seed is not None:
        torch.manual_seed(r.seed)
    if "m" not in models:
        models["m"] = (ParlerTTSForConditionalGeneration.from_pretrained(MODEL).to(device), AutoTokenizer.from_pretrained(MODEL))
    m, tok = models["m"]
    job.progress = 0.2
    desc = tok(r.description, return_tensors="pt").to(device)
    words = tok(r.text, return_tensors="pt").to(device)
    with torch.no_grad():
        audio = m.generate(input_ids=desc.input_ids, attention_mask=desc.attention_mask, prompt_input_ids=words.input_ids,
                           prompt_attention_mask=words.attention_mask)
    save_wav(out, audio.cpu().numpy().squeeze(), m.config.sampling_rate)
    return out


app = create_app("Ghost Post Voice Design", "/v1/voice-design", DesignRequest, run, "audio/wav", check=check,
                 info=lambda: {"model": "Parler-TTS Mini v1 (Apache 2.0)"})

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("VOICEDESIGN_PORT", "8004")))
