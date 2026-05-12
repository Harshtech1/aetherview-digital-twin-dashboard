import defaultTheme from "tailwindcss/defaultTheme";
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--surface-base)",
        foreground: "var(--text-primary)",
      },
      fontFamily: {
        sans: [
          "var(--font-body)",
          "\"SF Pro Text\"",
          "\"SF Pro Display\"",
          "Inter",
          ...defaultTheme.fontFamily.sans,
        ],
        mono: [
          "var(--font-mono)",
          "\"JetBrains Mono\"",
          ...defaultTheme.fontFamily.mono,
        ],
      },
      boxShadow: {
        glass: "0 28px 90px rgba(0, 0, 0, 0.45)",
      },
      keyframes: {
        "badge-pulse": {
          "0%, 100%": {
            boxShadow:
              "0 0 0 0 rgba(208, 186, 146, 0.22), 0 20px 42px rgba(0, 0, 0, 0.36)",
          },
          "55%": {
            boxShadow:
              "0 0 0 12px rgba(208, 186, 146, 0), 0 26px 56px rgba(0, 0, 0, 0.44)",
          },
        },
      },
      animation: {
        "badge-pulse": "badge-pulse 2.8s cubic-bezier(0.22, 1, 0.36, 1) infinite",
      },
    },
  },
  plugins: [],
};
export default config;
