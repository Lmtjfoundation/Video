"""The Settlement, Episode 3: The Boutique (motion graphics, vertical 1080x1920).
Picks up the second Episode 2 ends: the front door opens, Tasha is home, Marcus is in the closet with her second phone.
Then Tasha's side: three years of Dre, the storefront on Almeda, the money, and the threat.
vo: (voice, text). N narrator, M Marcus (Kokoro); D Dre, T Tasha, K Kev (ElevenLabs designed voices).
Moods follow the shared score: dread, cold, memory, grief, pulse, tension, heart, dread, climax."""

SHOTS = [
    # Cold open: right where Episode 2 ended.
    dict(kind="motion", clips=["hallway"], mood="dread", bed=["rain"], fx=["rain", "fog"], sfx=[("door", 0.2, 0.7), ("keys", 1.0, 0.6), ("heartbeat", 0.0, 0.5)],
         moves=["dolly", "punch"], vo=("N", "Last time, Marcus called the only number in his wife's second phone. Dre laughed. Then the front door opened.")),
    dict(kind="motion", clips=["closet_hide"], bed=["rain"], fx=["flicker"], sfx=[("creak", 0.4, 0.6)], moves=["push_in", "punch"],
         vo=("N", "He put the phone back behind her heels. Exactly where he found it.")),
    dict(kind="motion", clips=["stairs"], bed=["rain"], fx=["glow"], sfx=[("footsteps", 0.3, 0.5)], moves=["crane_down", "punch"],
         vo=("T", "Baby? You still up?")),
    dict(kind="motion", clips=["stairs"], offset=2.0, bed=["rain"], fx=["glow"], slam="FIRST LIE", moves=["punch", "push_in"], min_dur=4.2,
         vo=("N", "Yeah, he said. And for the first time in twelve years, Marcus Grant lied to his wife.")),
    dict(kind="card", text="THE SETTLEMENT", sub="EPISODE THREE", dur=4.0, font="cinzel", sfx=[("impact", 0.2, 0.9)]),
    dict(kind="card", text="THE BOUTIQUE", dur=2.6, sfx=[("impact", 0.3, 0.5)]),
    dict(kind="card", text="ALMEDA ROAD", sub="THREE YEARS AGO", dur=3.2, small=True, sfx=[("whoop", 0.4, 0.3)]),
    # cold: the storefront
    dict(kind="motion", clips=["storefront"], mood="cold", bed=["traffic"], fx=["dust", "beam"], sfx=[("keys", 0.6, 0.6)], moves=["pull_back", "punch", "track"],
         vo=("N", "Two weeks after the bank, Dre picked her up on Almeda Road and unlocked an empty store.")),
    dict(kind="motion", clips=["storefront"], offset=2.0, bed=["traffic"], fx=["dust", "beam"], moves=["punch", "circle"],
         vo=("D", "Hardwood floors. Big window. Your name right there on the glass. This one's yours.")),
    dict(kind="motion", clips=["tasha_window"], bed=["traffic"], fx=["dust", "glow"], moves=["push_in", "punch"],
         vo=("T", "I can't afford this.")),
    dict(kind="motion", clips=["dre_smile"], bed=["traffic"], fx=["glow"], moves=["dolly", "punch"],
         vo=("D", "You can't afford not to. How long you gonna keep drawing dresses at the kitchen table?")),
    dict(kind="card", text="HOUSTON, 2012", dur=2.6, small=True, sfx=[("thunder", 0.0, 0.6)]),
    # memory: what she gave up
    dict(kind="motion", clips=["young_tasha"], mood="memory", bed=["hum"], fx=["dust", "beam"], sfx=[("paper", 0.8, 0.5)], moves=["push_in", "punch", "track"],
         vo=("N", "Twelve years earlier, Tasha had a letter from the design school in Dallas. Full ride. Starting in the fall.")),
    dict(kind="motion", clips=["lawyer"], bed=["hum"], fx=["flicker"], sfx=[("pen", 1.2, 0.6)], moves=["track", "punch"],
         vo=("N", "Then Marcus got picked up on the Southside. She took the tuition money and paid his lawyer instead.")),
    # grief
    dict(kind="motion", clips=["letter_burn"], mood="grief", bed=["night"], fx=["embers", "glow"], sfx=[("paper", 0.4, 0.5)], moves=["push_in", "crane_down"],
         vo=("N", "She never told him. She folded the letter into a shoebox and became the woman who saved Marcus Grant.")),
    dict(kind="motion", clips=["tasha_kitchen"], bed=["night"], fx=["glow"], moves=["dolly", "punch"],
         vo=("T", "Twelve years I been everybody's backbone. Nobody ever asked me what I wanted. Except him.")),
    dict(kind="card", text="THREE YEARS AGO", dur=2.4, small=True, sfx=[("impact", 0.1, 0.45)]),
    # pulse: the affair and the money
    dict(kind="motion", clips=["hotel"], mood="pulse", bed=["night"], fx=["glow"], sfx=[("traffic", 0.0, 0.3)], moves=["track", "punch", "push_in"],
         vo=("N", "Attention turned into late nights. Late nights turned into a hotel off the Southwest Freeway.")),
    dict(kind="motion", clips=["laptop"], bed=["hum"], fx=["flicker"], sfx=[("pen", 0.5, 0.3)], slam="$18,000", moves=["push_in", "punch"],
         vo=("N", "The lease was eighteen thousand. It came out of Marcus's business account. Then the card in his name. Thirty one thousand.")),
    dict(kind="motion", clips=["loan"], bed=["hum"], fx=["dust"], sfx=[("pen", 1.0, 0.6)], moves=["crane_down", "punch"],
         vo=("N", "Then a loan against his mother's house. His name. Her hand. Every dollar went to Dre's investment.")),
    dict(kind="motion", clips=["dre_counting"], bed=["night"], fx=["glow"], sfx=[("paper", 0.6, 0.6)], moves=["push_in", "punch"],
         vo=("D", "Lawyers. Permits. Contractors. It takes money to make money, Tasha.")),
    # tension: the empty store
    dict(kind="motion", clips=["for_lease"], mood="tension", bed=["traffic"], fx=["dust"], moves=["pull_back", "punch"],
         vo=("N", "A year later the window on Almeda still said for lease. No floors. No name on the glass.")),
    dict(kind="motion", clips=["tasha_phone"], bed=["traffic"], fx=["dust"], sfx=[("dial", 0.2, 0.5)], moves=["push_in", "punch", "track"],
         vo=("N", "She called the landlord. He had never heard of Tasha Grant. Nobody had ever signed a lease.")),
    # heart: she pulls back
    dict(kind="motion", clips=["dre_car"], mood="heart", bed=["rain"], fx=["rain"], sfx=[("cardoor", 0.3, 0.7)], moves=["dolly", "punch"],
         vo=("T", "There's no store. There was never a store. I'm done, Dre. I'm telling Marcus everything.")),
    dict(kind="motion", clips=["tasha_tears"], bed=["rain"], fx=["rain", "glow"], moves=["push_in", "punch"], hush=True,
         vo=("N", "For one second, she felt like herself again.")),
    # dread: the threat
    dict(kind="motion", clips=["dre_cold"], mood="dread", bed=["rain"], fx=["rain"], sfx=[("heartbeat", 0.0, 0.5)], moves=["crash_zoom", "punch"],
         vo=("D", "Tell him. Then tell him about 2012. That case never closed. One phone call, and your husband does the nine years I did.")),
    dict(kind="motion", clips=["case_file"], bed=["rain"], fx=["flicker"], sfx=[("paper", 0.3, 0.7)], slam="CASE OPEN", moves=["push_in", "crane_down"],
         vo=("N", "He slid a photo across the dash. Marcus at twenty two, on the corner, the night it all went down.")),
    dict(kind="motion", clips=["tasha_car_alone"], bed=["rain"], fx=["rain"], moves=["push_in", "punch"],
         vo=("N", "That's when Tasha understood. She was never Dre's partner. She was his account.")),
    dict(kind="card", text="NOW", dur=2.0, small=True, sfx=[("impact", 0.0, 0.8)]),
    # climax: back to tonight
    dict(kind="motion", clips=["bedroom"], mood="climax", bed=["rain"], fx=["flicker"], sfx=[("heartbeat", 0.0, 0.6)], moves=["push_in", "punch"],
         vo=("N", "Tonight, she lay next to her husband in the dark. He was awake. So was she.")),
    dict(kind="motion", clips=["closet_glow"], bed=["rain"], fx=["glow", "flicker"], sfx=[("phonebuzz", 0.5, 1.0), ("phonebuzz", 2.4, 1.0)], moves=["dolly", "punch"], min_dur=4.6,
         vo=("N", "Then, behind the heels, the second phone lit up.")),
    dict(kind="motion", clips=["text_d"], bed=["rain"], fx=["glow"], sfx=[("riser", 0.2, 0.9)], slam="HE KNOWS", flash=True, moves=["crash_zoom"], min_dur=5.5,
         vo=("N", "One message from D. He called me. He knows.")),
    dict(kind="black", dur=1.4, sfx=[("impact", 0.0, 1.0)]),
    dict(kind="card", text="EPISODE FOUR", sub="STATIC", dur=4.0, sfx=[("impact", 0.2, 0.5)]),
    dict(kind="card", text="THE SETTLEMENT", sub="WHOSE SIDE ARE YOU ON?", dur=4.0, end=True, font="cinzel", sfx=[("impact", 0.1, 0.6)]),
]

