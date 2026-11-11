"""Sound effects and ambience beds with AudioLDM2-large (diffusers), 16 kHz, upsampled to 48 kHz in the mix.
Usage: sfx.py MODEL_DIR OUT_DIR [names]"""
import os, sys, time, torch, numpy as np, soundfile as sf
from diffusers import AudioLDM2Pipeline
M, OUT = sys.argv[1:3]
torch.set_num_threads(2)
LIST = {  # name: (seconds, prompt)
    "rain": (10, "Heavy rain falling on a city street at night, steady downpour, water running in gutters"),
    "wind": (10, "Cold morning wind blowing across an empty field, distant birds"),
    "bus": (10, "Interior of a moving city bus, engine rumble, road noise"),
    "hum": (10, "Fluorescent lights buzzing in an empty institutional room, ventilation hum"),
    "prison": (10, "Prison cell block at night, distant echoing voices, metal doors in the distance"),
    "cicadas": (10, "Cicadas buzzing loudly on a hot summer afternoon, distant traffic"),
    "night": (10, "Quiet suburban street at night, crickets, distant dog"),
    "morning": (10, "Suburban morning, birds chirping, distant lawn mower"),
    "lobby": (10, "Quiet bank lobby, soft murmur of people, footsteps on tile, keyboard typing"),
    "cafe": (10, "Busy coffee shop ambience, cups clinking, quiet chatter, espresso machine"),
    "gate": (4, "Heavy metal prison gate sliding open with a loud clank and buzz"),
    "footsteps": (5, "Slow footsteps on wet pavement"),
    "cuffs": (3, "Metal handcuffs ratcheting closed, sharp metallic clicks"),
    "paper": (3, "Paper letter unfolded and rustled, close up"),
    "keys": (3, "Bunch of keys jingling"),
    "cardoor": (3, "Car door slamming shut"),
    "traffic": (8, "City traffic passing by on a hot afternoon"),
    "pen": (3, "Ballpoint pen writing on paper, close up"),
    "chair": (2, "Person sitting down on a leather chair, creak"),
    "cup": (2, "Ceramic coffee cup set down on a saucer"),
    "door": (4, "Front door of a house opening with a creak, rain outside"),
    "zip": (2, "Purse zipper closing quickly"),
    "laugh": (4, "A man and a woman laughing together inside a house, heard muffled through a window"),
    "buzzer": (3, "Loud jail door buzzer, electronic buzz"),
}
which = sys.argv[3].split(",") if len(sys.argv) > 3 else list(LIST)
from transformers import GPT2LMHeadModel
lm = GPT2LMHeadModel.from_pretrained(M, subfolder="language_model")
pipe = AudioLDM2Pipeline.from_pretrained(M, language_model=lm, torch_dtype=torch.float32)
os.makedirs(OUT, exist_ok=True)
for k in which:
    dst = f"{OUT}/{k}.wav"
    if os.path.exists(dst):
        continue
    secs, prompt = LIST[k]
    t = time.time()
    a = pipe(prompt, negative_prompt="low quality, music, speech, distorted", num_inference_steps=50, audio_length_in_s=secs,
             guidance_scale=3.5, num_waveforms_per_prompt=1, generator=torch.Generator().manual_seed(3)).audios[0]
    sf.write(dst, a, 16000)
    print(k, f"{time.time() - t:.0f}s", flush=True)
