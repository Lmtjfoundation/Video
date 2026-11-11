"""Second Line, Episode 4: Switch (uploaded bible). T-Bone buys Glock switches from a seller out of a car trunk in
Algiers; Locs is furious (under federal law one switch is a machine gun: up to ten years). Dupre builds the case and
notices none of their corners get raided. Saint shoots up Mud Bug Sound; Miss Odile is hit in the shoulder shielding
Dre; Dre has an Atlanta label meeting; Locs and T-Bone fight. Closing: Dupre takes Kebo off Esplanade. "What do I gotta do?\""""
import sys
sys.path.insert(0, "/tmp/claude-0/-home-user-Video/e94a2179-1832-5221-bb24-9d181da3a815/scratchpad/secondline")
from common import CAST, SCENES, tail
EP1 = "/tmp/claude-0/-home-user-Video/e94a2179-1832-5221-bb24-9d181da3a815/scratchpad/secondline/ep1/img"
EP2 = "/tmp/claude-0/-home-user-Video/e94a2179-1832-5221-bb24-9d181da3a815/scratchpad/secondline/ep2/img"
EP3 = "/tmp/claude-0/-home-user-Video/e94a2179-1832-5221-bb24-9d181da3a815/scratchpad/secondline/ep3/img"

SHOTS = [
    dict(kind="motion", clips=["casing_glove"], mood="dread", bed=["night"], fx=["flicker"], sfx=[("heartbeat", 0.0, 0.4)], moves=["push_in", "punch"],
         vo=("N", "Last time, an ATF agent picked up one shell casing on St. Claude Avenue, and smiled.")),
    dict(kind="card", text="SECOND LINE", sub="EPISODE FOUR", dur=4.0, font="cinzel", sfx=[("impact", 0.2, 0.9)]),
    dict(kind="card", text="SWITCH", dur=2.6, sfx=[("impact", 0.3, 0.5)]),
    # cold: Algiers
    dict(kind="motion", clips=["trunk"], mood="cold", bed=["night"], fx=["flicker"], moves=["push_in", "punch"],
         vo=("N", "Across the river in Algiers, a man was selling switches out of a car trunk. Little pieces of metal that turn a Glock into a fully automatic machine gun.")),
    dict(kind="motion", clips=["tbone"], bed=["night"], fx=["glow"], moves=["push_in", "punch"],
         vo=("T", "One for you, one for you, one for me. Party favors, baby!")),
    dict(kind="motion", clips=["locs"], bed=["hum"], fx=["flicker"], moves=["crash_zoom", "punch"],
         vo=("L", "Are you crazy? One of those is a machine gun under federal law. Ten years, T. Ten years in a federal prison for a piece of metal.")),
    dict(kind="motion", clips=["tbone_close"], bed=["hum"], fx=["glow"], moves=["punch", "push_in"],
         vo=("T", "Feds don't come to the Seventh Ward.")),
    # pulse: Dupre's board
    dict(kind="motion", clips=["evidence_board"], mood="pulse", bed=["hum"], fx=["dust", "beam"], moves=["track", "punch"],
         vo=("N", "The feds were already there. Dupre traced the switches, the casings and the money. And she noticed something.")),
    dict(kind="motion", clips=["dupre"], bed=["hum"], fx=["dust"], moves=["push_in", "punch"],
         vo=("U", "Three corners, open all night, and not one raid in four months. Somebody is protecting these boys.")),
    # memory: the studio
    dict(kind="motion", clips=["mudbug"], mood="memory", bed=["hum"], fx=["glow"], moves=["dolly", "punch"],
         vo=("N", "Tuesday night at Mud Bug Sound. Dre was halfway through a verse.")),
    # tension: Saint's retaliation
    dict(kind="motion", clips=["studio_glass"], mood="tension", bed=["night"], fx=["flicker", "fog"], sfx=[("switch_burst", 0.3, 1.0), ("casings", 1.2, 0.6)], slam="MUD BUG SOUND", flash=True, moves=["crash_zoom", "punch"], min_dur=4.5,
         vo=("N", "Saint answered for St. Claude.")),
    dict(kind="motion", clips=["odile"], bed=["hum"], fx=["flicker"], sfx=[("sirens", 0.5, 0.6)], moves=["push_in", "punch"],
         vo=("N", "Miss Odile put herself between the window and Dre. She took a bullet in the shoulder.")),
    # grief: the hospital
    dict(kind="motion", clips=["waiting_room"], mood="grief", bed=["hum"], fx=["flicker"], sfx=[("monitor", 0.0, 0.5)], moves=["push_in", "punch"],
         vo=("N", "The same hospital waiting room where they sat with Jojo.")),
    dict(kind="motion", clips=["dre"], bed=["hum"], fx=["dust"], moves=["push_in", "punch"],
         vo=("R", "I'm done, Locs. Atlanta wants a meeting. A real label. She almost died for a song. I'm not letting it be for nothing.")),
    # heart: the fight
    dict(kind="motion", clips=["parking_lot"], mood="heart", bed=["night"], fx=["glow"], sfx=[("impact", 0.6, 0.6), ("impact", 1.4, 0.6)], moves=["track", "punch"],
         vo=("N", "In the hospital parking lot, Locs and T-Bone finally said it. Then they swung. Fists, then tears. Brothers since Pampers.")),
    dict(kind="motion", clips=["tbone_close"], offset=2.0, bed=["night"], fx=["glow"], moves=["push_in", "punch"], hush=True,
         vo=("T", "I did all of it for us, Locs. All of it.")),
    # dread: Esplanade
    dict(kind="motion", clips=["esplanade"], mood="dread", bed=["morning"], fx=["fog"], sfx=[("cardoor", 0.5, 0.8)], moves=["pull_back", "crash_zoom"],
         vo=("N", "Thursday morning on Esplanade Avenue, a gray sedan pulled up beside Kebo. Not the Bloods.")),
    dict(kind="card", text="NOW", dur=2.0, small=True, sfx=[("impact", 0.0, 0.8)]),
    # climax
    dict(kind="motion", clips=["interview_room"], mood="climax", bed=["hum"], fx=["flicker"], moves=["push_in", "punch"],
         vo=("U", "Conspiracy. Machine gun possession. Ten years to life. Or, you help me get the cop.")),
    dict(kind="motion", clips=["thib_photo"], bed=["hum"], fx=["flicker"], sfx=[("heartbeat", 0.0, 0.7)], moves=["crash_zoom", "punch"],
         vo=("N", "She slid a photograph across the table. Detective Ray Thibodeaux.")),
    dict(kind="motion", clips=["kebo"], bed=["hum"], fx=["flicker"], moves=["push_in"], min_dur=3.0,
         vo=("N", "A long silence.")),
    dict(kind="motion", clips=["kebo"], offset=2.0, bed=["hum"], fx=["flicker"], sfx=[("riser", 0.0, 0.9)], slam="WHAT DO I GOTTA DO?", flash=True, moves=["crash_zoom"], min_dur=5.0,
         vo=("K", "What do I gotta do?")),
] + tail("FIVE", "HURRICANE SEASON")

