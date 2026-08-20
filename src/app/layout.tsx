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
  /*
   * Required for og:image. Next builds the image tag as an ABSOLUTE url and
   * has no way to know the deployed origin, so without this it warns at build
   * time and emits a localhost URL - which previews as a broken image
   * everywhere the link is actually pasted.
   */
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'http://localhost:3000')
  ),
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
    <html lang="en" className="dark" data-scroll-behavior="smooth">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        {/* The grain sits above everything and is inert: pointer-events:none,
            aria-hidden. See .grain in globals.css. */}
        <div className="grain" aria-hidden />
      </body>
    </html>
  );
}
