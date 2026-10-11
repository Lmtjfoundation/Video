import type { MetadataRoute } from "next";

/** Installable app (Android, iOS "Add to Home Screen", desktop). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nexus Pulse Autopilot",
    short_name: "Nexus Pulse",
    description: "Niche research, faceless story scripts and autopilot posting for six platforms.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#07080b",
    theme_color: "#07080b",
    categories: ["productivity", "business", "social"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Write a story", url: "/stories", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Calendar", url: "/calendar", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
