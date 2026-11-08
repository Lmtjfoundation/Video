# The Settlement — Episode 3: The Boutique

Vertical (9:16, 1080x1920) full-motion episode, 3 min 55 s, plus a 16:9 version. Set in Dallas; the 2012 case it refers to is a Houston case. The file in this folder is the ~18 MB phone preview (720x1280); the full-quality vertical and 16:9 masters are in the project files.

**Story:** Tasha walks in the second Episode 2 ends. Flashback: Dre shows her an empty storefront in Bishop Arts and offers her the boutique she has been drawing for twelve years. Lunches turn into an affair. The lease, the buildout and the inventory drain the Grant Heating and Air account, and Tasha forges Marcus's name on a loan against his mother's house, while every dollar goes to Dre. Six months ago she finds out there is no lease and tries to walk away. Dre tells her he can hand Houston police the second man from the 2012 corner: "You ain't my partner, Tasha. You my account." Now: Marcus and Tasha smile at each other across the kitchen, both hiding something.

**Cliffhanger into Episode 4:** at 2 a.m. Dre texts Tasha a photo of Marcus's truck in their driveway: "Tell him drive safe."

## How it was made
| Step | Tool | Script |
|---|---|---|
| Stills (cast-consistent, using `../cast/` portraits as references) | Canva image generation | `stills/` |
| Image-to-video motion, 448x800, 121 frames | LTX-Video 2B 0.9.6 distilled (diffusers, CPU) | `source/embed.py`, `source/generate.py`, `source/prompts.py` |
| AI sharpening to 1080p | Real-ESRGAN realesr-general-x4v3 | `source/upscale.py` |
| Narrator | Kokoro 82M TTS | `source/vo.py` |
| Character voices (Dre, Marcus, Tasha) | ElevenLabs eleven_v3 (free tier, non-commercial with attribution); two lines are Kokoro stand-ins | `source/vo_some.py` |
| Ambiences and foley | AudioLDM 2 large | `source/sfx.py` |
| Score, impacts, phone sounds, mix | numpy/scipy synthesis | `source/mix.py` |
| Edit at 1080x1920 30 fps, cards | ffmpeg | `source/film.py` |
| Grade, captions with speaker names, loudness, 16:9 | ffmpeg | `source/assemble.py` |

The shot list, every line of dialogue, and the sound cues are in `source/script.py`.
