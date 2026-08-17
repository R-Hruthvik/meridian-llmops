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
          secondary: "#8494FF",    // Soft Periwinkle
          lavender: "#C9BEFF",     // Lavender Glow
          blossom: "#FFDBFD",      // Pastel Blossom
          bg: "#090B14",           // Deep canvas
          card: "#111425",         // Surface card
          cardHover: "#181C33",    // Interactive card
          border: "#1F2544",       // Subtle border
          borderGlow: "rgba(201, 190, 255, 0.25)",
          text: "#F1F3FD",
          muted: "#8F96B3",
        }
      },
      boxShadow: {
        glow: "0 0 20px -5px rgba(99, 103, 255, 0.35)",
        glowLavender: "0 0 20px -5px rgba(201, 190, 255, 0.25)",
        glass: "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
      }
    },
  },
  plugins: [],
}
