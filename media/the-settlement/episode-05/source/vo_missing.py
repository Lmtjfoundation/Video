"""Kokoro stand-in voices for any line in script.py that has no vo/NNN_X.wav yet. Usage: vo_missing.py EP_DIR"""
import os, sys
import numpy as np, soundfile as sf
ep = sys.argv[1]; sys.path.insert(0, ep + "/src")
from script import SHOTS
from kokoro import KPipeline
VOICE = {"N": ("am_michael", 0.92), "P": ("am_eric", 0.95), "D": ("am_onyx", 0.9), "M": ("am_fenrir", 0.95), "T": ("af_heart", 0.92)}
p = KPipeline(lang_code="a")
for i, s in enumerate(SHOTS):
    if not s.get("vo"): continue
    who, text = s["vo"]; f = f"{ep}/vo/{i:03d}_{who}.wav"
    if os.path.exists(f): continue
    v, sp = VOICE.get(who, VOICE["N"])
    a = np.concatenate([x.numpy() if hasattr(x, "numpy") else x for _, _, x in p(text, voice=v, speed=sp)])
    sf.write(f, a, 24000); print(os.path.basename(f), round(len(a)/24000, 2))
