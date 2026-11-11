"""Second Line, Episode 3: Velvet Bayou (uploaded bible). Honey's headline set (to "Pillow" by dblack4 in the bible;
needs the user's audio file), the DJ follows with Dre's "Under the Bridge" and a dancer's video hits a million views.
Lucien washes the cash for 15%; Thibodeaux raises his tax to 30% and slides Locs a photo of Celeste leaving work.
Honey's day life; beignets at 5 a.m. Closing: ATF Agent Monique Dupre at the St. Claude scene. "This just became a
federal case." Kept tasteful: no nudity."""
import sys
sys.path.insert(0, "/tmp/claude-0/-home-user-Video/e94a2179-1832-5221-bb24-9d181da3a815/scratchpad/secondline")
from common import CAST, SCENES, tail
EP1 = "/tmp/claude-0/-home-user-Video/e94a2179-1832-5221-bb24-9d181da3a815/scratchpad/secondline/ep1/img"
EP2 = "/tmp/claude-0/-home-user-Video/e94a2179-1832-5221-bb24-9d181da3a815/scratchpad/secondline/ep2/img"
EP3 = "/tmp/claude-0/-home-user-Video/e94a2179-1832-5221-bb24-9d181da3a815/scratchpad/secondline/ep3/img"

SHOTS = [
    dict(kind="motion", clips=["shredded_car"], mood="dread", bed=["night"], fx=["fog"], sfx=[("heartbeat", 0.0, 0.4)], moves=["push_in", "punch"],
         vo=("N", "Last time, T-Bone emptied a Draco on St. Claude Avenue and hit nothing but a parked car.")),
    dict(kind="card", text="SECOND LINE", sub="EPISODE THREE", dur=4.0, font="cinzel", sfx=[("impact", 0.2, 0.9)]),
    dict(kind="card", text="VELVET BAYOU", dur=2.6, sfx=[("impact", 0.3, 0.5)]),
    # cold: the club
    dict(kind="motion", clips=["bourbon"], mood="cold", bed=["lobby"], fx=["glow"], moves=["track", "punch"],
         vo=("N", "Friday night on Bourbon Street. The Velvet Bayou. Neon pink and purple, and money raining from the balcony.")),
    dict(kind="motion", clips=["stage_spot"], bed=["lobby"], fx=["glow", "beam"], moves=["push_in", "punch"],
         vo=("N", "The lights drop. One pink spotlight. The room goes quiet, and Honey walks out for her headline set.")),
    dict(kind="motion", clips=["money_rain"], bed=["lobby"], fx=["glow", "flicker"], sfx=[("impact", 0.6, 0.5)], moves=["crane_down", "punch"],
         vo=("N", "When the beat lands, the balcony empties stacks of ones.")),
    dict(kind="motion", clips=["locs"], bed=["lobby"], fx=["glow"], moves=["push_in", "punch"],
         vo=("N", "Locs watched from the VIP. For the first time all season, he wasn't thinking about the block.")),
    # pulse: viral
    dict(kind="motion", clips=["dj_booth"], mood="pulse", bed=["lobby"], fx=["glow", "flicker"], moves=["dolly", "punch"],
         vo=("N", "When her set ended, the DJ followed it with Dre's Under the Bridge.")),
    dict(kind="motion", clips=["views"], bed=["lobby"], fx=["glow"], sfx=[("phonebuzz", 0.3, 0.6)], slam="1,000,000", moves=["crash_zoom", "punch"],
         vo=("N", "A dancer's video of the crowd losing its mind to it hit a million views overnight. Dre Fly was suddenly somebody.")),
    # tension: Lucien and Thibodeaux
    dict(kind="motion", clips=["lucien"], mood="tension", bed=["lobby"], fx=["glow"], moves=["push_in", "punch"],
         vo=("F", "Every dollar that walks in that door walks out clean. Fifteen percent, gentlemen. That's what a clean dollar costs in the Quarter.")),
    dict(kind="motion", clips=["thib"], bed=["lobby"], fx=["flicker", "glow"], sfx=[("footsteps", 0.0, 0.5)], slam="30%", moves=["dolly", "punch"],
         vo=("X", "Evening, boys. Mind if I sit? Business looks good. So my number goes up. Thirty percent.")),
    dict(kind="motion", clips=["locs"], offset=2.0, bed=["lobby"], fx=["glow"], moves=["punch", "push_in"],
         vo=("L", "We had a deal. Twenty.")),
    dict(kind="motion", clips=["celeste_photo"], bed=["lobby"], fx=["flicker"], sfx=[("heartbeat", 0.0, 0.7)], moves=["push_in", "crash_zoom"],
         vo=("X", "Your mama works the late shift on Canal Street, doesn't she? Pretty lady. Thirty.")),
    # grief / memory: Honey's day life
    dict(kind="motion", clips=["anatomy"], mood="memory", bed=["morning"], fx=["dust", "beam"], moves=["crane_down", "punch"],
         vo=("N", "By day, Honey was Nia Robicheaux. Anatomy exams at Delgado. A little boy she was raising alone. A mother who thought she worked at a hotel.")),
    dict(kind="motion", clips=["honey"], mood="grief", bed=["morning"], fx=["glow"], moves=["push_in", "punch"],
         vo=("H", "Two more semesters, and I never have to walk on that stage again. I'm going to be a nurse, Locs. A real one.")),
    # heart: beignets
    dict(kind="motion", clips=["beignets"], mood="heart", bed=["morning"], fx=["dust", "glow"], moves=["push_in", "punch"], hush=True,
         vo=("N", "Five in the morning. Beignets and powdered sugar on a cafe table. The most honest hour either of them had all week.")),
    # dread / climax: Dupre
    dict(kind="motion", clips=["shredded_car"], offset=2.0, mood="dread", bed=["night"], fx=["fog", "flicker"], moves=["pull_back", "punch"],
         vo=("N", "Across town, a woman in a federal windbreaker walked the St. Claude scene with a crime lab tech.")),
    dict(kind="card", text="NOW", dur=2.0, small=True, sfx=[("impact", 0.0, 0.8)]),
    dict(kind="motion", clips=["dupre"], mood="climax", bed=["night"], fx=["flicker"], moves=["push_in", "punch"],
         vo=("N", "ATF Special Agent Monique Dupre. New Orleans East, born and raised. The camera footage showed rounds coming faster than any finger can pull a trigger.")),
    dict(kind="motion", clips=["casing_glove"], bed=["night"], fx=["flicker"], sfx=[("riser", 0.0, 0.9)], slam="FEDERAL", flash=True, moves=["crash_zoom"], min_dur=5.0,
         vo=("U", "This just became a federal case.")),
] + tail("FOUR", "SWITCH")

