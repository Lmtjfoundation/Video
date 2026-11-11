# The Settlement — Episode 5: Ten O'Clock

Vertical (9:16, 1080x1920) full-motion episode, 3 min 29 s, plus a 16:9 version. Set in Dallas. The file in this folder is the phone preview (720x1280); the full-quality vertical and 16:9 masters are in the project files.

**Story:** Tasha asks Marcus to make a run to the supply house on Ledbetter at ten. He says yes and watches her fail to meet his eyes. A storm hits Dallas. Marcus sits in his dark truck in the driveway to see who shows up, but it is Tasha who drives out to stop it, screaming at Dre to call it off. Kev waits at the light in his tow truck, dashcam running. Marcus lets her call ring. The eighteen-wheeler meant for him finds her instead.

**Cliffhanger into Episode 6:** Kev's dashcam caught every second, and back in the driveway her name is still glowing on Marcus's phone.

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
