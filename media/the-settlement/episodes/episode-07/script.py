"""The Settlement, Episode 7: Twenty Million (motion graphics, vertical 1080x1920).
Picks up Episode 6's hook ("You were supposed to be there."). The lawyers, the settlement in her name only, his mother's
house at auction, Dre at visiting hours wanting half. Hook: Tasha has to choose between Dre and Marcus.
vo: N narrator (Kokoro); M Marcus, D Dre, T Tasha (Ghost Post Chatterbox clones)."""

SHOTS = [
    dict(kind="motion", clips=["tasha_close"], mood="dread", bed=["hum"], fx=["glow", "flicker"], sfx=[("monitor", 0.0, 0.5), ("heartbeat", 0.0, 0.5)], moves=["push_in", "punch"],
         vo=("N", "Last time, after three weeks in the dark, Tasha Grant opened her eyes. And the first thing she said to her husband was this.")),
    dict(kind="motion", clips=["tasha_close"], offset=2.0, bed=["hum"], fx=["glow"], sfx=[("riser", 0.0, 0.6)], moves=["crash_zoom"], min_dur=3.6, hush=True,
         vo=("T", "You were supposed to be there.")),
    dict(kind="card", text="THE SETTLEMENT", sub="EPISODE SEVEN", dur=4.0, font="cinzel", sfx=[("impact", 0.2, 0.9)]),
    dict(kind="card", text="TWENTY MILLION", dur=2.6, sfx=[("impact", 0.3, 0.5)]),
    dict(kind="card", text="SIX WEEKS LATER", dur=2.6, small=True, sfx=[("impact", 0.0, 0.3)]),
    # cold: the lawyers and the money
    dict(kind="motion", clips=["bed_talk"], mood="cold", bed=["hum"], fx=["dust"], moves=["track", "punch"],
         vo=("N", "He never answered her. He didn't have to. They both knew where he was supposed to be that night.")),
    dict(kind="motion", clips=["marcus_chair"], bed=["hum"], fx=["dust"], moves=["push_in", "punch"],
         vo=("M", "I was right where you sent me, Tasha. Home. Waiting on you.")),
    dict(kind="motion", clips=["lawyers"], bed=["hum"], fx=["flicker"], sfx=[("footsteps", 0.1, 0.6)], moves=["dolly", "punch"],
         vo=("N", "The lawyers came fast. The week she could walk again, she was sitting across a desk from one, in a suit that cost more than his truck.")),
    dict(kind="motion", clips=["settlement_doc"], bed=["hum"], fx=["dust", "beam"], sfx=[("impact", 0.4, 0.7)], slam="$20,000,000", moves=["push_in", "crash_zoom"],
         vo=("N", "The trucking company didn't want a jury looking at that intersection. So they settled. Twenty million dollars.")),
    dict(kind="motion", clips=["pen_sign"], mood="memory", bed=["hum"], fx=["dust"], sfx=[("pen", 0.6, 0.7)], slam="HER NAME ONLY", moves=["crane_down", "punch"],
         vo=("N", "In her name only. On paper, she was the victim. On paper, he was the husband who stayed home.")),
    # grief: his mother's house
    dict(kind="motion", clips=["porch"], mood="grief", bed=["cicadas"], fx=["dust", "beam"], moves=["pull_back", "punch", "push_in"],
         vo=("N", "Across town, the ninety days on his mother's door were almost gone. The loan against her house, his name in Tasha's hand, had paid for Dre's investment.")),
    dict(kind="motion", clips=["foreclosure"], bed=["wind"], fx=["fog"], slam="FORECLOSED", moves=["push_in", "punch"],
         vo=("M", "Mama, I'm gonna fix this. You hear me? I'm gonna fix it.")),
    dict(kind="motion", clips=["auction_notice"], bed=["wind"], fx=["dust"], sfx=[("impact", 0.2, 0.5)], slam="FIRST TUESDAY", moves=["crash_zoom", "punch"],
         vo=("N", "In Texas, a foreclosed house goes to auction on the first Tuesday of the month. That gave him nine days.")),
    # pulse: he asks
    dict(kind="motion", clips=["hand_hold"], mood="pulse", bed=["hum"], fx=["flicker"], moves=["track", "punch"],
         vo=("N", "He asked his wife for one thing. Enough to keep his mother in her house.")),
    dict(kind="motion", clips=["tasha_wakes"], bed=["hum"], fx=["glow"], moves=["push_in", "punch"],
         vo=("T", "The lawyers said don't touch any of it yet, Marcus. Not yet.")),
    dict(kind="motion", clips=["marcus_watch"], bed=["hum"], fx=["flicker"], moves=["punch", "dolly"],
         vo=("M", "Not yet. Twelve years with you, and it's always not yet.")),
    # tension: Dre at visiting hours
    dict(kind="motion", clips=["dre_bedside"], mood="tension", bed=["hum"], fx=["flicker"], sfx=[("footsteps", 0.0, 0.6)], moves=["dolly", "punch"],
         vo=("N", "Dre didn't call this time. He came at visiting hours, and he shut the door behind him.")),
    dict(kind="motion", clips=["dre_bedside"], offset=2.0, bed=["hum"], fx=["flicker"], slam="HALF", moves=["punch", "push_in"],
         vo=("D", "Half, Tasha. Ten million. I set this up. I made you rich.")),
    dict(kind="motion", clips=["tasha_wakes"], offset=2.0, bed=["hum"], fx=["glow"], moves=["punch", "track"],
         vo=("T", "You almost made me dead.")),
    dict(kind="motion", clips=["dre_cold"], bed=["hum"], fx=["flicker"], sfx=[("heartbeat", 0.0, 0.5)], moves=["push_in", "crash_zoom"],
         vo=("D", "And I can still make you broke. One phone call. Everything you did, everything you signed. Ten million by Friday, or I start talking.")),
    # heart: two phones
    dict(kind="motion", clips=["two_phones"], mood="heart", bed=["hum"], fx=["glow"], moves=["crane_down", "punch"],
         vo=("N", "That night she lay awake with her phone in her hand. Two names on the screen. Dre. And her husband.")),
    dict(kind="motion", clips=["marcus_awake"], bed=["hum"], fx=["glow"], moves=["push_in", "punch"], hush=True,
         vo=("M", "Whatever you did, Tasha, I'm still standing here. But I can't stand here forever.")),
    # dread: the county auction
    dict(kind="motion", clips=["auction_hall"], mood="dread", bed=["wind"], fx=["fog"], sfx=[("footsteps", 0.0, 0.4)], moves=["crane_down", "punch"],
         vo=("N", "Tuesday morning. The county foreclosure auction. Marcus stood at the back while a man with a clipboard read his mother's address out loud.")),
    dict(kind="card", text="NOW", dur=2.0, small=True, sfx=[("impact", 0.0, 0.8)]),
    # climax
    dict(kind="motion", clips=["marcus_text"], mood="climax", bed=["wind"], fx=["glow"], sfx=[("heartbeat", 0.0, 0.7)], moves=["push_in", "punch"],
         vo=("N", "Then his phone buzzed. One message, from Tasha. The man who owns her secrets, or the husband she saved, and then betrayed.")),
    dict(kind="motion", clips=["tasha_close"], offset=1.0, bed=["hum"], fx=["glow"], sfx=[("riser", 0.0, 0.9)], slam="WHO DOES SHE CHOOSE?", flash=True, moves=["crash_zoom"], min_dur=5.5,
         vo=("T", "One of you is about to lose everything.")),
    dict(kind="black", dur=1.4, sfx=[("impact", 0.0, 1.0)]),
    dict(kind="card", text="EPISODE EIGHT", sub="THE TAPE", dur=4.0, sfx=[("impact", 0.2, 0.5)]),
    dict(kind="card", text="THE SETTLEMENT", sub="WHOSE SIDE ARE YOU ON?", dur=4.0, end=True, font="cinzel", sfx=[("impact", 0.1, 0.6)]),
]

REUSE = {"tasha_close": "ep6/img/tasha_close.png", "marcus_chair": "ep6/img/marcus_chair.png", "foreclosure": "ep4/img/foreclosure.png",
         "dre_cold": "ep3/img/dre_cold.png", "porch": "ep4/img/porch.png", "lawyers": "ep3/img/lawyer.png", "marcus_awake": "ep4/img/marcus_awake.png",
         "hand_hold": "ep6/img/hand_hold.png", "marcus_watch": "ep4/img/marcus_watch.png", "tasha_wakes": "ep6/img/tasha_wakes.png",
         "dre_bedside": "ep6/img/dre_bedside.png"}
# bed_talk: Canva (cast refs), exported from holder design page 75. pen_sign, auction_hall: GhostPics.
# settlement_doc, auction_notice, two_phones, marcus_text: GhostPics blanks with readable text drawn on (props/compose.py).
