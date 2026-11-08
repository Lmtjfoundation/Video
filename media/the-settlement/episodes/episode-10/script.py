"""The Settlement, Episode 10: The Settlement (finale, motion graphics, vertical 1080x1920).
Two recordings (Kev's tape, Tasha's Room 412 recording), one settlement, one meeting with Dre, who thinks he's getting paid.
Detective Ruiz (Dallas P.D., Episode 6) brings Houston P.D.; Dre is arrested on Telephone Road at ten o'clock. Tasha takes
a plea for the fraud so Marcus's name stays clean; the settlement pays off his mother's house (Texas lenders file a
Release of Lien once a loan is paid). Mirror of 2012: she's in the back of a police car, he's on the curb. Then the twist: Keisha Davis, Dre's sister,
at his door with a twelve-year-old boy, Marcus's secret son (conceived in 2012, before Tasha got him out).
vo: N narrator, X detective (Kokoro); M Marcus, T Tasha, D Dre, K Kev, S Keisha (Ghost Post Chatterbox clones;
Keisha's voice designed with Parler)."""

SHOTS = [
    dict(kind="motion", clips=["marcus_monitor"], mood="dread", bed=["hum"], fx=["flicker"], sfx=[("heartbeat", 0.0, 0.5)], moves=["push_in", "punch"],
         vo=("N", "Last time, he told her he'd heard everything. And she played him what she'd heard.")),
    dict(kind="motion", clips=["voice_memo"], bed=["hum"], fx=["glow"], moves=["push_in", "punch"], monitor=True,
         vo=("D", "Ten million by Friday, or I start talking.")),
    dict(kind="card", text="THE SETTLEMENT", sub="EPISODE TEN", dur=4.0, font="cinzel", sfx=[("impact", 0.2, 0.9)]),
    dict(kind="card", text="THE SETTLEMENT", sub="FINALE", dur=2.6, small=True, sfx=[("impact", 0.3, 0.5)]),
    # cold: the plan
    dict(kind="motion", clips=["bed_talk"], mood="cold", bed=["hum"], fx=["dust"], moves=["track", "punch"],
         vo=("N", "Two recordings. One settlement. And one man who still thought he was getting paid.")),
    dict(kind="motion", clips=["tasha_kitchen"], bed=["morning"], fx=["dust"], moves=["push_in", "punch"],
         vo=("T", "He wants his money Friday. So let's give him Friday.")),
    dict(kind="motion", clips=["kev_marcus"], bed=["hum"], fx=["dust"], moves=["dolly", "punch"],
         vo=("K", "You sure about this, Marcus? Once that tape goes in, it don't come back out.")),
    dict(kind="motion", clips=["marcus_watch"], bed=["hum"], fx=["dust", "beam"], moves=["push_in", "punch"],
         vo=("M", "That's the point. No more old ways.")),
    # pulse: the detective
    dict(kind="motion", clips=["detective"], mood="pulse", bed=["hum"], fx=["flicker"], sfx=[("footsteps", 0.0, 0.5)], moves=["track", "punch"],
         vo=("N", "They took both recordings to Detective Ruiz. The tape, and her phone.")),
    dict(kind="motion", clips=["detective"], offset=2.0, bed=["hum"], fx=["flicker"], moves=["punch", "push_in"],
         vo=("X", "Telephone Road is Houston's call, not mine. I'll bring them with me. You just get him to that light.")),
    dict(kind="motion", clips=["dre_phone"], bed=["night"], fx=["glow"], moves=["push_in", "punch"],
         vo=("T", "Friday. Ten o'clock. Telephone Road. Come get your money.")),
    dict(kind="motion", clips=["dre_counting"], bed=["night"], fx=["glow"], moves=["dolly", "punch"],
         vo=("D", "See? That's all I ever wanted. Ten o'clock.")),
    # tension: Friday, ten o'clock
    dict(kind="card", text="FRIDAY", sub="9:58 PM", dur=2.6, small=True, sfx=[("thunder", 0.0, 0.4)]),
    dict(kind="motion", clips=["intersection"], mood="tension", bed=["rain"], fx=["rain"], sfx=[("traffic", 0.0, 0.4)], moves=["push_in", "punch"],
         vo=("N", "Same light. Same rain. Kev's tow truck at the corner, camera running.")),
    dict(kind="motion", clips=["dre_car"], bed=["rain"], fx=["rain", "glow"], sfx=[("cardoor", 0.4, 0.6)], slam="10:00", moves=["track", "punch"],
         vo=("N", "At ten o'clock exactly, Dre pulled up under the red light, looking for a woman with a bag of money.")),
    dict(kind="motion", clips=["arrest"], bed=["rain"], fx=["rain", "flicker"], sfx=[("sirens", 0.0, 0.8), ("cuffs", 2.0, 0.8)], slam="HOUSTON P.D.", moves=["crash_zoom", "punch", "push_in"],
         vo=("N", "Instead, every light on Telephone Road turned blue. Houston P.D. Detective Ruiz, standing in the rain with a folder.")),
    dict(kind="motion", clips=["detective_phone"], bed=["rain"], fx=["rain"], moves=["push_in", "punch"],
         vo=("X", "Andre Davis. Your number's on the driver's phone. Your voice is on hers. Hands where I can see them.")),
    # memory
    dict(kind="card", text="HOUSTON, 2012", dur=2.6, small=True, sfx=[("thunder", 0.0, 0.4)]),
    dict(kind="motion", clips=["visit"], mood="memory", bed=["prison"], fx=["dust", "beam"], moves=["pull_back", "punch"],
         vo=("N", "Twelve years ago, Dre did nine years for both of them. This time he'd do it alone.")),
    # grief: the plea
    dict(kind="motion", clips=["lawyer"], mood="grief", bed=["hum"], fx=["dust"], moves=["push_in", "punch"],
         vo=("N", "Then it was Tasha's turn. The card, the loan, his name in her hand. She took a plea for the fraud, so his name would stay clean.")),
    dict(kind="motion", clips=["tasha_tears"], bed=["hum"], fx=["glow"], moves=["push_in", "punch"],
         vo=("T", "He went to prison once because of what I did to save him. Not this time. This one's mine.")),
    # heart: the house
    dict(kind="motion", clips=["lien_release"], mood="heart", bed=["morning"], fx=["dust", "beam"], slam="PAID IN FULL", moves=["crane_down", "punch"],
         vo=("N", "The first check from the settlement went to his mother's bank. Paid in full. The house his father built stayed in the family.")),
    dict(kind="motion", clips=["porch"], bed=["cicadas"], fx=["dust", "glow"], moves=["pull_back", "punch"], hush=True,
         vo=("M", "Mama, it's done. Nobody's taking this house.")),
    # dread
    dict(kind="motion", clips=["police_car"], mood="dread", bed=["night"], fx=["glow", "flicker"], sfx=[("cruiser", 0.0, 0.5)], moves=["push_in", "punch"],
         vo=("N", "The day she turned herself in, it was raining. Just like the first night.")),
    dict(kind="card", text="NOW", dur=2.0, small=True, sfx=[("impact", 0.0, 0.8)]),
    # climax: the mirror
    dict(kind="motion", clips=["car_2012"], mood="climax", bed=["rain"], fx=["rain", "glow"], moves=["push_in", "punch"],
         vo=("N", "Twelve years ago, she pulled up to a curb and told him to get in the car. And he did.")),
    dict(kind="motion", clips=["curb"], bed=["rain"], fx=["rain", "glow"], moves=["pull_back", "push_in"], min_dur=5.0,
         vo=("N", "Now she was in the back of a police car. And he was the one standing on the curb.")),
    dict(kind="card", text="THREE PEOPLE", sub="TWO RECORDINGS. ONE SETTLEMENT.", dur=3.6, font="cinzel", sfx=[("impact", 0.2, 0.6)]),
    dict(kind="card", text="AND ONLY ONE OF THEM", sub="WALKS AWAY", dur=3.4, small=True, sfx=[("impact", 0.2, 0.7)]),
    # the twist (added to the bible at the user's request): Marcus's own secret
    dict(kind="motion", clips=["marcus_awake"], bed=["night"], fx=["glow"], sfx=[("heartbeat", 0.0, 0.5)], moves=["push_in", "punch"],
         vo=("N", "For twelve years, Marcus gave her every key, every password, every dollar. All but one.")),
    dict(kind="motion", clips=["front_door"], bed=["night"], fx=["glow", "flicker"], sfx=[("door", 0.2, 0.7)], slam="THREE DAYS LATER", moves=["push_in", "punch"],
         vo=("N", "Three days later, someone knocked on his door. Keisha Davis. Dre's little sister. And holding her hand, a boy with Marcus's eyes.")),
    dict(kind="motion", clips=["keisha"], bed=["night"], fx=["glow"], moves=["dolly", "punch"],
         vo=("S", "Hey, Marcus. It's been a long time.")),
    dict(kind="motion", clips=["keisha_son"], bed=["night"], fx=["glow"], sfx=[("riser", 0.0, 0.9)], slam="HIS SON", flash=True, moves=["crash_zoom"], min_dur=6.0,
         vo=("S", "He's twelve now. And he keeps asking about his daddy.")),
    dict(kind="black", dur=1.6, sfx=[("impact", 0.0, 1.0)]),
    dict(kind="card", text="THE SETTLEMENT", sub="WHOSE SIDE ARE YOU ON?", dur=4.5, end=True, font="cinzel", sfx=[("impact", 0.1, 0.6)]),
]

