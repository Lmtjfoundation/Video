"""The 30-second motion piece: six 5-second shots, each animated from a still of The Settlement."""
SRC = "/home/user/content-wt/media/the-settlement/film"
IMG = "/tmp/claude-0/-home-user-Video/e94a2179-1832-5221-bb24-9d181da3a815/scratchpad/film5/img"
STYLE = " Cinematic, photorealistic, shallow depth of field, moody night lighting, film grain, steady smooth camera."
SHOTS = [
    (f"{SRC}/shot11.jpg", "A slow aerial push toward the Houston skyline at night. City lights shimmer and red reflections ripple across dark water. A light rain falls."),
    (f"{SRC}/shot01.jpg", "In a warm kitchen at night, a tired man slowly lowers a set of keys into a woman's open palm. His face is calm and trusting. The camera holds steady."),
    (f"{SRC}/shot02.jpg", "A woman in a white blouse sits at a desk covered in bills, writing in a ledger. She pauses, looks up and gives a small knowing smile. Lamp light glows softly."),
    (f"{SRC}/shot04.jpg", "A man sits in the dark cab of a truck reading a bank statement. His expression slowly tightens with worry. Headlights from a passing car sweep across his face."),
    (f"{IMG}/windshield.png", "Heavy rain streams down a car windshield at night. Blurred red and white city lights pulse behind the wet glass. Drops race downward."),
    (f"{IMG}/shoebox.png", "Inside a dark closet, a hidden phone in an open shoebox lights up and buzzes. Its blue screen glow flickers on the walls. The camera slowly pushes in."),
]
