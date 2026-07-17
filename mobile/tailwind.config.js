/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        tribe: {
          orange: "#FF6B35",
          dark: "#1C1C1E",
          surface: "#2C2C2E",
        },
      },
    },
  },
  plugins: [],
};
