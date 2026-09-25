"""Generate the character's voice line and caption timings with Piper TTS.

Each entry in LINES is spoken separately, then joined with its pause, so
caption start/end times are exact. Writes public/voice.wav and
public/captions.json.

Setup (once):
  pip install piper-tts
  curl -L -o voices/en_US-ryan-high.onnx \
    https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/ryan/high/en_US-ryan-high.onnx
  curl -L -o voices/en_US-ryan-high.onnx.json \
    https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/ryan/high/en_US-ryan-high.onnx.json

Usage: python3 scripts/make_voice.py [path/to/voice.onnx]
"""

import json
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"

# (text, seconds of silence after it, body gesture: lean | nod | tilt | shake)
LINES = [
    ("Hold up.", 0.25, "lean"),
    ("Hold up.", 0.45, "lean"),
    ("You mean to tell me you made a whole video,", 0.15, "nod"),
    ("and didn't even put me in it?", 0.6, "tilt"),
    ("Nah.", 0.5, "shake"),
    ("Run it back.", 0.6, "nod"),
]
LEAD_IN = 0.4
LENGTH_SCALE = "1.05"  # >1 speaks slower


def main() -> None:
    model = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "voices" / "en_US-ryan-high.onnx")
    frames: list[bytes] = []
    captions = []
    params = None
    t = LEAD_IN

    with tempfile.TemporaryDirectory() as tmp:
        for i, (text, pause, gesture) in enumerate(LINES):
            out = Path(tmp) / f"{i}.wav"
            subprocess.run(
                ["piper", "-m", str(model), "--length_scale", LENGTH_SCALE, "-f", str(out)],
                input=text.encode(), check=True, capture_output=True,
            )
            with wave.open(str(out)) as w:
                params = params or w.getparams()
                rate, width = w.getframerate(), w.getsampwidth()
                if not frames:
                    frames.append(b"\0" * int(LEAD_IN * rate) * width)
                audio = w.readframes(w.getnframes())
                duration = w.getnframes() / rate
            frames.append(audio)
            frames.append(b"\0" * int(pause * rate) * width)
            captions.append(
                {"text": text, "start": round(t, 3), "end": round(t + duration, 3), "gesture": gesture}
            )
            t += duration + pause

    with wave.open(str(PUBLIC / "voice.wav"), "wb") as w:
        w.setparams(params)
        w.writeframes(b"".join(frames))
    (PUBLIC / "captions.json").write_text(json.dumps(captions, indent=2) + "\n")
    print(f"voice.wav: {t:.2f}s, {len(captions)} captions")


if __name__ == "__main__":
    main()
