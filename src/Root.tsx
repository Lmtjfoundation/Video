import { Composition, staticFile } from "remotion";
import { getAudioDurationInSeconds } from "@remotion/media-utils";
import { TitleCard, titleCardSchema } from "./TitleCard";
import {
  TalkingCharacter,
  talkingCharacterSchema,
} from "./talking/TalkingCharacter";

const FPS = 30;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TitleCard"
        component={TitleCard}
        durationInFrames={150}
        fps={FPS}
        width={1920}
        height={1080}
        schema={titleCardSchema}
        defaultProps={{
          title: "AI Vids",
          subtitle: "Motion graphics with Remotion",
          accent: "#7c5cff",
        }}
      />
      <Composition
        id="TalkingCharacter"
        component={TalkingCharacter}
        durationInFrames={FPS * 8}
        fps={FPS}
        width={1080}
        height={1920}
        schema={talkingCharacterSchema}
        defaultProps={{ showCaptions: true }}
        calculateMetadata={async () => {
          const seconds = await getAudioDurationInSeconds(staticFile("voice.wav"));
          return { durationInFrames: Math.ceil((seconds + 0.5) * FPS) };
        }}
      />
    </>
  );
};
