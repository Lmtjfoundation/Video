"""The Settlement, Episode 5: Ten O'Clock (motion graphics, vertical 1080x1920).
Picks up Episode 4's hook: Marcus heard Dre through the baby monitor. Friday night: the errand, the driveway, Tasha's drive
to call it off, Kev's dashcam at the light, the truck. Hook: the truck meant for Marcus finds her instead.
vo: N narrator, M Marcus (Kokoro); D Dre, T Tasha, K Kev (designed voices)."""

SHOTS = [
    dict(kind="motion", clips=["marcus_table"], mood="dread", bed=["rain"], fx=["rain", "flicker"], sfx=[("thunder", 0.3, 0.6), ("heartbeat", 0.0, 0.5)], moves=["push_in", "punch"],
         vo=("N", "Last time, through the static of an old baby monitor, Marcus heard the plan. Ten o'clock. Telephone Road. Make sure he drives.")),
    dict(kind="motion", clips=["clock"], bed=["rain"], fx=["glow"], sfx=[("heartbeat", 0.0, 0.5)], slam="FRIDAY", moves=["crash_zoom"], min_dur=3.4,
         vo=("N", "Friday came anyway.")),
    dict(kind="card", text="THE SETTLEMENT", sub="EPISODE FIVE", dur=4.0, font="cinzel", sfx=[("impact", 0.2, 0.9)]),
    dict(kind="card", text="TEN O'CLOCK", dur=2.6, sfx=[("impact", 0.3, 0.5)]),
    dict(kind="card", text="FRIDAY", sub="9:14 PM", dur=2.8, small=True, sfx=[("thunder", 0.0, 0.4)]),
    # cold: the errand
    dict(kind="motion", clips=["tasha_asks"], mood="cold", bed=["rain"], fx=["glow"], moves=["track", "punch"],
         vo=("T", "Baby, can you run up to the pharmacy on Telephone Road before ten? My prescription's ready.")),
    dict(kind="motion", clips=["marcus_yes"], bed=["rain"], fx=["glow"], moves=["push_in", "punch"],
         vo=("M", "Yeah. I'll go.")),
    dict(kind="motion", clips=["tasha_away"], bed=["rain"], fx=["glow"], moves=["dolly", "punch"],
         vo=("N", "He said yes. And he watched her face. For the first time in twelve years, she couldn't look at him.")),
    dict(kind="card", text="HOUSTON, 2012", dur=2.6, small=True, sfx=[("sirens", 0.0, 0.3)]),
    # memory: the other car
    dict(kind="motion", clips=["car_2012"], mood="memory", bed=["rain"], fx=["rain", "glow"], moves=["push_in", "punch"],
         vo=("N", "Twelve years ago, she leaned across a front seat and said, get in this car, or I'm done with you. He got in.")),
    dict(kind="motion", clips=["corner_2012"], bed=["rain"], fx=["rain"], moves=["pull_back", "track"],
         vo=("N", "Tonight, she was asking him to get in another one.")),
    # grief
    dict(kind="motion", clips=["tasha_mirror"], mood="grief", bed=["hum"], fx=["flicker"], sfx=[("door", 0.2, 0.4)], moves=["push_in", "punch"],
         vo=("N", "Upstairs, Tasha locked the bathroom door and ran the water so he wouldn't hear her.")),
    dict(kind="motion", clips=["tasha_mirror"], offset=2.0, bed=["hum"], fx=["flicker", "glow"], moves=["punch", "dolly"], hush=True,
         vo=("T", "What did I do? Lord, what did I do?")),
    dict(kind="card", text="9:41 PM", dur=2.2, small=True, sfx=[("impact", 0.1, 0.45)]),
    # pulse: the driveway
    dict(kind="motion", clips=["keys_rain"], mood="pulse", bed=["rain"], fx=["rain"], sfx=[("keys", 0.4, 0.8), ("cardoor", 2.2, 0.8)], moves=["crane_down", "punch"],
         vo=("N", "Marcus took his keys, walked out into the rain, and climbed into the truck.")),
    dict(kind="motion", clips=["truck_driveway"], bed=["rain"], fx=["rain", "glow"], sfx=[("engine", 0.5, 0.4)], moves=["dolly", "punch", "push_in"],
         vo=("N", "He turned the key halfway. The wipers came on. He never put it in drive.")),
    dict(kind="motion", clips=["marcus_wait"], bed=["rain"], fx=["rain"], moves=["push_in", "punch"],
         vo=("M", "Come on, Tasha. Come out that door and stop me.")),
    # tension: Kev at the light
    dict(kind="motion", clips=["kev_cab"], mood="tension", bed=["rain"], fx=["rain", "glow"], sfx=[("engine", 0.0, 0.25)], moves=["track", "punch"],
         vo=("N", "Three miles away, Kev's tow truck sat at the light on Telephone Road, the way it did every Friday.")),
    dict(kind="motion", clips=["dashcam"], bed=["rain"], fx=["flicker"], slam="REC", moves=["push_in", "crash_zoom"],
         vo=("K", "Eighteen wheeler. No load. No plates I can read. Third time around this block. Camera's on you, buddy.")),
    dict(kind="motion", clips=["big_rig"], bed=["rain"], fx=["rain", "glow"], sfx=[("engine", 0.3, 0.6)], moves=["pull_back", "punch"],
         vo=("N", "The truck idled in the dark behind the gas station. Lights off. Waiting for a white pickup.")),
    # heart: Tasha goes
    dict(kind="motion", clips=["tasha_keys"], mood="heart", bed=["rain"], fx=["rain"], sfx=[("keys", 0.3, 0.7), ("door", 1.2, 0.8)], moves=["push_in", "punch"],
         vo=("T", "I'm not doing this. I'm not.")),
    dict(kind="motion", clips=["tasha_driving"], bed=["rain"], fx=["rain", "glow"], sfx=[("engine", 0.0, 0.5)], moves=["dolly", "punch", "track"],
         vo=("N", "She ran past the truck in the driveway without seeing him in it. She drove to Telephone Road to call it off. She did.")),
    # dread
    dict(kind="motion", clips=["dre_phone"], mood="dread", bed=["rain"], fx=["rain"], moves=["push_in", "punch"],
         vo=("D", "White truck or not, somebody's coming down that road at ten. Don't you call me again.")),
    dict(kind="motion", clips=["tasha_call"], bed=["rain"], fx=["rain", "flicker"], sfx=[("hangup", 1.0, 0.8)], moves=["crash_zoom", "punch"],
         vo=("T", "Dre! Dre, call it off! He's not coming!")),
    dict(kind="card", text="9:58 PM", dur=2.0, small=True, sfx=[("impact", 0.0, 0.8)]),
    # climax
    dict(kind="motion", clips=["intersection"], mood="climax", bed=["rain"], fx=["rain", "glow"], sfx=[("heartbeat", 0.0, 0.7)], moves=["push_in", "punch"],
         vo=("N", "The light on Telephone Road turned red. One car stopped under it. Kev's dashcam caught the plate. It wasn't Marcus.")),
    dict(kind="motion", clips=["headlights"], bed=["rain"], fx=["rain", "glow", "shake"], sfx=[("riser", 0.0, 1.0)], moves=["crash_zoom"], min_dur=4.0,
         vo=("N", "The truck meant for Marcus Grant found his wife instead.")),
    dict(kind="motion", clips=["glass"], bed=["rain"], fx=["shatter", "shake"], sfx=[("impact", 0.0, 1.0), ("thunder", 0.4, 0.6)], slam="10:00", flash=True, moves=["crash_zoom"], min_dur=3.4,
         vo=None),
    dict(kind="motion", clips=["marcus_phone"], bed=["rain"], fx=["rain", "flicker"], sfx=[("phonebuzz", 0.2, 0.9)], moves=["push_in", "punch"], min_dur=5.0,
         vo=("K", "Marcus. It's Kev. It's Tasha. You need to get down here. Now.")),
    dict(kind="black", dur=1.4, sfx=[("impact", 0.0, 1.0)]),
    dict(kind="card", text="EPISODE SIX", sub="THE FOURTH FLOOR", dur=4.0, sfx=[("impact", 0.2, 0.5)]),
    dict(kind="card", text="THE SETTLEMENT", sub="WHOSE SIDE ARE YOU ON?", dur=4.0, end=True, font="cinzel", sfx=[("impact", 0.1, 0.6)]),
]

