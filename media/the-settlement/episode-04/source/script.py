"""The Settlement, Episode 4: Static (full motion, vertical 1080x1920). Set in Dallas.
Picks up at 2 a.m., the night Episode 3 ends (the photo of Marcus's truck in the driveway).
vo: (voice, text). N = narrator (Kokoro), D = Dre, T = Tasha, M = Marcus (ElevenLabs takes).
radio=True: the line is heard through the old baby monitor (band-limited, with static).
sfx: (name, seconds after shot start, gain[, pan]). bed: looping ambience. mood: score section."""

SHOTS = [
    # Cold open: two in the morning, the photo of his truck.
    dict(kind="motion", clips=["window_night"], mood="dread", bed=["rain"], sfx=[("thunder", 1.0, 0.3)],
         vo=("N", "Two in the morning. Somebody had stood in their driveway and taken a picture of his truck.")),
    dict(kind="motion", clips=["driveway_empty"], bed=["rain"], sfx=[("heartbeat", 0.3, 0.45)],
         vo=("N", "By the time Marcus got to the window, the street was empty.")),
    dict(kind="motion", clips=["window_night"], offset=2.0, bed=["rain"], min_dur=3.4,
         vo=("M", "I see you.")),
    dict(kind="card", text="THE SETTLEMENT", sub="EPISODE FOUR", dur=4.0, font="cinzel", sfx=[("impact", 0.2, 0.9)]),
    dict(kind="card", text="STATIC", dur=3.2, sfx=[("whoosh", 0.0, 0.5)]),
    dict(kind="motion", clips=["skyline_dallas"], bed=["traffic"],
         vo=("N", "Marcus didn't say a word to her. He did what twelve years on the streets had taught him. He paid attention.")),
    # Quiet investigation.
    dict(kind="motion", clips=["mailbox"], mood="tension", bed=["morning"], sfx=[("paper", 1.2, 0.6)],
         vo=("N", "Every morning at five forty-five, he got to the mail before she did.")),
    dict(kind="motion", clips=["garage_box"], bed=["hum"], sfx=[("paper", 0.8, 0.7)],
         vo=("N", "In the garage, under the Christmas lights, he found the statements she swore she shredded.")),
    dict(kind="motion", clips=["statements"], bed=["hum"], sfx=[("paper", 0.3, 0.6)],
         vo=("M", "Thirty-one thousand. Forty-two hundred a month. Tash, what you been doing?")),
    dict(kind="motion", clips=["policy"], bed=["hum"], sfx=[("heartbeat", 0.0, 0.6), ("riser", 1.5, 0.4)],
         vo=("N", "Then he found the one that turned his hands cold. A life insurance policy. On him. Doubled six months ago.")),
    dict(kind="motion", clips=["policy"], offset=2.0, bed=["hum"], sfx=[("impact", 0.0, 0.7)], min_dur=3.8,
         vo=("M", "Beneficiary. Tasha Grant.")),
    # Breakfast: both of them smiling.
    dict(kind="motion", clips=["breakfast"], mood="dread", bed=["morning"], sfx=[("cup", 0.6, 0.6)],
         vo=("T", "You want some more coffee, baby?")),
    dict(kind="motion", clips=["breakfast"], offset=2.0, bed=["morning"], min_dur=3.2,
         vo=("M", "Nah. I'm good.")),
    dict(kind="motion", clips=["marcus_smile"], bed=["morning"],
         vo=("N", "He smiled at her across the table. He'd learned that from her.")),
    # The room nobody uses.
    dict(kind="card", text="THE BABY ROOM", dur=2.2, small=True, sfx=[("impact", 0.1, 0.5)]),
    dict(kind="motion", clips=["hallway_door"], mood="tension", bed=["night"], sfx=[("footsteps", 0.4, 0.4)],
         vo=("N", "There was a room upstairs nobody used. They painted it yellow for a baby that never came.")),
    dict(kind="motion", clips=["nursery"], bed=["night"], sfx=[("static", 0.5, 0.35)],
         vo=("N", "The old baby monitor was still plugged in. The other half was downstairs, in the laundry room, where she took her calls.")),
    dict(kind="motion", clips=["monitor_close"], bed=["night"], sfx=[("static", 0.0, 0.6)], min_dur=4.6, vo=None),
    dict(kind="motion", clips=["marcus_listen"], mood="confront", bed=["night"], sfx=[("static", 0.0, 0.5)],
         vo=("N", "That night, through the static, he heard his wife. Then a voice he used to know better than his own.")),
    dict(kind="motion", clips=["tasha_laundry"], bed=["night"], sfx=[("static", 0.0, 0.4)], radio=True,
         vo=("T", "He asking questions, Dre. He been in the garage. I can't keep doing this.")),
    dict(kind="motion", clips=["dre_phone"], bed=["night"], sfx=[("static", 0.0, 0.4)], radio=True,
         vo=("D", "You gon' do exactly what I tell you. One more time, and then it's over. For all of us.")),
    dict(kind="motion", clips=["marcus_still"], bed=["night"], sfx=[("impact", 0.0, 0.9), ("heartbeat", 0.4, 0.6)], min_dur=5.0, vo=None),
    # She finds him in the dark.
    dict(kind="motion", clips=["tasha_doorway"], mood="dread", bed=["night"], sfx=[("door", 0.0, 0.6)],
         vo=("T", "Baby? What you doing up here in the dark?")),
    dict(kind="motion", clips=["marcus_still"], offset=2.0, bed=["night"], min_dur=3.4,
         vo=("M", "Couldn't sleep. Go on back to bed, Tash.")),
    dict(kind="motion", clips=["tasha_doorway"], offset=2.0, bed=["night"],
         vo=("N", "She went. He sat there with the monitor in his hands until it crackled one more time.")),
    # The hook.
    dict(kind="motion", clips=["ledbetter"], mood="climax", bed=["rain"], sfx=[("static", 0.0, 0.5), ("riser", 1.0, 0.6)],
         vo=("N", "Ledbetter Drive. A long, dark road where the eighteen-wheelers run all night.")),
    dict(kind="motion", clips=["monitor_close"], offset=1.0, flash=True, bed=["night"], sfx=[("static", 0.0, 0.6)], radio=True, hush=True, min_dur=5.0,
         vo=("D", "Ten o'clock. Ledbetter. Make sure he drives.")),
    dict(kind="black", dur=2.0, sfx=[("impact", 0.0, 1.0)]),
    dict(kind="card", text="EPISODE FIVE", sub="TEN O'CLOCK", dur=4.0, sfx=[("impact", 0.2, 0.5)]),
    dict(kind="card", text="THE SETTLEMENT", sub="WHOSE SIDE ARE YOU ON?", dur=4.0, end=True, font="cinzel", sfx=[("impact", 0.1, 0.6)]),
]
