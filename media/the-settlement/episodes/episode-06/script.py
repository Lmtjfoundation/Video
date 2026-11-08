"""The Settlement, Episode 6: The Fourth Floor (motion graphics, vertical 1080x1920).
Picks up Episode 5's crash. The ER, Kev's dashcam, three weeks on the fourth floor, a detective's question, Dre signing in
as her cousin. Hook: Tasha wakes and says, "You were supposed to be there."
vo: N narrator, M Marcus, X detective (Kokoro); D Dre, T Tasha, K Kev (designed voices)."""

SHOTS = [
    dict(kind="motion", clips=["er_doors"], mood="dread", bed=["rain"], fx=["rain", "flicker"], sfx=[("sirens", 0.0, 0.5), ("heartbeat", 0.0, 0.5)], moves=["dolly", "punch"],
         vo=("N", "Last time, the truck meant for Marcus Grant found his wife instead.")),
    dict(kind="motion", clips=["corridor"], bed=["hum"], fx=["flicker"], sfx=[("monitor", 0.3, 0.6)], slam="ROOM 412", moves=["push_in", "punch"],
         vo=("N", "Fourth floor. Room four twelve.")),
    dict(kind="card", text="THE SETTLEMENT", sub="EPISODE SIX", dur=4.0, font="cinzel", sfx=[("impact", 0.2, 0.9)]),
    dict(kind="card", text="THE FOURTH FLOOR", dur=2.6, sfx=[("impact", 0.3, 0.5)]),
    dict(kind="card", text="THAT NIGHT", sub="10:41 PM", dur=2.6, small=True, sfx=[("sirens", 0.0, 0.3)]),
    # cold: the ER
    dict(kind="motion", clips=["marcus_er"], mood="cold", bed=["hum"], fx=["flicker"], sfx=[("footsteps", 0.2, 0.7)], moves=["track", "punch"],
         vo=("N", "Marcus ran through the emergency room soaked to the skin. Kev was already there, his cap in his hands.")),
    dict(kind="motion", clips=["kev_er"], bed=["hum"], fx=["flicker"], moves=["push_in", "punch"],
         vo=("K", "She was at the light, Marcus. By herself. I got all of it. Every second. It's on the camera.")),
    dict(kind="motion", clips=["marcus_er"], offset=2.0, bed=["hum"], fx=["flicker"], moves=["punch", "push_in"],
         vo=("M", "Don't say that out loud. Not in here. Not yet.")),
    dict(kind="card", text="HOUSTON, 2012", dur=2.6, small=True, sfx=[("thunder", 0.0, 0.4)]),
    # memory
    dict(kind="motion", clips=["car_2012"], mood="memory", bed=["rain"], fx=["rain", "glow"], moves=["pull_back", "punch"],
         vo=("N", "Twelve years ago, she pulled him off a corner with one sentence. Tonight he couldn't pull her out of anything.")),
    # grief: three weeks
    dict(kind="motion", clips=["bedside"], mood="grief", bed=["hum"], fx=["dust", "beam"], sfx=[("monitor", 0.0, 0.5)], slam="3 WEEKS", moves=["crane_down", "punch", "push_in"],
         vo=("N", "Three weeks. She lived, barely. He slept in the chair by her bed and never once went home.")),
    dict(kind="motion", clips=["marcus_chair"], bed=["hum"], fx=["dust"], moves=["push_in", "punch"],
         vo=("M", "Doctors say you can hear me. So hear me. I'm still here.")),
    dict(kind="card", text="DAY 19", dur=2.2, small=True, sfx=[("impact", 0.1, 0.45)]),
    # pulse: the detective
    dict(kind="motion", clips=["detective"], mood="pulse", bed=["hum"], fx=["flicker"], sfx=[("footsteps", 0.0, 0.5)], moves=["track", "punch"],
         vo=("X", "Mister Grant. Detective Ruiz, Dallas P.D. That truck came out of a Dallas yard, so it's my case too. Your wife was on Telephone Road at ten o'clock on a Friday night. Why'd you stay home?")),
    dict(kind="motion", clips=["marcus_chair"], offset=2.0, bed=["hum"], fx=["dust"], moves=["punch", "dolly"],
         vo=("M", "She asked me to go to the pharmacy. I didn't feel like driving in the rain.")),
    dict(kind="motion", clips=["detective_phone"], bed=["hum"], fx=["flicker"], slam="WHITE PICKUP", moves=["crash_zoom", "punch"],
         vo=("X", "Funny thing. The truck driver's phone has a text from a prepaid number. It says, white pickup, ten o'clock. You drive a white pickup, Mister Grant?")),
    # tension: Dre signs in
    dict(kind="motion", clips=["sign_in"], mood="tension", bed=["hum"], fx=["dust"], sfx=[("pen", 0.5, 0.7)], slam="COUSIN", moves=["push_in", "crane_down"],
         vo=("N", "That afternoon, while Marcus was down in the cafeteria, a visitor signed in at the fourth floor desk. Andre Davis. Relationship: cousin.")),
    dict(kind="motion", clips=["dre_bedside"], bed=["hum"], fx=["flicker"], sfx=[("monitor", 0.0, 0.4)], moves=["dolly", "punch"],
         vo=("D", "You did good, Tasha. Trucking company's gonna pay. Big. You keep your mouth shut, and we both eat.")),
    # heart
    dict(kind="motion", clips=["flowers"], mood="heart", bed=["hum"], fx=["dust", "beam"], moves=["push_in", "punch"],
         vo=("N", "When Marcus came back, there were roses on the table. The card said, from your cousin. Tasha didn't have a cousin.")),
    dict(kind="motion", clips=["hand_hold"], bed=["hum"], fx=["dust", "glow"], moves=["crane_down", "punch"], hush=True,
         vo=("M", "Come back to me, Tasha. Then you can tell me everything. Every bit of it.")),
    # dread
    dict(kind="motion", clips=["monitor_night"], mood="dread", bed=["hum"], fx=["glow", "flicker"], sfx=[("monitor", 0.0, 0.8), ("heartbeat", 0.0, 0.6)], moves=["push_in", "crash_zoom"],
         vo=("N", "Day twenty one. Two in the morning. The monitor changed its rhythm.")),
    dict(kind="card", text="NOW", dur=2.0, small=True, sfx=[("impact", 0.0, 0.8)]),
    # climax
    dict(kind="motion", clips=["tasha_wakes"], mood="climax", bed=["hum"], fx=["glow"], sfx=[("heartbeat", 0.0, 0.7)], moves=["push_in", "punch"],
         vo=("N", "Her eyes opened. She found him in the dark. And the first thing she said in three weeks was not his name.")),
    dict(kind="motion", clips=["tasha_close"], bed=["hum"], fx=["glow"], sfx=[("riser", 0.0, 0.9)], slam="YOU WERE SUPPOSED TO BE THERE", flash=True, moves=["crash_zoom"], min_dur=5.5,
         vo=("T", "You were supposed to be there.")),
    dict(kind="black", dur=1.4, sfx=[("impact", 0.0, 1.0)]),
    dict(kind="card", text="EPISODE SEVEN", sub="TWENTY MILLION", dur=4.0, sfx=[("impact", 0.2, 0.5)]),
    dict(kind="card", text="THE SETTLEMENT", sub="WHOSE SIDE ARE YOU ON?", dur=4.0, end=True, font="cinzel", sfx=[("impact", 0.1, 0.6)]),
]

