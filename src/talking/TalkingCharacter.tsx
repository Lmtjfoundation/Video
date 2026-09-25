import { useMemo } from "react";
import {
  AbsoluteFill,
  Html5Audio,
  Img,
  interpolate,
  random,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { useAudioData } from "@remotion/media-utils";
import { z } from "zod";
import captionsJson from "../../public/captions.json";
import {
  BACKGROUND,
  EYES,
  IMAGE,
  JAW,
  LASH_COLOR,
  LID_COLOR,
  LID_SHADOW_COLOR,
  MAX_JAW_DROP,
  MOUTH_COLOR,
  THROAT_COLOR,
  TONGUE_COLOR,
  MOUTH_OPENING,
  type Point,
} from "./rig";

export const talkingCharacterSchema = z.object({
  showCaptions: z.boolean(),
});

type Gesture = "lean" | "nod" | "tilt" | "shake";
type Caption = { text: string; start: number; end: number; gesture: Gesture };
const captions = captionsJson as Caption[];

const VOICE = staticFile("voice.wav");

// Character is drawn in source-image pixels, then scaled into the frame.
const SCALE = 1.1;
const BOTTOM_OVERHANG = 120;

const OUTLINE = [
  "-4px -4px 0 #000", "4px -4px 0 #000", "-4px 4px 0 #000", "4px 4px 0 #000",
  "0 -5px 0 #000", "0 5px 0 #000", "-5px 0 0 #000", "5px 0 0 #000",
  "0 10px 0 rgba(0,0,0,0.5)",
].join(", ");

export const TalkingCharacter: React.FC<
  z.infer<typeof talkingCharacterSchema>
> = ({ showCaptions }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;

  const openness = useMouthOpenness(fps);
  const mouth = openness(frame);
  // Slower-moving loudness, so the body follows the speech without jitter.
  const energy = (openness(frame - 2) + mouth + openness(frame + 2)) / 3;

  const blink = blinkAmount(frame, fps);

  // Idle motion: sway and breathing.
  let rotate = 1.2 * Math.sin(t * 0.9);
  let translateY = 6 * Math.sin(t * 1.7) - 10 * energy;
  let scale = 1 + 0.006 * Math.sin(t * 1.6);
  rotate += 1.2 * Math.sin(t * 5.5) * energy;

  // Gesture for each spoken line.
  for (const c of captions) {
    const since = frame - Math.round(c.start * fps);
    if (since < 0) continue;
    const s = since / fps;
    const decay = Math.exp(-3 * s);
    const inSpring = spring({ frame: since, fps, config: { damping: 14 } });
    const lineOver = interpolate(
      frame,
      [c.end * fps, c.end * fps + 12],
      [1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    switch (c.gesture) {
      case "lean":
        scale += 0.035 * inSpring * lineOver;
        translateY -= 12 * inSpring * lineOver;
        break;
      case "nod":
        translateY += 14 * Math.sin(2 * Math.PI * 2.2 * s) * decay;
        break;
      case "tilt":
        rotate -= 3 * inSpring * lineOver;
        break;
      case "shake":
        rotate += 3.5 * Math.sin(2 * Math.PI * 3 * s) * decay;
        break;
    }
  }

  const drop = mouth * MAX_JAW_DROP;
  // The transform scales around the bottom center of this box.
  const left = width / 2 - IMAGE.width / 2;
  const top = height + BOTTOM_OVERHANG - IMAGE.height;

  return (
    <AbsoluteFill style={{ backgroundColor: BACKGROUND }}>
      <Html5Audio src={VOICE} />
      <div
        style={{
          position: "absolute",
          left,
          top,
          width: IMAGE.width,
          height: IMAGE.height,
          transformOrigin: "50% 100%",
          transform: `translateY(${translateY}px) rotate(${rotate}deg) scale(${SCALE * scale})`,
        }}
      >
        <Img
          src={staticFile("character/base.png")}
          style={{ position: "absolute", left: 0, top: 0 }}
        />
        <svg
          width={IMAGE.width}
          height={IMAGE.height}
          style={{ position: "absolute", left: 0, top: 0 }}
        >
          <defs>
            <clipPath id="mouth">
              <path d={mouthInteriorPath(drop)} />
            </clipPath>
            <linearGradient id="mouth-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={MOUTH_COLOR} />
              <stop offset="1" stopColor={THROAT_COLOR} />
            </linearGradient>
          </defs>
          <g clipPath="url(#mouth)">
            <rect x={0} y={1000} width={IMAGE.width} height={140} fill="url(#mouth-fill)" />
            <ellipse cx={655} cy={1056 + drop} rx={95} ry={4 + drop * 0.45} fill={TONGUE_COLOR} />
          </g>
        </svg>
        <Img
          src={staticFile("character/jaw.png")}
          style={{
            position: "absolute",
            left: JAW.x,
            top: JAW.y + drop,
          }}
        />
        <svg
          width={IMAGE.width}
          height={IMAGE.height}
          style={{ position: "absolute", left: 0, top: 0 }}
        >
          <defs>
            <linearGradient id="lid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={LID_SHADOW_COLOR} />
              <stop offset="1" stopColor={LID_COLOR} />
            </linearGradient>
          </defs>
          {blink > 0.02
            ? EYES.map((eye, i) => {
                const edge = eye.top.map((p, j) => lerpPoint(p, eye.bottom[j], blink));
                return (
                  <g key={i}>
                    <path
                      d={`M${eye.top[0]} ${smoothCurve(eye.top)} ${smoothCurve([...edge].reverse())} Z`}
                      fill="url(#lid)"
                    />
                    <path
                      d={`M${edge[0]} ${smoothCurve(edge)}`}
                      fill="none"
                      stroke={LASH_COLOR}
                      strokeWidth={7}
                      strokeLinecap="round"
                    />
                  </g>
                );
              })
            : null}
        </svg>
      </div>
      {showCaptions ? <Captions /> : null}
    </AbsoluteFill>
  );
};

const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const current = captions.find(
    (c) => frame >= c.start * fps && frame < c.end * fps + 8,
  );
  if (!current) return null;

  const pop = spring({
    frame: frame - Math.round(current.start * fps),
    fps,
    config: { damping: 12, stiffness: 200 },
  });

  return (
    <AbsoluteFill
      style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 260 }}
    >
      <div
        style={{
          maxWidth: 900,
          textAlign: "center",
          fontFamily: "Helvetica, Arial, sans-serif",
          fontWeight: 900,
          fontSize: 84,
          lineHeight: 1.15,
          color: "white",
          textShadow: OUTLINE,
          transform: `scale(${0.7 + 0.3 * pop})`,
          opacity: pop,
        }}
      >
        {current.text}
      </div>
    </AbsoluteFill>
  );
};

