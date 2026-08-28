/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fffbeb", 100: "#fef3c7", 200: "#fde68a", 300: "#fcd34d",
          400: "#fbbf24", 500: "#f59e0b", 600: "#d97706", 700: "#b45309",
          800: "#92400e", 900: "#78350f"
        },
        navy: {
          50: "#f0f4fa", 100: "#dce4f0", 200: "#b8c9e1", 300: "#8ba8cc",
          400: "#5e85b5", 500: "#3d6699", 600: "#2d4f7a", 700: "#233d5f",
          800: "#1a2e4a", 900: "#111a2e", 950: "#0a1020"
        }
      }
    },
  },
  plugins: [],
}