REUSE = {"car_2012": "/home/user/content-wt/media/the-settlement/episode-01/car.png"}
PICTURES = {
    "er_doors": ([], "Hospital emergency entrance at night in pouring rain, red EMERGENCY sign glowing, an ambulance with lights flashing, sliding glass doors, wet pavement reflections, Houston."),
    "corridor": ([], "Empty hospital corridor on the fourth floor at night, one flickering ceiling light, a door marked 412 half open with monitor glow inside, polished floor reflections."),
    "marcus_er": (["marcus"], "The man from the reference photo (Marcus, heavyset Black man early 40s, short beard) runs through a bright hospital emergency room hallway soaked with rain, panic on his face, nurses blurred in the background."),
    "kev_er": (["kev"], "The man from the reference photo (Kev, Black man in his 50s, glasses, gray beard, plaid flannel) stands in a hospital waiting area at night holding his Houston Rockets cap in both hands, shaken, harsh fluorescent light."),
    "bedside": (["tasha", "marcus"], "Hospital room at night: the woman from the first reference photo (Tasha) lies unconscious in the bed with bandages and an oxygen tube, monitors glowing; the man from the second reference photo (Marcus) sleeps slumped in a chair beside her, holding her hand."),
    "marcus_chair": (["marcus"], "Close-up of the man from the reference photo (Marcus), exhausted, unshaven, sitting in a hospital chair at night, eyes red, monitor light on his face."),
    "detective": ([], "A plainclothes Latino Dallas police detective in his 50s with a gray mustache and a rumpled tan suit, badge on his belt, standing in a hospital room doorway holding a small notebook, skeptical expression, fluorescent light."),
    "detective_phone": ([], "Close-up of a detective's hand holding a smartphone in an evidence bag, the screen showing a text message that reads: white pickup 10:00, hospital room blurred behind."),
    "sign_in": ([], "Close-up of a hospital visitor sign-in sheet on a clipboard at a nurses' station, a handwritten line reading Andre Davis, Room 412, Relationship: Cousin, a pen lying across it."),
    "dre_bedside": (["dre", "tasha"], "Hospital room in afternoon light: the man from the first reference photo (Dre, short twists, goatee, gold chain, black hoodie) leans over the bed whispering to the unconscious woman from the second reference photo (Tasha), a bouquet of red roses on the table, cold smile."),
    "flowers": ([], "A bouquet of red roses in a vase on a hospital bedside table with a small white card reading From your cousin, monitor glow, soft window light."),
    "hand_hold": (["marcus"], "Close-up of a man's large hand (the man from the reference photo, Marcus) holding a woman's limp hand with a hospital ID bracelet and an IV line, white sheets, soft light."),
    "monitor_night": ([], "Close-up of a hospital heart monitor at night, green line spiking, numbers changing, dark room behind it, glow on the bed rail."),
    "tasha_wakes": (["tasha"], "The woman from the reference photo (Tasha) in a hospital bed at night, bandage on her forehead, slowly opening her eyes, monitor light on her face, a man's silhouette blurred in the foreground."),
    "tasha_close": (["tasha"], "Extreme close-up of the woman from the reference photo (Tasha) in a hospital bed at night, bandaged, eyes open and wet, staring straight at camera with accusation, cold blue monitor light."),
}

GHOST = {
    "detective": "a plainclothes Latino police detective in his 50s with a gray mustache, NOT in uniform, wearing a rumpled tan civilian suit jacket, white shirt and loosened brown tie, a gold badge clipped to his belt, standing in a hospital room doorway holding a small notebook, skeptical expression, fluorescent light",
}