// Returns mouth openness (0-1) for any frame, from the voice's loudness.
function useMouthOpenness(fps: number): (frame: number) => number {
  const audio = useAudioData(VOICE);

  return useMemo(() => {
    if (!audio) return () => 0;
    const samples = audio.channelWaveforms[0];
    const perFrame = audio.sampleRate / fps;

    const rms = (f: number) => {
      const start = Math.max(0, Math.floor(f * perFrame));
      const end = Math.min(samples.length, Math.floor((f + 1) * perFrame));
      let sum = 0;
      for (let i = start; i < end; i++) sum += samples[i] * samples[i];
      return end > start ? Math.sqrt(sum / (end - start)) : 0;
    };

    const frames = Math.ceil(samples.length / perFrame);
    const levels = Array.from({ length: frames }, (_, f) => rms(f));
    const peak = Math.max(...levels) || 1;

    return (f: number) => {
      const level = levels[f] ?? 0;
      const normalized = (level / peak - 0.06) / 0.6;
      return Math.min(1, Math.max(0, normalized)) ** 0.8;
    };
  }, [audio, fps]);
}

// Blinks every few seconds at slightly random intervals.
function blinkAmount(frame: number, fps: number): number {
  let start = Math.round(0.8 * fps);
  for (let i = 0; start <= frame; i++) {
    const since = frame - start;
    if (since < 8) {
      return interpolate(since, [0, 2, 4, 8], [0, 1, 1, 0], {
        extrapolateRight: "clamp",
      });
    }
    start += Math.round((2.2 + 2 * random(`blink-${i}`)) * fps);
  }
  return 0;
}

// Dark gap revealed between the upper teeth and the dropped jaw,
// tapered toward the mouth corners.
function mouthInteriorPath(drop: number): string {
  const x0 = MOUTH_OPENING[0][0];
  const x1 = MOUTH_OPENING[MOUTH_OPENING.length - 1][0];
  const lower = MOUTH_OPENING.map(([x, y]): Point => {
    const taper = Math.sin((Math.PI * (x - x0)) / (x1 - x0)) ** 0.8;
    return [x, y + drop * taper + 2];
  });
  return `M${MOUTH_OPENING[0]} ${smoothCurve(MOUTH_OPENING)} ${smoothCurve([...lower].reverse())} Z`;
}

// Catmull-Rom spline through the points as SVG cubic segments. Starts with
// a line to the first point, so curves can be chained into one path.
function smoothCurve(points: Point[]): string {
  let d = `L${points[0]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const [p1, p2] = [points[i], points[i + 1]];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1} ${c2} ${p2}`;
  }
  return d;
}

function lerpPoint(a: Point, b: Point, amount: number): Point {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount];
}

