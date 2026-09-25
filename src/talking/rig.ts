// Layer geometry for the talking character, in source-image pixels.
// Must match scripts/prepare_character.py.

export type Point = readonly [number, number];

export const IMAGE = { width: 1320, height: 2031 };

// Bounding box that jaw.png was cropped to.
export const JAW = { x: 400, y: 1039, width: 486, height: 332 };
// How far the jaw slides down when the mouth is fully open.
export const MAX_JAW_DROP = 30;

// Line between the upper teeth and the lower teeth/lip (left to right),
// trimmed to where the jaw cutout has a hard edge.
export const MOUTH_CUT: Point[] = [
  [502, 1063], [540, 1060], [575, 1056], [610, 1050], [650, 1044],
  [700, 1039], [740, 1040], [770, 1048], [790, 1057],
];

// Part of MOUTH_CUT between the lip corners, where the dark mouth
// interior shows when the jaw drops.
export const MOUTH_OPENING: Point[] = [
  [535, 1060], [575, 1056], [610, 1050], [650, 1044],
  [700, 1039], [740, 1040], [770, 1048], [785, 1055],
];

// Upper lash line and lower lid line of each eye, sharing corner points.
// A blink slides the lid from the top curve toward the bottom curve.
export const EYES: { top: Point[]; bottom: Point[] }[] = [
  {
    top: [[336, 824], [385, 783], [450, 770], [510, 778], [550, 808]],
    bottom: [[336, 824], [390, 852], [450, 861], [512, 845], [550, 808]],
  },
  {
    top: [[664, 760], [720, 718], [790, 702], [850, 704], [884, 722]],
    bottom: [[664, 760], [725, 780], [790, 785], [852, 772], [884, 722]],
  },
];

export const LID_COLOR = "#8c5c44";
export const LID_SHADOW_COLOR = "#6a4232";
export const LASH_COLOR = "#1c0c06";
export const MOUTH_COLOR = "#120505";
export const THROAT_COLOR = "#3a1210";
export const TONGUE_COLOR = "#8a3a36";
export const BACKGROUND = "#fefcfd";
