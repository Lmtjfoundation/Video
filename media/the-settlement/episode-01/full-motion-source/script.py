"""The Settlement, Episode 1 (full motion). Every picture shot is an AI-generated motion clip (LTX-Video).
Clip codes: A1-A9 ep1m/a, B1-B9 ep1m/b, C1-C13 ep1m/c, M1-M6 the 30s motion clips, H1-H4 the hype clips.
sfx: (name, seconds after shot start, gain[, pan]). bed: looping ambience under the shot."""
SCR = "/tmp/claude-0/-home-user-Video/e94a2179-1832-5221-bb24-9d181da3a815/scratchpad"
DIRS = {"A": f"{SCR}/ep1m/a/clips", "B": f"{SCR}/ep1m/b/clips", "M": f"{SCR}/m30/clips", "H": f"{SCR}/hype/ltx/clips", "C": f"{SCR}/ep1m/c/clips"}
TALK = f"{SCR}/ch1/talk"


def clip(code):
    return f"{DIRS[code[0]]}/clip{code[1:]}.mp4"


SHOTS = [
    dict(kind="motion", clips=["B3", "M1"], mood="street", bed=["rain"], sfx=[("sirens", 0.0, 0.3, -0.3), ("cruiser", 0.6, 0.45)],
         vo="Every marriage has a settlement. Most people just never see the bill."),
    dict(kind="card", text="THE SETTLEMENT", sub="EPISODE ONE", dur=4.0, font="cinzel", sfx=[("impact", 0.2, 0.9)]),
    dict(kind="card", text="HOUSTON, 2012", dur=3.0, sfx=[("thunder", 0.0, 0.6)]),
    dict(kind="motion", clips=["H1", "B2"], bed=["rain"], sfx=[("footsteps", 2.5, 0.5)],
         vo="Twelve years ago, Marcus Grant ran the Southside with his best friend, Dre. Fast money. Short lives."),
    dict(kind="motion", clips=["B3"], bed=["rain"], sfx=[("sirens", 0.0, 0.4, 0.3), ("cruiser", 0.8, 0.55), ("whoop", 3.4, 0.5)],
         vo="The night the sirens came, a car pulled up to the corner."),
    dict(kind="motion", clips=["H2", "B4"], bed=["rain"], sfx=[("engine", 0.0, 0.22), ("cardoor", 4.2, 0.9)],
         vo="Tasha leaned across the seat and said, get in this car, or I'm done with you."),
    dict(kind="motion", clips=["B1", "C1"], bed=["rain"], sfx=[("cuffs", 1.2, 1.0), ("whoop", 0.3, 0.5, -0.3), ("engine", 3.5, 0.4)],
         vo="Marcus got in. Dre didn't. Dre did nine years for both of them."),
    dict(kind="motion", clips=["A1"], sfx=[("impact", 0.0, 0.35)], vo="She saved his life. He never asked what it cost her."),
    dict(kind="card", text="TWELVE YEARS LATER", dur=3.0, mood="warm", sfx=[("impact", 0.2, 0.5)]),
    dict(kind="motion", clips=["M2", "A2"], bed=["fridge"], sfx=[("keys", 0.8, 0.8)],
         vo="Twelve years of marriage. Marcus gave his wife everything. Every key. Every password. Every dollar."),
    dict(kind="motion", clips=["B7", "C2"], bed=["cicadas", "ac"], sfx=[("wrench", 1.0, 0.8), ("wrench", 3.6, 0.6)],
         vo="He fixed air conditioners in the Texas heat, sixty hours a week, so the house would always be cool when he came home."),
    dict(kind="motion", clips=["C3", "A2"], bed=["fridge"], sfx=[("keys", 1.5, 0.7)],
         vo="He came home tired. He came home happy. He came home to her."),
    dict(kind="motion", clips=["M3", "C4"], bed=["fridge"], sfx=[("paper", 1.0, 0.5), ("pen", 2.8, 0.4)],
         vo="Tasha kept the books. The bills. The accounts. The business. He never had to look."),
    dict(kind="talk", src=f"{TALK}/tasha-money.mp4", who="TASHA", line="“Baby, I handle the money. That’s what I’m good at.”"),
    dict(kind="motion", clips=["H3", "C5"], bed=["fridge"], sfx=[("pen", 1.2, 0.5)],
         vo="But after he fell asleep, Tasha sat at the kitchen table and drew dresses for a boutique she never opened."),
    dict(kind="motion", clips=["A3", "C6"], bed=["fridge"], vo="Twelve years of saving him. Nobody ever asked what she wanted."),
    dict(kind="motion", clips=["B5"], bed=["rain"], sfx=[("heartbeat", 0.0, 0.5)], vo="Somebody was about to.", min_dur=4.5),
    dict(kind="motion", clips=["C7", "A2"], bed=["fridge"], sfx=[("keys", 0.6, 0.6)],
         vo="And Marcus believed in her. Trust is a key you hand to someone else. Then you stop counting."),
    dict(kind="motion", clips=["B6", "A4"], mood="doubt", sfx=[("envelope", 1.4, 1.0), ("paper", 3.4, 0.6)],
         vo="The first sign was small. A letter from the bank, about a payment he had never missed."),
    dict(kind="motion", clips=["M4", "C8"], sfx=[("paper", 0.8, 0.7), ("cardoor", 0.1, 0.5)],
         vo="Then a credit card statement, in his truck, with his name on it. Thirty one thousand dollars. He had never opened that card."),
    dict(kind="talk", src=f"{TALK}/marcus-bank.mp4", who="MARCUS", line="“Then why is the bank calling me?”"),
    dict(kind="motion", clips=["C9", "A5"], bed=["fridge"], vo="She smiled. She always had an answer. A mix-up. The bank's mistake. She would fix it."),
    dict(kind="motion", clips=["C10", "A6"], bed=["fridge"], sfx=[("pen", 1.0, 0.6), ("impact", 3.2, 0.35)],
         vo="Then a loan against his mother's house. The signature on it looked like his. It wasn't."),
    dict(kind="motion", clips=["C11", "B8"], bed=["fridge"], sfx=[("candle", 4.4, 0.9)],
         vo="Then the birthdays started going missing. His fortieth. Their anniversary. She was always somewhere else."),
    dict(kind="motion", clips=["M5", "B9"], mood="dread", bed=["rain"], sfx=[("thunder", 0.5, 0.7), ("engine", 4.0, 0.5)],
         vo="One night he came home early. Her car was gone. Her phone went straight to voicemail."),
    dict(kind="motion", clips=["A7", "C12"], bed=["rain"], sfx=[("heartbeat", 0.5, 0.45)],
         vo="He sat in the dark and told himself there was a reason. There was always a reason."),
    dict(kind="motion", clips=["C13", "A8"], bed=["rain"], sfx=[("monitor", 0.0, 0.7)],
         vo="Upstairs, the old baby monitor still glowed in a room nobody used anymore. He never thought to turn it off."),
    dict(kind="motion", clips=["M6", "H4"], sfx=[("phonebuzz", 1.2, 1.0), ("creak", 0.2, 0.7), ("heartbeat", 0.0, 0.6)],
         vo="Then he heard it. In the back of her closet, behind the heels he bought her, something was buzzing."),
    dict(kind="motion", clips=["A9"], flash=True, sfx=[("phonebuzz", 0.0, 0.8), ("riser", 0.5, 0.9)],
         vo="A second phone. One contact. One letter. D.", min_dur=6.0),
    dict(kind="black", dur=1.5, sfx=[("impact", 0.0, 1.0)]),
    dict(kind="card", text="EPISODE TWO", sub="ONE CONTACT", dur=4.0, sfx=[("phonebuzz", 0.4, 0.5)]),
    dict(kind="card", text="THE SETTLEMENT", sub="COMING SOON", dur=3.5, end=True, sfx=[("impact", 0.1, 0.6)]),
]
