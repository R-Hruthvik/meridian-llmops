/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        meridian: {
          primary: "#6367FF",      // Vibrant Iris
          primaryHover: "#5054EE",
          secondary: "#8494FF",    // Soft Periwinkle
          lavender: "#C9BEFF",     // Lavender Glow
          lavenderLight: "#F0EBFF",
          blossom: "#FFDBFD",      // Pastel Blossom
          blossomLight: "#FFF5FE",
          bg: "#FAF8FF",           // Soft light lilac canvas
          canvas: "#F3EFFF",       // Secondary surface
          card: "#FFFFFF",         // Clean white card surface
          cardHover: "#F7F5FF",    // Interactive card hover
          border: "#D6CEFF",       // Subtle lavender border
          borderLight: "#ECE7FF",
          text: "#1E2050",         // Deep Indigo text (readable, non-black)
          textMuted: "#5F6594",    // Muted purple-slate
        }
      },
      boxShadow: {
        glow: "0 4px 20px -2px rgba(99, 103, 255, 0.35)",
        card: "0 4px 25px -4px rgba(99, 103, 255, 0.08)",
        cardHover: "0 8px 30px -4px rgba(99, 103, 255, 0.16)",
        blossom: "0 4px 20px -2px rgba(255, 219, 253, 0.6)",
      }
    },
  },
  plugins: [],
}
