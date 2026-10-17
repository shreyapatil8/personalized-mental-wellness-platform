/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#283A32",
        sea: "#426F5D",
        ocean: "#527D91",
        coral: "#B9634E",
        amber: { DEFAULT: "#8A5A18" },
        mist: "#F2F5EF",
        paper: "#FCFAF5",
        teal: {
          50: "#EDF4EF", 100: "#DFEBE2", 200: "#C7DCCB", 300: "#A9C8B2",
          400: "#84AE93", 500: "#6B9B83", 600: "#56846D", 700: "#426F5D",
          800: "#315C4B", 900: "#294D40", 950: "#18352B"
        },
        slate: {
          50: "#F7F8F5", 100: "#EEF1EC", 200: "#DFE5DE", 300: "#C9D3CB",
          400: "#A2B0A6", 500: "#78877D", 600: "#606F66", 700: "#46564C",
          800: "#33443A", 900: "#283A32", 950: "#17251D"
        },
        lavender: { 50: "#F7F4FB", 100: "#EAE5F5", 200: "#DCD4EA", 700: "#655779" },
        peach: { 50: "#FCF4EE", 100: "#F8E5D8", 700: "#945C48" }
      },
      boxShadow: {
        soft: "0 16px 38px rgba(49, 92, 75, 0.08)",
        lift: "0 12px 26px rgba(49, 92, 75, 0.12)"
      }
    }
  },
  plugins: []
};
