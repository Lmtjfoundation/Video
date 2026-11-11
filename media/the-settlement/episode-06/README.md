# The Settlement — Episode 6: The Fourth Floor

Vertical (9:16, 1080x1920) full-motion episode, 3 min 19 s, plus a 16:9 version. Set in Dallas. The file in this folder is the phone preview (720x1280); the full-quality vertical and 16:9 masters are in the project files.

**Story:** Three weeks later Tasha is alive on the fourth floor of a Dallas hospital, and Marcus sleeps in the chair by her bed. A detective wants to know why he stayed home that night. A man signs in as her cousin, Andre, and whispers "Twenty million" at her bedside. Marcus and Dre meet in the hallway for the first time in twelve years: "Stay away from my wife." "Ask her who she been calling."

**Cliffhanger into Episode 7:** Tasha opens her eyes and says to Marcus, "You were supposed to be there."

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
