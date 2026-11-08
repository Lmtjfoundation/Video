"""The Settlement, Episode 9: Old Ways (motion graphics, vertical 1080x1920).
Picks up Episode 8: the driver's caller was D. Marcus goes back to the Southside and his old crew offers to handle Dre
the old way; for one night he's 22 again. Tasha comes home and tells him everything, including that she went to stop it
and that she got the lender to postpone his mother's sale (Episode 8's mystery).
Hook: MARCUS: "I heard everything, Tasha." The baby monitor (Episode 4). She shows him her recording of Dre's threat in
Room 412 (Episode 7).
vo: N narrator (Kokoro); M Marcus, T Tasha (Ghost Post Chatterbox clones)."""

SHOTS = [
    dict(kind="motion", clips=["flip_match"], mood="dread", bed=["hum"], fx=["glow"], sfx=[("heartbeat", 0.0, 0.5)], moves=["push_in", "punch"],
         vo=("N", "Last time, the number on the truck driver's phone matched the only contact in a shoebox phone. D.")),
    dict(kind="motion", clips=["kev_desk"], bed=["hum"], fx=["flicker"], sfx=[("riser", 0.0, 0.5)], moves=["crash_zoom", "punch"], min_dur=3.4,
         vo=("K", "Every second.")),
    dict(kind="card", text="THE SETTLEMENT", sub="EPISODE NINE", dur=4.0, font="cinzel", sfx=[("impact", 0.2, 0.9)]),
    dict(kind="card", text="OLD WAYS", dur=2.6, sfx=[("impact", 0.3, 0.5)]),
    dict(kind="card", text="THE SOUTHSIDE", sub="11:40 PM", dur=2.6, small=True, sfx=[("impact", 0.0, 0.3)]),
    # cold: the old crew
    dict(kind="motion", clips=["marcus_wait"], mood="cold", bed=["night"], fx=["glow"], moves=["track", "punch"],
         vo=("N", "That night, Marcus drove to the Southside for the first time in twelve years.")),
    dict(kind="motion", clips=["crew_room"], bed=["hum"], fx=["flicker", "dust"], sfx=[("footsteps", 0.2, 0.5)], moves=["dolly", "punch", "push_in"],
         vo=("N", "The old crew still met in the back of a barbershop that closed at nine. Older now. Slower. Nobody had forgotten Dre.")),
    dict(kind="motion", clips=["crew_room"], offset=2.0, bed=["hum"], fx=["flicker"], slam="THE OLD WAY", moves=["punch", "push_in"],
         vo=("N", "They didn't ask what Dre had done. They asked one question. You want it handled the old way?")),
    dict(kind="card", text="HOUSTON, 2012", dur=2.6, small=True, sfx=[("thunder", 0.0, 0.4)]),
    # memory
    dict(kind="motion", clips=["corner_2012"], mood="memory", bed=["night"], fx=["glow"], moves=["pull_back", "punch"],
         vo=("N", "For one night, he was twenty two again. Same corner. Same anger. Same friend he would have died for.")),
    dict(kind="motion", clips=["car_2012"], bed=["rain"], fx=["rain", "glow"], moves=["push_in", "punch"],
         vo=("N", "Until a woman pulled up in a car and told him to get in.")),
    # grief
    dict(kind="motion", clips=["marcus_table"], mood="grief", bed=["rain"], fx=["glow"], moves=["push_in", "punch"],
         vo=("M", "Give me a week. If the law don't handle him, I'll come back.")),
    dict(kind="motion", clips=["house"], bed=["night"], fx=["glow"], moves=["pull_back", "punch"],
         vo=("N", "He sat outside his own house until the sun came up.")),
    # pulse: she comes home
    dict(kind="motion", clips=["driveway"], mood="pulse", bed=["morning"], fx=["dust"], sfx=[("footsteps", 0.3, 0.5)], moves=["track", "punch"],
         vo=("N", "On Thursday, Tasha came home. A thin scar where the bandage had been. She asked him to sit down.")),
    dict(kind="motion", clips=["tasha_kitchen"], bed=["morning"], fx=["dust", "beam"], moves=["push_in", "punch"],
         vo=("T", "I wanted something that was mine, Marcus. A boutique. Dre said he could make it happen.")),
    # tension: the confession
    dict(kind="motion", clips=["storefront"], mood="tension", bed=["morning"], fx=["dust"], moves=["dolly", "punch"],
         vo=("N", "The lease. The card in his name. The loan on his mother's house. She told him all of it.")),
    dict(kind="motion", clips=["loan"], bed=["morning"], fx=["dust"], slam="HER HAND", moves=["crane_down", "punch"],
         vo=("T", "I signed your name. I told myself I'd pay it back before you ever saw it.")),
    dict(kind="motion", clips=["tasha_call"], bed=["rain"], fx=["rain", "glow"], sfx=[("heartbeat", 0.0, 0.5)], moves=["push_in", "crash_zoom"],
         vo=("T", "Then he told me what the truck was for. I drove to Telephone Road to stop it. I swear to God, I went to stop it.")),
    # heart
    dict(kind="motion", clips=["tasha_tears"], mood="heart", bed=["hum"], fx=["glow"], moves=["push_in", "punch"],
         vo=("T", "And I called your mother's bank. I promised them every dollar the day the settlement clears. That's why they postponed the sale.")),
    dict(kind="motion", clips=["marcus_watch"], bed=["hum"], fx=["dust", "beam"], moves=["push_in", "punch"], hush=True,
         vo=("N", "For a long time, Marcus didn't say anything at all.")),
    # dread
    dict(kind="motion", clips=["monitor"], mood="dread", bed=["hum"], fx=["flicker"], sfx=[("creak", 0.2, 0.5)], moves=["push_in", "punch"],
         vo=("N", "Then he went out to the garage, and came back with an old baby monitor.")),
    dict(kind="card", text="NOW", dur=2.0, small=True, sfx=[("impact", 0.0, 0.8)]),
    # climax
    dict(kind="motion", clips=["marcus_monitor"], mood="climax", bed=["hum"], fx=["flicker", "glow"], sfx=[("heartbeat", 0.0, 0.7)], slam="I HEARD", moves=["crash_zoom", "punch"],
         vo=("M", "I heard everything, Tasha.")),
    dict(kind="motion", clips=["voice_memo"], bed=["hum"], fx=["glow"], sfx=[("riser", 0.0, 0.9)], slam="ROOM 412", flash=True, moves=["push_in", "crash_zoom"], min_dur=5.5,
         vo=("T", "Then hear this. I recorded him. Every word he said in that hospital room.")),
    dict(kind="black", dur=1.4, sfx=[("impact", 0.0, 1.0)]),
    dict(kind="card", text="EPISODE TEN", sub="THE SETTLEMENT", dur=4.0, sfx=[("impact", 0.2, 0.5)]),
    dict(kind="card", text="THE SETTLEMENT", sub="WHOSE SIDE ARE YOU ON?", dur=4.0, end=True, font="cinzel", sfx=[("impact", 0.1, 0.6)]),
]

REUSE = {"flip_match": "ep8/img/flip_match.png", "kev_desk": "ep4/img/kev_desk.png", "marcus_wait": "ep5/img/marcus_wait.png",
         "corner_2012": "ep5/img/corner_2012.png", "car_2012": "ep5/img/car_2012.png", "marcus_table": "ep5/img/marcus_table.png",
         "house": "ep2/img/house.png", "driveway": "ep2/img/driveway.png", "tasha_kitchen": "ep3/img/tasha_kitchen.png",
         "storefront": "ep3/img/storefront.png", "loan": "ep3/img/loan.png", "tasha_call": "ep5/img/tasha_call.png",
         "tasha_tears": "ep3/img/tasha_tears.png", "marcus_watch": "ep4/img/marcus_watch.png", "monitor": "ep4/img/monitor.png",
         "marcus_monitor": "ep4/img/marcus_monitor.png"}
GHOST = {
 "crew_room": "the back room of a closed barbershop on Houston's Southside at night, three older Black men in their forties sitting around a card table under one bare bulb, faces half in shadow, barber chairs and a mirror behind, cigarette smoke, low-key light",
}
# voice_memo: GhostPics blank phone in a woman's hand, a Voice Memos screen drawn on (props/compose2.py).