REUSE = {**CAST, **SCENES, "casing_glove": f"{EP3}/casing_glove.png", "mudbug": f"{EP2}/mudbug.png", "waiting_room": f"{EP1}/waiting_room.png"}
GHOST = {
 "trunk": "the open trunk of an old car at night in Algiers, New Orleans, a single bulb lighting a shoebox of small loose black metal parts, hands counting cash beside it, faces out of frame",
 "evidence_board": "a federal agent's evidence board in an office at night: maps of New Orleans wards, surveillance photos pinned with red string, shell casings in labeled bags, a desk lamp",
 "studio_glass": "the front window of a small recording studio at night shattered by gunfire, glass in the air, a red recording light still glowing inside, motion blur, no people",
 "parking_lot": "a hospital parking lot at night in New Orleans, two young men silhouetted facing each other under a sodium light, rain on the asphalt",
 "esplanade": "Esplanade Avenue in New Orleans on a gray morning, old oak trees and grand houses, a gray unmarked sedan pulling up beside a young man walking on the sidewalk, seen from behind",
 "interview_room": "a federal interview room: a metal table, two chairs, a closed folder and a cup of water, one-way mirror, cold fluorescent light",
 "thib_photo": "close-up of a photograph on a metal table of a white middle-aged detective in a gray suit, a federal agent's finger tapping it, cold light",
}
