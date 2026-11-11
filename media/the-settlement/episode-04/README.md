# The Settlement — Episode 4: Static

Vertical (9:16, 1080x1920) full-motion episode, 3 min 05 s, plus a 16:9 version. Set in Dallas. The file in this folder is the phone preview (720x1280); the full-quality vertical and 16:9 masters are in the project files.

**Story:** Two in the morning, Marcus finds the street empty after someone photographed his truck. He says nothing to Tasha and starts paying attention: the mail, the statements she swore she shredded (thirty-one thousand dollars), and a life insurance policy on him, doubled six months ago, with Tasha as beneficiary. At breakfast they both smile. Upstairs in the yellow nursery built for a baby that never came, the old baby monitor still picks up the laundry room, and through the static he hears Tasha on the phone with Dre.

**Cliffhanger into Episode 5:** the monitor crackles one more time. Dre: "Ten o'clock. Ledbetter. Make sure he drives."

## How it was made
| Step | Tool | Script |
|---|---|---|
| Stills (cast-consistent, using `../cast/` portraits as references) | Canva image generation | `stills/` |
| Image-to-video motion, 448x800, 121 frames | LTX-Video 2B 0.9.6 distilled (diffusers, CPU) | `source/embed.py`, `source/generate.py`, `source/prompts.py` |
| AI sharpening to 1080p | Real-ESRGAN realesr-general-x4v3 | `source/upscale.py` |
| Narrator and character voices | Kokoro 82M TTS. The character voices are stand-ins until they can be re-voiced with ElevenLabs. | `source/vo.py`, `source/vo_missing.py` |
| Ambiences and foley | AudioLDM 2 large | `source/sfx.py` |
| Score, impacts, phone and monitor sounds, mix | numpy/scipy synthesis | `source/mix.py` |
| Edit at 1080x1920 30 fps, cards | ffmpeg | `source/film.py` |
| Grade, captions with speaker names, loudness, 16:9 | ffmpeg | `source/assemble.py` |

The shot list, every line of dialogue, and the sound cues are in `source/script.py`.
