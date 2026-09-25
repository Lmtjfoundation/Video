"""Cut the talking-character source image into animation layers.

Produces, in public/character/:
  base.png  - the full image with the phone UI bar painted out
  jaw.png   - the lower lip, lower teeth, chin and beard as a feathered
              RGBA cutout; Remotion slides it down to open the mouth

Coordinates are in source-image pixels (1320x2031) and must match
src/talking/rig.ts if the source image changes.

Usage: python3 scripts/prepare_character.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "character"

BACKGROUND = (254, 252, 253)
UI_BAR_HEIGHT = 200  # "Back" / "Done" bar at the top of the screenshot

# Line between the upper teeth and the lower teeth/lip, left to right.
MOUTH_CUT = [
    (492, 1064), (540, 1060), (575, 1056), (610, 1050), (650, 1044),
    (700, 1039), (740, 1040), (770, 1048), (798, 1060),
]
# Rest of the jaw outline, running back from the right mouth corner
# through the beard, where the soft seam is hidden by the texture.
JAW_OUTLINE = [
    (840, 1060), (880, 1120), (885, 1230), (820, 1320), (700, 1370),
    (560, 1360), (440, 1300), (400, 1200), (410, 1100), (450, 1064),
]
# Inside this box the top edge stays sharp so the lip line is crisp.
SHARP_BOX = (500, 1000, 792, 1110)
FEATHER = 14


def main() -> None:
    src = Image.open(OUT / "source.jpg").convert("RGB")
    w, h = src.size

    base = src.copy()
    ImageDraw.Draw(base).rectangle((0, 0, w, UI_BAR_HEIGHT), fill=BACKGROUND)
    base.save(OUT / "base.png")

    sharp = Image.new("L", (w, h), 0)
    ImageDraw.Draw(sharp).polygon(MOUTH_CUT + JAW_OUTLINE, fill=255)
    soft = sharp.filter(ImageFilter.GaussianBlur(FEATHER))

    alpha = np.minimum(np.asarray(soft), np.asarray(sharp)).astype(np.uint8)
    x0, y0, x1, y1 = SHARP_BOX
    alpha[y0:y1, x0:x1] = np.asarray(sharp)[y0:y1, x0:x1]

    jaw = base.copy()
    jaw.putalpha(Image.fromarray(alpha))
    bbox = jaw.getbbox()
    jaw.crop(bbox).save(OUT / "jaw.png")
    print(f"jaw.png cropped at {bbox}")


if __name__ == "__main__":
    main()
