"""Put a voice recording into the talking-character video.

Converts any audio or video file to a clean WAV (mono, loudness-normalized,
leading and trailing silence trimmed), transcribes it with faster-whisper
to get caption timings, and picks a body gesture for each caption. Writes
public/voice.wav and public/captions.json; the video length follows the
new audio automatically.

Setup (once): pip install faster-whisper numpy
Usage:        npm run use-recording -- path/to/recording.m4a
              python3 scripts/use_recording.py recording.wav --model small.en
"""

import argparse
import json
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"

RATE = 44100
LEAD_IN = 0.3  # seconds of silence kept before the first word
TAIL = 0.5  # and after the last
SILENCE_DB = -40

MAX_WORDS = 7
PAUSE_BREAK = 0.35  # a gap this long between words starts a new caption


def ffmpeg_command() -> list[str]:
    if shutil.which("ffmpeg"):
        return ["ffmpeg"]
    # Remotion ships its own ffmpeg.
    return ["npx", "--no-install", "remotion", "ffmpeg"]


def convert(src: Path, dst: Path) -> None:
    subprocess.run(
        [
            *ffmpeg_command(), "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(src), "-vn", "-ac", "1", "-ar", str(RATE),
            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-sample_fmt", "s16", str(dst),
        ],
        check=True,
        cwd=ROOT,
    )


def trim_silence(path: Path, out: Path) -> float:
    with wave.open(str(path)) as w:
        samples = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)

    window = RATE // 100
    frames = samples[: len(samples) // window * window].reshape(-1, window)
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1)) / 32768
    loud = np.nonzero(20 * np.log10(rms + 1e-9) > SILENCE_DB)[0]
    if len(loud) == 0:
        raise SystemExit("The recording is silent. Check the microphone and try again.")

    start = max(0, loud[0] * window - int(0.05 * RATE))
    end = min(len(samples), (loud[-1] + 1) * window + int(0.15 * RATE))
    clip = np.concatenate([
        np.zeros(int(LEAD_IN * RATE), dtype=np.int16),
        samples[start:end],
        np.zeros(int(TAIL * RATE), dtype=np.int16),
    ])

    with wave.open(str(out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(clip.tobytes())
    return len(clip) / RATE


def transcribe(path: Path, model_name: str) -> list[dict]:
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, compute_type="int8")
    segments, _ = model.transcribe(str(path), word_timestamps=True, vad_filter=True)
    words = [w for s in segments for w in (s.words or [])]

    # Split into phrases at pauses and punctuation, then break long phrases
    # into even pieces so no caption is a lone word.
    phrases: list[list] = [[]]
    for word in words:
        current = phrases[-1]
        if current and word.start - current[-1].end > PAUSE_BREAK:
            phrases.append([word])
            continue
        current.append(word)
        text = word.word.strip()
        if text.endswith((".", "?", "!")) or (text.endswith((",", ";", ":")) and len(current) >= 3):
            phrases.append([])

    captions: list[dict] = []
    for phrase in filter(None, phrases):
        pieces = -(-len(phrase) // MAX_WORDS)
        size = -(-len(phrase) // pieces)
        for i in range(0, len(phrase), size):
            chunk = phrase[i : i + size]
            captions.append({
                "text": "".join(w.word for w in chunk).strip(),
                "start": round(chunk[0].start, 3),
                "end": round(chunk[-1].end, 3),
            })
    return captions


def pick_gesture(text: str, index: int) -> str:
    first = text.lower().strip(" .,!?").split(" ")[0] if text else ""
    if first in {"no", "nah", "nope", "never"}:
        return "shake"
    if text.endswith("?"):
        return "tilt"
    if text.endswith("!") or index == 0:
        return "lean"
    return "nod"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("recording", type=Path)
    parser.add_argument("--model", default="base.en", help="faster-whisper model (tiny.en, base.en, small.en, ...)")
    args = parser.parse_args()

    src = args.recording.resolve()
    if not src.exists():
        raise SystemExit(f"File not found: {src}")

    with tempfile.TemporaryDirectory() as tmp:
        converted = Path(tmp) / "converted.wav"
        convert(src, converted)
        duration = trim_silence(converted, PUBLIC / "voice.wav")

    captions = transcribe(PUBLIC / "voice.wav", args.model)
    for i, c in enumerate(captions):
        c["gesture"] = pick_gesture(c["text"], i)
    (PUBLIC / "captions.json").write_text(json.dumps(captions, indent=2) + "\n")

    print(f"public/voice.wav: {duration:.2f}s")
    for c in captions:
        print(f"  {c['start']:6.2f}-{c['end']:6.2f}  [{c['gesture']}] {c['text']}")
    print("Check the captions in public/captions.json, then run: npm run render:talking")


if __name__ == "__main__":
    main()
