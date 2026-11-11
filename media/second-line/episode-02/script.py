"""Second Line, Episode 2: Shotgun House (uploaded bible). Kebo builds the operation; Locs pays his mother's light bill;
Dre records "Under the Bridge" at Mud Bug Sound with Miss Odile; Saint's Bloods rob a corner on Elysian Fields and
pistol-whip a 17-year-old runner; Honey shows Locs how the Quarter washes money; T-Bone doesn't wait.
Closing: St. Claude Avenue, the Draco out the window, the rounds miss Saint; Kebo, shaking, stares at his hands."""
import sys
sys.path.insert(0, "/tmp/claude-0/-home-user-Video/e94a2179-1832-5221-bb24-9d181da3a815/scratchpad/secondline")
from common import CAST, SCENES, tail
EP1 = "/tmp/claude-0/-home-user-Video/e94a2179-1832-5221-bb24-9d181da3a815/scratchpad/secondline/ep1/img"
EP2 = "/tmp/claude-0/-home-user-Video/e94a2179-1832-5221-bb24-9d181da3a815/scratchpad/secondline/ep2/img"
EP3 = "/tmp/claude-0/-home-user-Video/e94a2179-1832-5221-bb24-9d181da3a815/scratchpad/secondline/ep3/img"

SHOTS = [
    dict(kind="motion", clips=["bricks_jesus"], mood="dread", bed=["hum"], fx=["dust", "beam"], sfx=[("heartbeat", 0.0, 0.4)], moves=["push_in", "punch"],
         vo=("N", "Last time, a stray bullet hit Jojo at a second line, Big Wick fronted them two kilos, and a detective made them his.")),
    dict(kind="card", text="SECOND LINE", sub="EPISODE TWO", dur=4.0, font="cinzel", sfx=[("impact", 0.2, 0.9)]),
    dict(kind="card", text="SHOTGUN HOUSE", dur=2.6, sfx=[("impact", 0.3, 0.5)]),
    # cold: the business
    dict(kind="motion", clips=["kebo"], mood="cold", bed=["hum"], fx=["dust"], moves=["push_in", "punch"],
         vo=("K", "Three corners. Phones change every two weeks. And every dollar goes in Grandma's church donation book, in code.")),
    dict(kind="motion", clips=["ledger"], bed=["hum"], fx=["dust", "beam"], moves=["crane_down", "punch"],
         vo=("N", "Kebo ran it like the business plan he wrote for the scholarship he lost. The money was real, and it was fast.")),
    dict(kind="motion", clips=["light_bill"], bed=["morning"], fx=["dust"], moves=["push_in", "punch"],
         vo=("N", "For the first time in his life, Locs paid his mother's light bill. Celeste didn't ask where the money came from.")),
    # memory / heart: the studio
    dict(kind="motion", clips=["mudbug"], mood="memory", bed=["hum"], fx=["glow", "dust"], moves=["dolly", "punch"],
         vo=("N", "Mud Bug Sound, in Gentilly. Miss Odile recorded bounce legends here in the nineties. The tape machines still work.")),
    dict(kind="motion", clips=["dre"], bed=["hum"], fx=["glow"], moves=["push_in", "punch"], hush=True,
         vo=("R", "Under the bridge where the brass get loud. Seventh Ward raised me, I'm a son of the crowd.")),
    dict(kind="motion", clips=["odile"], mood="heart", bed=["hum"], fx=["glow", "dust"], moves=["push_in", "punch"],
         vo=("O", "You got that old bounce in you, baby. Don't let them streets take it.")),
    # grief: the robbery
    dict(kind="motion", clips=["elysian_corner"], mood="grief", bed=["night"], fx=["flicker", "fog"], sfx=[("impact", 0.4, 0.6), ("sirens", 2.0, 0.4)], slam="ELYSIAN FIELDS", moves=["crash_zoom", "punch"],
         vo=("N", "Then Saint's Bloods hit their corner on Elysian Fields. They took the package and pistol-whipped a seventeen year old runner in front of his little sister.")),
    dict(kind="motion", clips=["saint"], bed=["night"], fx=["flicker"], moves=["push_in", "punch"],
         vo=("S", "Tell your boys the Seventh Ward got new owners. Plank Road don't ask permission.")),
    # pulse: T-Bone vs Locs
    dict(kind="motion", clips=["tbone_close"], mood="pulse", bed=["hum"], fx=["flicker"], moves=["crash_zoom", "punch"],
         vo=("T", "They put hands on a child, Locs! On our corner! And you want to sit here and think?")),
    dict(kind="motion", clips=["locs"], bed=["hum"], fx=["glow"], moves=["push_in", "punch"],
         vo=("L", "I want to win. Patience. Saint wants us to come running. That's how you end up on a T-shirt.")),
    # tension: Honey's lesson
    dict(kind="motion", clips=["honey"], mood="tension", bed=["lobby"], fx=["glow"], moves=["push_in", "punch"],
         vo=("H", "You see Lucien Fontenot's office? Dirty cash goes in that door. Clean receipts come out. Think like a businessman, baby, not a soldier.")),
    dict(kind="motion", clips=["lucien"], bed=["lobby"], fx=["glow", "flicker"], moves=["dolly", "punch"],
         vo=("N", "Lucien Fontenot owned The Velvet Bayou, and the receipts of half the French Quarter.")),
    # dread: T-Bone doesn't wait
    dict(kind="motion", clips=["tbone"], mood="dread", bed=["night"], fx=["flicker"], sfx=[("cardoor", 0.2, 0.6)], moves=["push_in", "punch"],
         vo=("T", "Kebo. Get your keys. You driving.")),
    dict(kind="card", text="ST. CLAUDE AVENUE", sub="MIDNIGHT", dur=2.6, small=True, sfx=[("impact", 0.0, 0.6)]),
    # climax
    dict(kind="motion", clips=["st_claude"], mood="climax", bed=["night"], fx=["flicker", "glow"], sfx=[("ak_burst", 0.5, 1.0), ("casings", 1.4, 0.7)], slam="ST. CLAUDE", flash=True, moves=["crash_zoom", "punch"], min_dur=4.5,
         vo=("N", "T-Bone hung out the window with the Draco.")),
    dict(kind="motion", clips=["shredded_car"], bed=["night"], fx=["fog", "flicker"], sfx=[("sirens", 0.5, 0.6)], moves=["push_in", "punch"],
         vo=("N", "Every round missed Saint. They shredded a parked car instead.")),
    dict(kind="motion", clips=["azaleas"], bed=["night"], fx=["fog"], moves=["crane_down", "punch"],
         vo=("N", "Kebo drove home shaking. He threw up in his grandmother's azaleas.")),
    dict(kind="motion", clips=["kebo_hands"], bed=["hum"], fx=["glow"], sfx=[("riser", 0.0, 0.9)], slam="HIS HANDS", moves=["push_in", "crash_zoom"], min_dur=5.0,
         vo=("N", "And he stared at his hands for the rest of the night.")),
] + tail("THREE", "VELVET BAYOU")

