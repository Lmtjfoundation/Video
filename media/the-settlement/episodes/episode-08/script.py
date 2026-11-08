"""The Settlement, Episode 8: The Tape (motion graphics, vertical 1080x1920).
Picks up Episode 7's text ("We need to talk. Tonight.") and the auction. Kev finds Marcus at a job site and plays him the
dashcam: her car, the truck, the driver on the phone before the crash. He brought it to Marcus, not the police.
Hook: KEV: "I kept the tape. All of it. Every second." The number on the driver's phone is the one contact in the shoebox
phone from Episode 2: D.
vo: N narrator (Kokoro); M Marcus, K Kev (Ghost Post Chatterbox clones)."""

SHOTS = [
    dict(kind="motion", clips=["marcus_text"], mood="dread", bed=["hum"], fx=["glow"], sfx=[("heartbeat", 0.0, 0.5)], moves=["push_in", "punch"],
         vo=("N", "Last time, one text from his wife. We need to talk. Tonight. Just you and me.")),
    dict(kind="motion", clips=["auction_hall"], bed=["hum"], fx=["flicker"], sfx=[("impact", 0.6, 0.5)], slam="POSTPONED", moves=["crane_down", "punch"],
         vo=("N", "And at the auction, the man with the clipboard read one more line. Sale postponed by the lender. Thirty days. Nobody told Marcus why.")),
    dict(kind="card", text="THE SETTLEMENT", sub="EPISODE EIGHT", dur=4.0, font="cinzel", sfx=[("impact", 0.2, 0.9)]),
    dict(kind="card", text="THE TAPE", dur=2.6, sfx=[("impact", 0.3, 0.5)]),
    dict(kind="card", text="THE NEXT DAY", sub="12:10 PM", dur=2.6, small=True, sfx=[("impact", 0.0, 0.3)]),
    # cold: the job site
    dict(kind="motion", clips=["truck_door"], mood="cold", bed=["cicadas"], fx=["dust"], moves=["track", "punch"],
         vo=("N", "He never answered her. He went to work. Grant Heating and Air still had his name on the door, and hers.")),
    dict(kind="motion", clips=["job_roof"], bed=["cicadas"], fx=["dust", "beam"], moves=["pull_back", "punch"],
         vo=("N", "A rooftop unit off Scott Street, in the kind of heat that makes the tar soft. Somebody else's house stays cool.")),
    dict(kind="motion", clips=["kev_cab"], bed=["cicadas"], fx=["dust"], sfx=[("footsteps", 0.3, 0.5)], moves=["push_in", "punch"],
         vo=("N", "At noon, a tow truck pulled up to the curb. Kev.")),
    dict(kind="motion", clips=["kev_marcus"], bed=["hum"], fx=["dust"], moves=["dolly", "punch"],
         vo=("K", "You stopped picking up, Marcus. So I came to you. Get down off that roof. You need to see something.")),
    dict(kind="card", text="HOUSTON, 2012", dur=2.6, small=True, sfx=[("thunder", 0.0, 0.4)]),
    # memory
    dict(kind="motion", clips=["corner_2012"], mood="memory", bed=["night"], fx=["glow"], moves=["pull_back", "punch"],
         vo=("N", "Kev knew them both back then. Two kids on a Southside corner. Even then, he never trusted Dre.")),
    # pulse: the tape
    dict(kind="motion", clips=["dashcam"], mood="pulse", bed=["rain"], fx=["rain", "flicker"], sfx=[("heartbeat", 0.0, 0.5)], slam="FRIDAY 21:52", moves=["push_in", "punch"],
         vo=("K", "Friday night. Light on Telephone Road. My camera's always running. Watch.")),
    dict(kind="motion", clips=["intersection"], bed=["rain"], fx=["rain"], moves=["push_in", "punch"],
         vo=("N", "Her car stopped under the red light. Tasha, alone, phone to her ear. Calling it off.")),
    dict(kind="motion", clips=["big_rig"], bed=["rain"], fx=["rain", "fog"], moves=["track", "punch"],
         vo=("N", "Behind the gas station, the truck sat with its lights off.")),
    dict(kind="motion", clips=["dashcam_zoom"], bed=["rain"], fx=["rain", "flicker"], sfx=[("riser", 0.0, 0.6)], slam="21:52:07", moves=["push_in", "punch"],
         vo=("N", "And four seconds before he pulled out, the driver was on the phone.")),
    dict(kind="motion", clips=["glass"], bed=["rain"], fx=["rain"], sfx=[("impact", 0.1, 1.0)], moves=["crash_zoom"], min_dur=3.0, flash=True,
         vo=("N", "Then the light turned green.")),
    # grief
    dict(kind="motion", clips=["marcus_floor"], mood="grief", bed=["cicadas"], fx=["dust"], moves=["push_in", "punch"],
         vo=("M", "She tried to stop it. She was out there trying to stop it.")),
    dict(kind="motion", clips=["kev_desk"], bed=["hum"], fx=["flicker"], moves=["dolly", "punch"],
         vo=("K", "She did. I watched her try. Now watch who that driver was talking to.")),
    # tension: the number
    dict(kind="motion", clips=["dashcam_zoom"], offset=2.0, mood="tension", bed=["hum"], fx=["flicker"], sfx=[("impact", 0.5, 0.6)], slam="(713) 555-0148", moves=["crash_zoom", "punch"],
         vo=("N", "Kev had slowed it down, frame by frame, until the screen in the driver's hand was readable. A prepaid number.")),
    dict(kind="motion", clips=["kev_marcus"], offset=2.0, bed=["hum"], fx=["dust"], moves=["punch", "push_in"],
         vo=("K", "Same kind of number the police found on that driver's phone. White pickup, ten o'clock. That text was meant for you.")),
    # heart
    dict(kind="motion", clips=["marcus_watch"], mood="heart", bed=["hum"], fx=["dust", "beam"], moves=["push_in", "punch"],
         vo=("M", "Why didn't you take this to the police?")),
    dict(kind="motion", clips=["kev_cab"], offset=2.0, bed=["cicadas"], fx=["glow"], moves=["punch", "track"], hush=True,
         vo=("K", "Because it's your family on that tape. That's your call to make. Not mine.")),
    # dread: the shoebox
    dict(kind="motion", clips=["closet"], mood="dread", bed=["hum"], fx=["flicker"], sfx=[("footsteps", 0.0, 0.4)], moves=["push_in", "punch"],
         vo=("N", "Marcus had seen a prepaid phone before. In a shoebox, in his own closet. One contact.")),
    dict(kind="card", text="NOW", dur=2.0, small=True, sfx=[("impact", 0.0, 0.8)]),
    # climax
    dict(kind="motion", clips=["flip_match"], mood="climax", bed=["hum"], fx=["glow"], sfx=[("heartbeat", 0.0, 0.7)], slam="D", moves=["crash_zoom", "punch"],
         vo=("N", "D. Seven one three. Five five five. Zero one four eight.")),
    dict(kind="motion", clips=["kev_desk"], offset=2.0, bed=["hum"], fx=["flicker"], sfx=[("riser", 0.0, 0.9)], slam="EVERY SECOND", flash=True, moves=["crash_zoom"], min_dur=5.5,
         vo=("K", "I kept the tape. All of it. Every second.")),
    dict(kind="black", dur=1.4, sfx=[("impact", 0.0, 1.0)]),
    dict(kind="card", text="EPISODE NINE", sub="OLD WAYS", dur=4.0, sfx=[("impact", 0.2, 0.5)]),
    dict(kind="card", text="THE SETTLEMENT", sub="WHOSE SIDE ARE YOU ON?", dur=4.0, end=True, font="cinzel", sfx=[("impact", 0.1, 0.6)]),
]

REUSE = {"marcus_text": "ep7/img/marcus_text.png", "auction_hall": "ep7/img/auction_hall.png", "truck_door": "ep4/img/truck_door.png",
         "kev_cab": "ep5/img/kev_cab.png", "kev_marcus": "ep4/img/kev_marcus.png", "corner_2012": "ep5/img/corner_2012.png",
         "dashcam": "ep5/img/dashcam.png", "intersection": "ep5/img/intersection.png", "big_rig": "ep5/img/big_rig.png",
         "glass": "ep5/img/glass.png", "marcus_floor": "ep4/img/marcus_floor.png", "kev_desk": "ep4/img/kev_desk.png",
         "marcus_watch": "ep4/img/marcus_watch.png", "closet": "ep2/img/closet.png"}
GHOST = {
 "job_roof": "a rooftop air conditioning condenser unit with its side panel off on a flat tar roof in a Houston neighborhood at midday, tools and a gauge set beside it, heat haze, harsh sun, a white work truck parked below",
}
# dashcam_zoom, flip_match: GhostPics blanks with readable screens drawn on (props/compose_ep8.py).
