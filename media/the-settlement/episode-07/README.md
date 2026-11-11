# The Settlement — Episode 7: Twenty Million

Vertical (9:16, 1080x1920) full-motion episode, 3 min 20 s, plus a 16:9 version. Set in Dallas; the case Dre threatens to reopen is the 2012 Houston case. The file in this folder is the phone preview (720x1280); the full-quality vertical and 16:9 masters are in the project files.

**Story:** The trucking company settles in eleven days: twenty million dollars, in Tasha's name only, while Marcus waits in the hallway. On the news she is the victim; on paper he is the husband who stayed home. His mother's house, which Tasha signed a loan against, goes into foreclosure for the same thirty-one thousand dollars from the garage statements. The next night Dre comes to collect half, ten million, or he makes the call about Houston. Marcus walks in having heard enough: "Get out my house." "Your house? Her name on everything now."

**Cliffhanger into Episode 8 (The Tape):** with both men waiting on her, Dre says one word to Tasha: "Choose."

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
