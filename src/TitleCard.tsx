import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { z } from "zod";

export const titleCardSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  accent: z.string(),
});

export const TitleCard: React.FC<z.infer<typeof titleCardSchema>> = ({
  title,
  subtitle,
  accent,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const titleIn = spring({ frame, fps, config: { damping: 200 } });
  const barIn = spring({ frame: frame - 10, fps, config: { damping: 200 } });
  const subtitleOpacity = interpolate(frame, [25, 45], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 20, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0b0b12",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "Helvetica, Arial, sans-serif",
        opacity: fadeOut,
      }}
    >
      <div
        style={{
          color: "white",
          fontSize: 160,
          fontWeight: 800,
          transform: `translateY(${(1 - titleIn) * 60}px)`,
          opacity: titleIn,
        }}
      >
        {title}
      </div>
      <div
        style={{
          height: 12,
          width: 600 * barIn,
          backgroundColor: accent,
          borderRadius: 6,
          margin: "24px 0",
        }}
      />
      <div style={{ color: "#c9c9d6", fontSize: 56, opacity: subtitleOpacity }}>
        {subtitle}
      </div>
    </AbsoluteFill>
  );
};
