import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // A template, so the pages that name a board or a pedal do not each repeat
  // the product name by hand - two of them already did, inconsistently.
  title: {
    default: "PedalSchema",
    template: "%s - PedalSchema",
  },
  description:
    "Plan a pedalboard: place the pedals, route the cables, check the power budget.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `dark` is not a theme switch - there is one palette and it is on :root.
    // The class is what lets shadcn's 22 `dark:` utilities resolve; the
    // @custom-variant in globals.css keys off it. See design-direction.md.
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
