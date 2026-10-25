/**
 * Image Studio's picture tools (safe in the browser): what each one asks for and costs. Most are instruction edits
 * on the engine's picture-edit model; upscale and background removal are dedicated models (Real-ESRGAN, BiRefNet).
 */
export type ImageToolId = "erase" | "expand" | "background" | "remove-bg" | "restyle" | "relight" | "angle" | "unblur" | "retouch" | "headshot" | "swap" | "upscale";

export interface ImageToolDef {
  id: ImageToolId;
  name: string;
  text: string;
  /** What the words box asks for; absent = the tool takes no words. */
  ask?: { label: string; placeholder: string; required: boolean };
  /** Ready-made answers for the words box. */
  presets?: string[];
  /** "image" = the picture-edit model (aiImage credits); otherwise a dedicated model with its own price. */
  cost: "image" | "upscale" | "removeBg";
}

export const IMAGE_TOOLS: ImageToolDef[] = [
  { id: "erase", name: "Erase", text: "Remove people, objects or text, filled in naturally.", ask: { label: "What to remove", placeholder: "e.g. the man in the background on the left", required: true }, cost: "image" },
  { id: "expand", name: "Expand", text: "Zoom out and continue the scene past the edges, in a new shape.", ask: { label: "What's beyond the edges", placeholder: "optional, e.g. more of the city skyline", required: false }, cost: "image" },
  { id: "background", name: "New background", text: "Keep the subject exactly, put them somewhere else.", ask: { label: "The new background", placeholder: "e.g. a rooftop in Houston at sunset", required: true }, presets: ["A clean white studio backdrop", "A soft grey studio backdrop", "A modern office with large windows", "A beach at golden hour", "A neon-lit city street at night"], cost: "image" },
  { id: "remove-bg", name: "Remove background", text: "A cut-out with a transparent background (PNG).", cost: "removeBg" },
  { id: "restyle", name: "Restyle", text: "The same picture redrawn in another style.", ask: { label: "The new style", placeholder: "e.g. a Studio Ghibli-style watercolor", required: true }, presets: ["Cinematic film still, 35mm, rich color grade", "Pixar-style 3D animation", "Anime, clean line art", "Oil painting, visible brush strokes", "Black-and-white film noir", "Comic book, bold inks"], cost: "image" },
  { id: "relight", name: "Relight", text: "Change the light and the time of day.", ask: { label: "The new light", placeholder: "e.g. warm golden hour light from the left", required: true }, presets: ["Golden hour, warm low sun from the side", "Blue hour, soft cool light", "Night, a single warm street lamp", "Soft studio key light with a gentle rim light", "Overcast, soft and even", "Dramatic red and blue neon"], cost: "image" },
  { id: "angle", name: "Camera angle", text: "See the same scene from another camera position.", cost: "image" },
  { id: "unblur", name: "Unblur & restore", text: "Sharpen blur, clean noise and old-photo damage.", cost: "image" },
  { id: "retouch", name: "Face retouch", text: "Natural skin smoothing; the person stays themselves.", cost: "image" },
  { id: "headshot", name: "AI headshot", text: "A professional headshot from any photo of a face.", presets: ["Corporate: navy suit, soft grey studio backdrop", "Creative: casual shirt, warm textured backdrop", "Outdoor: natural light, blurred greenery", "Black-and-white: classic studio portrait"], ask: { label: "Headshot style", placeholder: "Pick one above or describe it", required: false }, cost: "image" },
  { id: "swap", name: "Character swap", text: "Put one of your characters in place of the person in a picture.", cost: "image" },
  { id: "upscale", name: "Upscale", text: "Two or four times sharper, up to 4096 px (4K).", cost: "upscale" },
];

export const imageTool = (id: string) => IMAGE_TOOLS.find((t) => t.id === id);

/** The camera move for the "Camera angle" tool, in words the edit model follows. */
export function angleInstruction(o: { rotate: number; tilt: number; lens: "wide" | "normal" | "close" }) {
  const parts: string[] = [];
  if (Math.abs(o.rotate) >= 5) parts.push(`the camera orbits ${Math.abs(Math.round(o.rotate))} degrees to the ${o.rotate < 0 ? "left" : "right"} around the subject`);
  if (o.tilt >= 10) parts.push(`a high angle looking down ${Math.round(o.tilt)} degrees`);
  else if (o.tilt <= -10) parts.push(`a low angle looking up ${Math.round(-o.tilt)} degrees`);
  parts.push(o.lens === "wide" ? "a wide shot showing more of the surroundings" : o.lens === "close" ? "a close-up" : "the same distance");
  return parts.join(", ");
}