REUSE = {**CAST, **SCENES, "bricks_jesus": f"{EP1}/bricks_jesus.png"}
GHOST = {
 "ledger": "an old church donation ledger book open on a kitchen table, neat handwritten columns of names and dollar amounts, a rubber-banded stack of cash, reading glasses, lamp light, close-up",
 "light_bill": "a paid electric bill envelope with a stack of twenty dollar bills on a small New Orleans kitchen counter, morning sun through lace curtains, a rosary hanging on a hook",
 "mudbug": "a small vintage recording studio in New Orleans with an old analog mixing console, reel-to-reel tape machines, gold records and bounce music flyers on the walls, warm amber light",
 "elysian_corner": "a New Orleans street corner at night on a wide boulevard with a corner store, a dropped backpack and spilled papers on the sidewalk, a blue police light in the distance, empty, tense",
 "st_claude": "night on St. Claude Avenue in New Orleans seen from a moving car, an orange muzzle flash from a passenger window lighting the wet street, shell casings in the air, motion blur, no faces",
 "shredded_car": "a parked sedan riddled with bullet holes on a New Orleans street at night, shattered windows, glass on the asphalt, red and blue police lights arriving, no people",
 "azaleas": "pink azalea bushes in front of an old New Orleans shotgun house at night under a porch light, a car parked crooked at the curb with its door open",
 "kebo_hands": "close-up of a young Black man's trembling hands held open under a kitchen lamp at night, dark background, sweat, shallow depth of field",
}
