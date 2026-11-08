"""Re-voice only the shots given by index, with the same voices as vo.py. Usage: vo_some.py OUT_DIR i,j,k"""
import os, sys
import numpy as np, soundfile as sf
from kokoro import KPipeline
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from script import SHOTS
VOICE = {"N": ("am_michael", 0.92), "D": ("am_onyx", 0.9), "M": ("am_fenrir", 0.95), "T": ("af_heart", 0.92)}
OUT, IDX = sys.argv[1], [int(x) for x in sys.argv[2].split(",")]
p = KPipeline(lang_code="a")
for i in IDX:
    who, text = SHOTS[i]["vo"]
    v, speed = VOICE[who]
    audio = np.concatenate([a.numpy() if hasattr(a, "numpy") else a for _, _, a in p(text, voice=v, speed=speed)])
    sf.write(f"{OUT}/{i:03d}_{who}.wav", audio, 24000)
    print(i, who, round(len(audio) / 24000, 2), text)
