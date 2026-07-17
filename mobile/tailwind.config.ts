import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./providers/**/*.{js,ts,jsx,tsx}",
    "./hooks/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Solarized Dark palette
        solar: {
          base03: "#002b36", // darkest background
          base02: "#073642", // dark background highlights
          base01: "#586e75", // content tone (dark)
          base00: "#657b83", // body text (dark)
          base0: "#839496", // body text (light)
          base1: "#93a1a1", // content tone (light)
          base2: "#eee8d5", // light background highlights
          base3: "#fdf6e3", // lightest background
          yellow: "#b58900",
          orange: "#cb4b16",
          red: "#dc322f",
          magenta: "#d33682",
          violet: "#6c71c4",
          blue: "#268bd2",
          cyan: "#2aa198",
          green: "#859900",
        },
        // Tribe accent colors (matching web app)
        tribe: {
          flame: "#FF6B35",
          ember: "#FF3D00",
          ash: "#1A1A2E",
          coal: "#0F0F23",
          gold: "#d4a017",
          "gold-bright": "#FFD700",
        },
        // Semantic dark theme tokens
        dark: {
          bg: "#002b36",
          surface: "#073642",
          text: "#839496",
          "text-emphasis": "#93a1a1",
          border: "#586e75",
        },
        // Semantic light theme tokens
        light: {
          bg: "#fdf6e3",
          surface: "#eee8d5",
          text: "#657b83",
          "text-emphasis": "#586e75",
          border: "#93a1a1",
        },
      },
      fontFamily: {
        sans: ["System"],
      },
      animation: {
        pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
