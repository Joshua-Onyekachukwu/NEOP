import type { Metadata } from "next";
import "material-symbols";
import "remixicon/fonts/remixicon.css";
import "./globals.css";

import { Space_Grotesk, DM_Sans, JetBrains_Mono } from "next/font/google";
import Navbar from "@/components/Layout/Navbar";
import Footer from "@/components/Layout/Footer";
// Convex removed — data comes from Supabase only

const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const dmSans = DM_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Nigeria Election Observation — Live Results",
  description:
    "Independent, evidence-backed election observation and verification for Nigeria 2027",
  keywords: [
    "Nigeria",
    "election",
    "observation",
    "verification",
    "INEC",
    "2027",
    "live results",
    "democracy",
  ],
  openGraph: {
    title: "Nigeria Election Observation — Live Results",
    description:
      "Independent, evidence-backed election observation and verification for Nigeria 2027",
    type: "website",
    locale: "en_NG",
  },
  other: {
    "theme-color": "#0C0F14",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning style={{ colorScheme: 'dark' }}>
      <body
        className={`${spaceGrotesk.variable} ${dmSans.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <Navbar />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:bg-[var(--color-green)] focus:text-white focus:px-4 focus:py-2 focus:font-mono focus:text-sm"
        >
          Skip to content
        </a>
        {children}
        <Footer />
      </body>
    </html>
  );
}