REUSE = {**CAST, **SCENES, "shredded_car": f"{EP2}/shredded_car.png"}
GHOST = {
 "stage_spot": "an empty nightclub stage on Bourbon Street lit by a single pink spotlight, haze in the beam, a chrome pole, a silhouetted crowd in the dark foreground, purple neon, tasteful, no nudity",
 "money_rain": "dollar bills raining down from a nightclub balcony through pink and purple light, a crowd of silhouettes looking up, haze, motion blur",
 "dj_booth": "a nightclub DJ booth with glowing turntables and a laptop, the DJ's hands on the mixer, purple and pink light, the crowd blurred beyond",
 "anatomy": "an anatomy textbook and handwritten nursing flashcards on a small kitchen table in morning light, a child's drawing taped to the fridge in the background, a coffee mug",
 "beignets": "a plate of beignets covered in powdered sugar and two cafe au lait cups on a small outdoor cafe table in the French Quarter at dawn, soft blue morning light, empty street",
 "casing_glove": "close-up of a gloved hand holding a single brass shell casing at a night crime scene, an ATF jacket sleeve, red and blue lights blurred behind",
 "celeste_photo": "close-up of a photograph slid across a nightclub table: a woman in a hotel uniform walking out of a hotel at night, a man's hand with a gold ring on the photo, purple light",
}
# views: phone with the dancer's video and 1,000,000 views (compose).
