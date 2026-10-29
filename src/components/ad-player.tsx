"use client";
import { useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

/** The ad in a phone frame: plays muted on loop (browsers allow that), with a button to turn the sound on. */
export function AdPlayer({ src, webm, poster }: { src: string; webm?: string; poster: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    if (!v.muted) {
      v.currentTime = 0;
      void v.play();
    }
    setMuted(v.muted);
  };
  return (
    <div className="relative overflow-hidden rounded-[2rem] border-4 border-white/10 bg-black shadow-glow">
      <video ref={video} poster={poster} autoPlay muted loop playsInline preload="metadata" className="aspect-[9/16] w-full object-cover" aria-label="Ghost Post ad, made with Ghost Post">
        {/* WebM first for browsers without H.264 (some Linux builds); everyone else plays the MP4. */}
        {webm && <source src={webm} type="video/webm" />}
        <source src={src} type="video/mp4" />
      </video>
      <button onClick={toggle} className="absolute bottom-3 right-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-2 text-xs font-medium text-white backdrop-blur hover:bg-black/85" aria-label={muted ? "Turn sound on" : "Mute"}>
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />} {muted ? "Sound on" : "Mute"}
      </button>
    </div>
  );
}
