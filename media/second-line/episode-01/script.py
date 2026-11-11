"""Second Line, Episode 1: Brass & Blood (from the uploaded series bible). 18+.
Super Sunday under the Claiborne overpass; Jojo is hit by a stray bullet meant for someone else (he survives).
Locs decides: never again. Honey introduces him to Big Wick at The Velvet Bayou: two kilos fronted. Pulled over on St.
Bernard Avenue, Det. Ray Thibodeaux finds T-Bone's Glock and offers a deal: 20% and the Plank Road Bloods gone.
Closing: two bricks beside a framed picture of Jesus. "We don't stop till we own the block."
vo: N narrator; L Locs, T T-Bone, R Dre Fly, K Kebo, H Honey, W Big Wick, X Thibodeaux, C Celeste."""
import importlib.util, sys
sys.path.insert(0, "/tmp/claude-0/-home-user-Video/e94a2179-1832-5221-bb24-9d181da3a815/scratchpad/secondline")
from common import CAST, SCENES, tail

SHOTS = [
    dict(kind="motion", clips=["indians"], mood="dread", bed=["cicadas"], fx=["dust", "beam"], sfx=[("whoop", 0.5, 0.5)], moves=["crane_down", "punch"],
         vo=("N", "Super Sunday. Under the Claiborne overpass, the Mardi Gras Indians come out in suits they spent all year sewing, one bead at a time.")),
    dict(kind="motion", clips=["claiborne"], bed=["cicadas"], fx=["dust"], moves=["track", "punch"],
         vo=("N", "Four friends from the Seventh Ward dance at the front of the second line, with Locs's little cousin Jojo between them.")),
    dict(kind="motion", clips=["jojo"], bed=["cicadas"], fx=["glow"], moves=["push_in", "punch"], min_dur=3.0,
         vo=("N", "Jojo is fifteen.")),
    dict(kind="motion", clips=["scatter"], bed=["cicadas"], fx=["flicker", "fog"], sfx=[("gunshot", 0.2, 0.9), ("gunshot", 0.5, 0.8), ("gunshot", 0.75, 0.8), ("sirens", 1.6, 0.5)], slam="POP POP POP", flash=True, moves=["crash_zoom", "punch"], min_dur=4.0,
         vo=("N", "Two cars pass. The crowd scatters like birds.")),
    dict(kind="card", text="SECOND LINE", sub="EPISODE ONE", dur=4.0, font="cinzel", sfx=[("impact", 0.2, 0.9)]),
    dict(kind="card", text="BRASS & BLOOD", dur=2.6, sfx=[("impact", 0.3, 0.5)]),
    # cold: the hospital
    dict(kind="motion", clips=["waiting_room"], mood="cold", bed=["hum"], fx=["flicker"], sfx=[("monitor", 0.0, 0.4)], moves=["push_in", "punch"],
         vo=("N", "Jojo lived. The shooters were Plank Road Bloods out of Baton Rouge, aiming at somebody else. Nobody from the city ever called his family back.")),
    dict(kind="motion", clips=["celeste"], bed=["hum"], fx=["dust"], moves=["dolly", "punch"],
         vo=("C", "Six hours in this room, and not one detective. Not one. That's how much our babies are worth to them.")),
    dict(kind="motion", clips=["locs"], bed=["hum"], fx=["glow"], moves=["push_in", "punch"],
         vo=("L", "Never again. Nobody touches our people again. Not while I'm breathing.")),
    dict(kind="card", text="LOWER NINTH WARD", sub="2005", dur=2.6, small=True, sfx=[("thunder", 0.0, 0.5)]),
    # memory: Katrina
    dict(kind="motion", clips=["katrina_roof"], mood="memory", bed=["rain"], fx=["rain", "fog"], sfx=[("thunder", 0.4, 0.6)], moves=["pull_back", "punch"],
         vo=("N", "Locs was a baby in his mother's arms on a rooftop the day the Industrial Canal floodwall broke. His father never came up out of the water. He has grown his dreads ever since.")),
    # grief / pulse: the club
    dict(kind="motion", clips=["bourbon"], mood="grief", bed=["lobby"], fx=["glow"], moves=["track", "punch"],
         vo=("N", "Honey had known Locs since the St. Augustine football games. Now she headlined The Velvet Bayou on Bourbon Street, and she knew everybody worth knowing.")),
    dict(kind="motion", clips=["honey"], mood="pulse", bed=["lobby"], fx=["glow"], moves=["push_in", "punch"],
         vo=("H", "You want to stop being the ones who get shot at? Then come sit in the VIP. There's a man from Houston you should meet.")),
    dict(kind="motion", clips=["wick"], bed=["lobby"], fx=["glow", "flicker"], slam="BIG WICK", moves=["dolly", "punch"],
         vo=("W", "Two bricks. On credit. You pay on time, we family. You don't pay, don't ever come back to my table.")),
    dict(kind="motion", clips=["kebo"], bed=["lobby"], fx=["glow"], moves=["push_in", "punch"],
         vo=("K", "Two kilos, fronted. That's sixty thousand dollars we don't have. I'll do the math tonight.")),
    # tension: St. Bernard Avenue
    dict(kind="motion", clips=["night_drive"], mood="tension", bed=["night"], fx=["glow"], sfx=[("engine", 0.0, 0.5)], moves=["track", "punch"],
         vo=("N", "On the ride home down St. Bernard Avenue, nobody said a word.")),
    dict(kind="motion", clips=["blue_lights"], bed=["night"], fx=["flicker"], sfx=[("sirens", 0.0, 0.8)], slam="NOPD", moves=["crash_zoom", "punch"],
         vo=("N", "Then the blue lights.")),
    dict(kind="motion", clips=["thib"], bed=["night"], fx=["flicker"], sfx=[("footsteps", 0.0, 0.6)], moves=["push_in", "punch"],
         vo=("N", "Detective Ray Thibodeaux. Twenty five years with the New Orleans Police. Charming. Catholic. Deadly.")),
    dict(kind="motion", clips=["glock_seat"], bed=["night"], fx=["flicker"], moves=["push_in", "crash_zoom"],
         vo=("X", "Well now. Whose Glock is this under the seat? Don't everybody speak at once.")),
    dict(kind="motion", clips=["tbone"], bed=["night"], fx=["flicker"], moves=["punch", "push_in"],
         vo=("T", "Man, that ain't, that's... come on, officer.")),
    dict(kind="motion", clips=["thib_close"], bed=["night"], fx=["flicker"], slam="20%", moves=["crash_zoom", "punch"],
         vo=("X", "Detective. And relax. I don't want you in handcuffs. I want twenty percent of everything. And I want those Plank Road boys gone from my Seventh Ward.")),
    # heart: Dre's first bar
    dict(kind="motion", clips=["dre"], mood="heart", bed=["hum"], fx=["glow"], moves=["push_in", "punch"], hush=True,
         vo=("R", "Under the bridge where the brass get loud. Seventh Ward raised me, I'm a son of the crowd.")),
    # dread: the kitchen
    dict(kind="motion", clips=["bricks_jesus"], mood="dread", bed=["hum"], fx=["dust", "beam"], sfx=[("heartbeat", 0.0, 0.6)], moves=["crane_down", "punch"],
         vo=("N", "Kebo's grandmother's shotgun house. Two bricks on the kitchen table, next to a framed picture of Jesus.")),
    dict(kind="motion", clips=["draco"], bed=["hum"], fx=["flicker"], sfx=[("impact", 0.6, 0.4)], moves=["push_in", "crash_zoom"],
         vo=("N", "T-Bone loaded the Draco. Dre whispered his first bar into his phone. Kebo counted. Nobody slept.")),
    dict(kind="card", text="NOW", dur=2.0, small=True, sfx=[("impact", 0.0, 0.8)]),
    # climax
    dict(kind="motion", clips=["locs"], offset=2.0, mood="climax", bed=["hum"], fx=["glow"], sfx=[("riser", 0.0, 0.9)], slam="OWN THE BLOCK", flash=True, moves=["crash_zoom"], min_dur=5.5,
         vo=("L", "We don't stop till we own the block.")),
] + tail("TWO", "SHOTGUN HOUSE")

