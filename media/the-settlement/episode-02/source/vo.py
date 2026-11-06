"""Narration and character lines with Kokoro (Apache-2.0). Writes vo/NNN.wav (24 kHz) for every shot with a line.
Usage: vo.py OUT_DIR"""
import os, sys
import numpy as np, soundfile as sf
from kokoro import KPipeline
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from script import SHOTS
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
VOICE = {"N": ("am_michael", 0.92), "D": ("am_onyx", 0.9), "M": ("am_fenrir", 0.95), "T": ("af_heart", 0.92)}
p = KPipeline(lang_code="a")
for i, s in enumerate(SHOTS):
    if not s.get("vo"):
        continue
    who, text = s["vo"]
    v, speed = VOICE[who]
    audio = np.concatenate([a.numpy() if hasattr(a, "numpy") else a for _, _, a in p(text, voice=v, speed=speed)])
    sf.write(f"{OUT}/{i:03d}_{who}.wav", audio, 24000)
    print(i, who, round(len(audio) / 24000, 2))
# Dre's laugh on the phone: a low, breathy chuckle.
audio = np.concatenate([a.numpy() for _, _, a in p("Heh. Heh heh heh.", voice="am_onyx", speed=0.8)])
sf.write(f"{OUT}/laugh.wav", audio, 24000)