REUSE = {"marcus_monitor": "ep4/img/marcus_monitor.png", "voice_memo": "ep9/img/voice_memo.png", "bed_talk": "ep7/img/bed_talk.png",
         "tasha_kitchen": "ep3/img/tasha_kitchen.png", "kev_marcus": "ep4/img/kev_marcus.png", "marcus_watch": "ep4/img/marcus_watch.png",
         "detective": "ep6/img/detective.png", "dre_phone": "ep4/img/dre_phone.png", "dre_counting": "ep3/img/dre_counting.png",
         "intersection": "ep5/img/intersection.png", "dre_car": "ep2/img/dre_face.png", "detective_phone": "ep6/img/detective_phone.png",
         "visit": "ep2/img/visit.png", "lawyer": "ep3/img/lawyer.png", "tasha_tears": "ep3/img/tasha_tears.png", "porch": "ep4/img/porch.png",
         "car_2012": "ep5/img/car_2012.png", "curb": "ep2/img/house.png",
         "marcus_awake": "ep4/img/marcus_awake.png", "front_door": "ep2/img/front_door.png"}
GHOST = {
 "keisha_boy": "on the front porch of a Houston house at night under a yellow porch light, a Black woman in her late thirties with braids and a denim jacket, serious expression, holding the hand of a twelve-year-old Black boy in a school hoodie who looks up hopefully, the front door open, warm light spilling out",
 "arrest": "night intersection on a wet Houston street in the rain, police cars with flashing red and blue lights surrounding a stopped car under a red traffic light, officers handcuffing a man in a black hoodie seen from behind, short twists hair, his face not visible, reflections on the wet asphalt",
 "police_car": "the back seat of a police patrol car at night in the rain seen through the rear side window, a woman's silhouette sitting behind the cage partition, her face turned away and hidden, red and blue light on the wet glass",
}
# lien_release: the upscaled blank notice with a Texas Release of Lien drawn on (props/compose2.py).
