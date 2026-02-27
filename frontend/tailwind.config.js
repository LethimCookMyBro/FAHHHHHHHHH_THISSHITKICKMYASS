/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Fira Sans", "Segoe UI", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
}