REUSE = {k: v for k, v in {**CAST, **SCENES}.items()}
GHOST = {
 "indians": "New Orleans Mardi Gras Indians on Super Sunday parading under the Claiborne Avenue overpass, enormous hand-sewn beaded and feathered suits in brilliant yellow and turquoise, a crowd and a brass band behind them, bright afternoon light, documentary photo",
 "scatter": "a crowded street parade under a highway overpass in New Orleans breaking apart in panic, people running in every direction, a dropped feathered fan and a sneaker on the asphalt in the foreground, motion blur, no blood",
 "waiting_room": "a hospital emergency waiting room at night in New Orleans, rows of plastic chairs, a worried family silhouetted, vending machine glow, fluorescent light, empty coffee cups",
 "katrina_roof": "black and white style archival look: the roof of a small flooded house in the Lower Ninth Ward in 2005, brown floodwater up to the gutters, a woman holding a baby on the roof, gray storm sky, rain",
 "glock_seat": "a police flashlight beam lighting a black pistol under the passenger seat of an old car at night, blue police light glow on the dashboard",
 "bricks_jesus": "two tightly taped rectangular packages on an old kitchen table in a New Orleans shotgun house, beside a framed vintage picture of Jesus, a lace tablecloth, a single bulb, crime drama film still",
 "draco": "close-up of hands loading a magazine into a short AK-pattern pistol on a kitchen table at night, a gym bag beside it, harsh lamp light, crime drama film still",
}
