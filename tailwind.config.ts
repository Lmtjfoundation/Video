import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Inter", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        ink: { 950: "#07080b", 900: "#0b0d12", 850: "#10131a", 800: "#151923", 700: "#1d2330", 600: "#2a3243", 500: "#3a4458" },
        mint: { 300: "#7dfcc6", 400: "#3ef0a8", 500: "#16d68c" },
        gold: { 300: "#ffe08a", 400: "#ffcc4d" },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(62,240,168,.25), 0 8px 40px -12px rgba(62,240,168,.35)",
        card: "0 1px 0 0 rgba(255,255,255,.04) inset, 0 20px 50px -30px rgba(0,0,0,.8)",
      },
      keyframes: {
        pulseDot: { "0%,100%": { opacity: "1" }, "50%": { opacity: ".35" } },
        rise: { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
      animation: { pulseDot: "pulseDot 1.8s ease-in-out infinite", rise: "rise .25s ease-out" },
    },
  },
  plugins: [],
};
export default config;
