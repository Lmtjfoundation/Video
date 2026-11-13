// Automatic prompt enrichment (always on): every request leaves as a moving, cinematic shot description.
// Injects camera verbs, motion descriptors and modern title-sequence lighting; ambiguity resolves to the most dynamic
// reading. Deterministic per job id, so a re-render of the same job gets the same enrichment.
const CAMERA = [
  "slow dolly-in toward the subject",
  "push-in on the key element",
  "parallax depth shift as the camera tracks sideways",
  "rack focus from foreground to the subject",
  "low-angle crane rising past the subject",
  "orbiting camera arc around the action",
];
const MOTION = [
  "continuous motion through the whole shot, nothing holds still",
  "fluid movement with smooth easing, every element alive",
  "kinetic energy building through the shot",
  "particles, dust and light drifting through the frame",
];
const LIGHT = [
  "volumetric light shafts, high-contrast cinematic lighting, modern streaming title-sequence look",
  "volumetric haze, rim light, deep shadows, premium trailer lighting",
];
const LOOK = {
  teal_orange: "rich teal-and-orange grade, never flat, never oversaturated",
  mono_accent: "monochrome grade with a single accent hue",
};
const TECH = "24 fps with natural motion blur, temporally consistent, no flicker, no popping, film trailer quality";

function pick(list, h, salt) {
  return list[(h + salt * 7919) % list.length];
}

function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** Already cinematic? Don't stack a second camera move on a prompt that names one. */
const hasCamera = (p) => /\b(dolly|push[- ]in|pan|tilt|crane|orbit|tracking|rack focus|parallax|zoom)\b/i.test(p);

function enrichPrompt(prompt, opts = {}) {
  const p = String(prompt || "").trim().replace(/\s+/g, " ");
  const h = hash(opts.seed || p);
  const parts = [p || "A dramatic moment unfolds in motion"];
  if (!hasCamera(p)) parts.push(`Camera: ${pick(CAMERA, h, 1)}`);
  parts.push(pick(MOTION, h, 2));
  if (opts.presetMotion) parts.push(opts.presetMotion);
  parts.push(pick(LIGHT, h, 3));
  parts.push(LOOK[opts.grade] || LOOK.teal_orange);
  parts.push(TECH);
  return parts.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(". ").replace(/\.\./g, ".") + ".";
}

module.exports = { enrichPrompt };