# Pictures (Canva, cast portraits as references). refs: which cast faces appear.
STYLE = " Cinematic photorealistic film still, vertical 9:16, moody lighting, shallow depth of field, 35mm film look, Houston, Texas."
PICTURES = {
    "hallway": (["tasha"], "Seen from the top of a dark staircase in a suburban house at night: the front door swings open below and the woman from the reference photo (Tasha, Black woman mid 30s, shoulder-length black hair, gold hoop earrings, white blouse, trench coat) steps inside out of the rain, headlights behind her."),
    "closet_hide": (["marcus"], "The man from the reference photo (Marcus, heavyset Black man early 40s, short beard, navy work shirt) crouches in a dark walk-in closet at night sliding a small black flip phone back into a shoebox behind a row of women's high heels, blue phone glow on his worried face."),
    "stairs": (["marcus", "tasha"], "Inside a dim suburban house at night: the woman from the second reference photo (Tasha) stands at the bottom of the stairs looking up, wet coat, keys in hand; the man from the first reference photo (Marcus) stands in shadow at the top of the stairs looking down at her. Warm lamp light, rain on the window."),
    "tasha_window": (["tasha"], "The woman from the reference photo (Tasha, Black woman mid 30s, gold hoop earrings, white blouse) presses her palm to the dusty front window of an empty storefront, morning sun on her face, hopeful and afraid, a faded FOR LEASE sign beside her hand."),
    "dre_smile": (["dre"], "Close-up of the man from the reference photo (Dre, Black man early 40s, lean, short twists, goatee, gold chain, black hoodie) inside an empty sunlit storefront, leaning on the wall with a smooth, persuasive smile, dust floating in the light."),
    "young_tasha": (["tasha"], "Year 2012. The woman from the reference photo but younger, about 25 (Tasha, natural hair pulled back, simple t-shirt), sits on a small apartment bed holding an acceptance letter from a design school, sketchbook of dress drawings beside her, window light, joy in her eyes."),
    "lawyer": (["tasha"], "Year 2012. The young woman from the reference photo (Tasha, about 25) sits across a cluttered desk from a defense lawyer in a cramped downtown office, signing a cashier's check with a shaking hand, fluorescent light, rain on the window."),
    "letter_burn": ([], "Close-up of a woman's hands folding an old design school acceptance letter into a worn shoebox full of dress sketches, a single candle on a kitchen table at night, warm and sad."),
    "tasha_kitchen": (["tasha"], "The woman from the reference photo (Tasha, mid 30s, gold hoops, white blouse) sits alone at a kitchen table at midnight drawing dresses in a sketchbook, a single pendant lamp above her, tired, eyes wet, house dark around her."),
    "hotel": (["dre", "tasha"], "Night, a hotel balcony off a Houston freeway, city lights and traffic streaks below; the man from the first reference photo (Dre) and the woman from the second reference photo (Tasha) stand close, her head turned away, his hand near hers on the railing. Neon and amber light."),
    "laptop": ([], "Close-up of a laptop screen showing an online banking transfer of $18,000.00 from GRANT HEATING AND AIR LLC business checking, a woman's manicured hand on the trackpad, dark room, screen glow."),
    "loan": ([], "Close-up of a woman's hand with a gold bracelet signing a home equity loan document at a kitchen table, the borrower name line printed MARCUS GRANT, a pen and a cup of coffee, harsh overhead light."),
    "dre_counting": (["dre"], "The man from the reference photo (Dre) sits in a dark parked car at night counting a thick stack of hundred dollar bills, a cold small smile, dashboard light on his face, rain beads on the windshield."),
    "for_lease": ([], "Exterior of the same empty storefront on Almeda Road in Houston a year later, dirty window, a sun-faded FOR LEASE sign, no name on the glass, overcast afternoon, a street sign reading Almeda Rd."),
    "tasha_phone": (["tasha"], "The woman from the reference photo (Tasha, mid 30s, gold hoops, white blouse) stands on a sidewalk outside an empty storefront holding a phone to her ear, shocked, hand over her mouth, overcast light, traffic blurred behind."),
    "dre_car": (["dre", "tasha"], "Night, inside a parked car in heavy rain: the woman from the second reference photo (Tasha) in the passenger seat turned toward the man from the first reference photo (Dre) behind the wheel, she is crying and angry, he stares ahead calmly. Red tail lights through the wet windshield."),
    "tasha_tears": (["tasha"], "Close-up of the woman from the reference photo (Tasha) in a car at night, tears on her face but her jaw set, defiant, rain shadows moving across her skin, soft streetlight."),
    "dre_cold": (["dre"], "Extreme close-up of the man from the reference photo (Dre) in a dark car at night, turning his head slowly toward camera, cold menacing eyes, half his face lit red by brake lights, rain on the glass."),
    "case_file": ([], "Close-up on a car dashboard at night: an old police case file folder stamped HOUSTON PD 2012 and a creased photograph of two young Black men standing on a street corner at night under a streetlight, rain drops on the windshield above."),
    "tasha_car_alone": (["tasha"], "The woman from the reference photo (Tasha) sits alone in the driver seat of her parked car at night in the rain, staring straight ahead, numb and terrified, a black flip phone in her lap, streetlight through the rain."),
    "bedroom": (["marcus", "tasha"], "Dark bedroom at night, a couple lying in bed back to back: the man from the first reference photo (Marcus) awake with eyes open staring at the wall, the woman from the second reference photo (Tasha) also awake with eyes open on the other side. Blue moonlight, rain on the window."),
    "closet_glow": ([], "A dark walk-in closet at night, the door slightly open; behind a row of women's high heels a hidden black flip phone lights up blue inside a shoebox, glow spilling across the floor."),
    "text_d": ([], "Extreme close-up of a small black flip phone screen glowing blue in the dark, showing a text message from contact D that reads: HE CALLED ME. HE KNOWS."),
}
