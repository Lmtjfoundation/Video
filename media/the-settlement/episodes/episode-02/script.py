"""The Settlement, Episode 2: One Contact — motion-graphics version.
Same shots, lines and sound cues as the original (source/script.py); this adds slam titles, effects and moves.
Voices: N narrator + M Marcus (Kokoro), D Dre + T Tasha (ElevenLabs designed voices)."""
import copy, importlib.util, os

_here = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("orig", f"{_here}/source/script.py")
_orig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_orig)
SHOTS = copy.deepcopy(_orig.SHOTS)

EXTRA = {  # (clip, offset) -> extra fields
    ("closet", 0): dict(fx=["rain", "flicker"], moves=["crash_zoom", "punch", "handheld"]),
    ("phone_d", 0): dict(fx=["glow"], slam="ONE CONTACT", moves=["push_in", "dolly"]),
    ("gate", 0): dict(fx=["fog", "dust"], slam="NINE YEARS", moves=["pull_back", "punch", "track"]),
    ("bus", 0): dict(fx=["glow"], moves=["track", "punch", "push_in"]),
    ("visit", 0): dict(fx=["flicker"], moves=["push_in", "punch"]),
    ("visit", 2.5): dict(fx=["flicker"], moves=["circle", "punch", "push_in"]),
    ("cell", 0): dict(fx=["dust", "beam"], moves=["crane_down", "punch", "push_in"]),
    ("funeral", 0): dict(fx=["rain"], moves=["track", "punch", "pull_back"]),
    ("dre_face", 0): dict(fx=["rain", "glow"], moves=["crash_zoom", "punch"]),
    ("truck", 0): dict(fx=["dust", "glow"], moves=["dolly", "track", "punch"]),
    ("house", 0): dict(fx=["glow"], moves=["push_in", "dolly", "punch"]),
    ("dre_face", 1.5): dict(fx=["glow"], moves=["punch", "push_in"]),
    ("driveway", 0): dict(fx=["dust"], moves=["track", "punch", "push_in"]),
    ("skyline", 0): dict(fx=["rain", "glow"], slam="IT WAS HER", moves=["crash_zoom"]),
    ("bank", 0): dict(fx=["dust", "beam"], moves=["push_in", "punch", "track"]),
    ("bank_dre", 0): dict(fx=["dust"], moves=["track", "punch", "push_in"]),
    ("dre_listen", 0): dict(fx=["glow"], moves=["push_in", "punch", "circle"]),
    ("tasha_close", 0): dict(fx=["glow"], slam="WHAT DO YOU WANT?", moves=["dolly"]),
    ("tasha_close", 2.0): dict(fx=["glow"], moves=["punch", "push_in"]),
    ("cafe", 0): dict(fx=["glow"], moves=["crane_down", "punch", "push_in"]),
    ("cafe", 2.0): dict(fx=["glow"], moves=["punch", "dolly"]),
    ("tasha_car", 0): dict(fx=["rain"], moves=["push_in", "punch", "track"]),
    ("marcus_call", 0): dict(fx=["flicker"], moves=["push_in", "punch", "handheld"]),
    ("dre_answers", 0): dict(fx=["rain"], moves=["dolly", "punch"]),
    ("dre_answers", 2.0): dict(fx=["rain", "glow"], moves=["punch", "push_in"]),
    ("marcus_call", 2.5): dict(fx=["flicker", "shake"], slam="DRE?", moves=["crash_zoom", "handheld"]),
    ("front_door", 0): dict(fx=["rain", "fog"], moves=["dolly", "push_in"]),
}
for s in SHOTS:
    if s["kind"] == "motion":
        s.update(EXTRA.get((s["clips"][0], s.get("offset", 0)), {}))
    # the phone ring/Dre lines keep their speaker codes; Marcus "Who is this?" / "Dre?" stay Marcus.