REUSE = {"dre_phone": "ep4/img/dre_phone.png", "car_2012": "/home/user/content-wt/media/the-settlement/episode-01/car.png",
         "corner_2012": "/home/user/content-wt/media/the-settlement/episode-01/corner.png"}
PICTURES = {
    "marcus_table": (["marcus"], "The man from the reference photo (Marcus, heavyset Black man early 40s, short beard, navy work shirt) sits alone at a dark kitchen table at night, staring at a phone face down in front of him, rain streaming down the window behind him, one lamp."),
    "clock": ([], "Close-up of a kitchen wall clock at 9:14 at night, rain-streaked window reflected in its glass, dim warm light."),
    "tasha_asks": (["tasha", "marcus"], "Night kitchen: the woman from the first reference photo (Tasha, Black woman mid 30s, gold hoops, cardigan) stands by the counter holding car keys out toward the man from the second reference photo (Marcus), forcing a smile; rain on the window."),
    "marcus_yes": (["marcus"], "Close-up of the man from the reference photo (Marcus) in a dim kitchen at night, nodding slowly, eyes locked on someone off camera, calm but heartbroken."),
    "tasha_away": (["tasha"], "Close-up of the woman from the reference photo (Tasha) in a dim kitchen at night turning her face away, eyes down, guilt and fear, lamp light on her cheek."),
    "tasha_mirror": (["tasha"], "The woman from the reference photo (Tasha) grips a bathroom sink at night staring at her own reflection in the mirror, tears running, faucet running, harsh vanity light."),
    "keys_rain": (["marcus"], "The man from the reference photo (Marcus, rain jacket) walks across a dark suburban driveway in pouring rain toward a white work pickup truck, keys in hand, porch light behind him."),
    "truck_driveway": ([], "A white work pickup truck parked in a dark suburban driveway at night in heavy rain, wipers moving, dashboard glow inside, headlights off, the house lit behind it."),
    "marcus_wait": (["marcus"], "The man from the reference photo (Marcus) sits behind the wheel of a parked pickup truck at night in heavy rain, engine off, hands on the wheel, staring at the front door of his house, dashboard glow on his face."),
    "kev_cab": (["kev"], "The man from the reference photo (Kev, Black man in his 50s, glasses, gray beard, plaid flannel, Rockets cap) sits in the cab of a tow truck at a red light at night in heavy rain, watching the road, a dashcam glowing on the windshield."),
    "dashcam": ([], "Close-up of a dashcam screen mounted on a windshield at night showing a rainy intersection, red REC dot and timestamp 21:52, rain on the glass, Telephone Road street sign blurred beyond."),
    "big_rig": ([], "A big eighteen-wheeler truck with no trailer idling in the dark behind a closed gas station at night in heavy rain, headlights off, exhaust in the cold air, menacing."),
    "tasha_keys": (["tasha"], "The woman from the reference photo (Tasha, cardigan, gold hoops) rushes down a dark hallway toward the front door at night grabbing car keys, panicked and determined, rain visible through the door glass."),
    "tasha_driving": (["tasha"], "The woman from the reference photo (Tasha) drives a car at night in pouring rain, crying, gripping the wheel, wipers fighting the water, red and green traffic lights smeared on the windshield."),
    "tasha_call": (["tasha"], "Close-up of the woman from the reference photo (Tasha) in a car at night holding a black flip phone to her ear, screaming, rain hammering the windows, red light on her face."),
    "intersection": ([], "Wide shot of a rain-soaked intersection at night on Telephone Road in Houston, a single small car stopped at a red light, a tow truck parked on the corner, wet asphalt mirroring the lights."),
    "headlights": ([], "View from inside a small car at night in heavy rain: blinding headlights of a huge truck filling the side window, rain droplets lit up white, motion blur, terrifying."),
    "glass": ([], "Abstract close-up of a car window shattering at night, shards of glass and rain drops frozen in the air, lit white by headlights, dark background, no people."),
    "marcus_phone": (["marcus"], "The man from the reference photo (Marcus) in the driver seat of a parked pickup truck at night, phone pressed to his ear, face collapsing in horror, rain on the windshield, dashboard glow."),
}
