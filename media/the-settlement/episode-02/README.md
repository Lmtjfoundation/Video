# The Settlement — Episode 2: One Contact

Vertical (9:16) full-motion episode, about 4 minutes, plus a 16:9 version. Picks up the second that Episode 1 ends: Marcus holds the hidden phone with one contact, "D".

**Story:** three years ago Dre walks out of Huntsville after nine years for a crime he shared with Marcus. Marcus's 2012 promise through the visiting glass, the letters that stopped, his mother's funeral in handcuffs. Dre finds the Grant Heating and Air truck, watches the house, learns Tasha carries the money, and meets her at the bank with one question: "What do you want?" He gives her a phone. Now: Marcus calls the contact, a familiar laugh answers, and the front door opens downstairs.

**Cliffhanger into Episode 3, "The Boutique":** Marcus knows it is Dre, and Tasha has just walked in.

## How it was made
| Step | Tool | Script |
|---|---|---|
| Stills (cast-consistent, using `../cast/` portraits as references) | Canva image generation | `stills/` |
| Image-to-video motion, 448x800, 121 frames | LTX-Video 2B 0.9.6 distilled (diffusers, CPU) | `source/embed.py`, `source/generate.py`, `source/prompts.py` |
| Voices: narrator, Dre, Marcus, Tasha | Kokoro 82M TTS | `source/vo.py` |
| Ambiences and foley | AudioLDM 2 large | `source/sfx.py` |
| Score, impacts, phone sounds, heartbeat, mix | numpy/scipy synthesis | `source/mix.py` |
| Edit at 1080x1920 30 fps, cards | ffmpeg | `source/film.py` |
| Grade, captions with speaker names, loudness (-14 LUFS), 16:9 | ffmpeg | `source/assemble.py` |

The shot list, every line of dialogue, and the sound cues are in `source/script.py`.
