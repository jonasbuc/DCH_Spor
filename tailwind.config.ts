import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        field: {
          50: "#eef8ee",
          100: "#d9eed9",
          600: "#3d7c43",
          700: "#2f6235"
        },
        ink: {
          900: "#16201b",
          700: "#34443a",
          500: "#637168"
        }
      },
      boxShadow: {
        panel: "0 16px 40px rgba(22, 32, 27, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
