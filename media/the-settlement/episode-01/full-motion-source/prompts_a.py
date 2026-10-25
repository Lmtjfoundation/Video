"""Episode 1 full-motion, batch A: shots from pictures that already exist."""
SRC = "/home/user/content-wt/media/the-settlement"
IMG = "/tmp/claude-0/-home-user-Video/e94a2179-1832-5221-bb24-9d181da3a815/scratchpad/film5/img"
STYLE = " Cinematic, photorealistic, moody night lighting, shallow depth of field, film grain, natural human motion, steady camera."
SHOTS = [
    (f"{SRC}/cast/marcus.jpg", "Close-up of a tired man in his forties. He slowly lowers his eyes, breathes out, then looks back up toward the camera with quiet gratitude. Slow push in."),
    (f"{SRC}/film/shot03.jpg", "Keys hanging on a hallway hook sway gently as a front door opens and warm light spills across the wall. Slow push in."),
    (f"{SRC}/cast/tasha.jpg", "Close-up of a woman in her forties with gold hoop earrings. She looks away out a window, her expression shifting from tired to longing. Soft light moves across her face."),
    (f"{IMG}/bills.png", "Bills and a bank letter on a kitchen table at night. A hand slides the bank letter forward and the camera slowly pushes in on it under the lamp light."),
    (f"{SRC}/cast/tasha.jpg", "Close-up of a woman in her forties with gold hoop earrings. She smiles warmly and reassuringly, nods slightly, then her smile fades for a moment when she looks away."),
    (f"{IMG}/bills.png", "Loan papers on a dark table. The camera pushes in slowly toward a signature line as lamp light flickers. Ominous and still."),
    (f"{SRC}/film/shot06.jpg", "A man sits alone in a dark living room at night, elbows on his knees, rubbing his hands together, staring at the front door. Headlights from outside sweep slowly across the wall."),
    (f"{IMG}/monitor.png", "An old baby monitor on a dresser in a dark empty room glows softly, its small lights flickering as static crackles. Slow push in. Rain on the window behind."),
    (f"{SRC}/film/shot05.jpg", "A phone screen glows in the dark with a single contact. The light pulses on the walls and the camera pushes in fast toward the screen."),
]
