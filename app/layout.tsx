import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";

import "./globals.css";

const bodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const displayFont = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-display",
  display: "swap",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "AetherView | Spatial Digital Twin Dashboard",
  description:
    "A premium Next.js dashboard for reviewing PlayCanvas Gaussian splat captures with WebGPU-first browser rendering.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): JSX.Element {
  return (
    <html lang="en">
      <body
        className={`${bodyFont.variable} ${monoFont.variable} ${displayFont.variable} font-sans antialiased tracking-tight`}
      >
        {children}
      </body>
    </html>
  );
}
