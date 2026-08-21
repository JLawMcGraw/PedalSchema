import type { NextConfig } from "next";

/**
 * IMAGE OPTIMISATION IS NOT A NICETY HERE - IT IS THE EGRESS BILL.
 *
 * Measured 2026-08-21, against the live bucket: 85 objects, 77.56 MB, the
 * largest a 7.42 MB PNG of an amp. Every one of them was served to the
 * browser at full resolution by a raw `<img>` tag and then painted into a
 * 144px-tall box. One `/pedals` load pulled 25.97 MB; one editor load pulled
 * 12.13 MB. Supabase reported 40.78 GB of CACHED egress against a 5.5 GB
 * allowance, and `cf-cache-status: HIT` on those responses is precisely why
 * it billed as cached.
 *
 * Routing them through Next's optimiser means the ORIGINAL is fetched once
 * per (src, width, quality), cached on the server, and served on as WebP at
 * the size it is actually drawn at. The Supabase origin stops being in the
 * browser's path at all.
 *
 * `minimumCacheTTL` is 30 days on purpose: these are content-addressed UUID
 * filenames that never change, so re-fetching an original is pure waste. The
 * stored objects still carry `max-age=3600` from upload, which is what made
 * a browser re-pull 26 MB every hour; that is now the optimiser's problem
 * once a month rather than every visitor's, every hour.
 */
const supabaseHostname = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return "**.supabase.co";
  try {
    return new URL(url).hostname;
  } catch {
    return "**.supabase.co";
  }
})();

const nextConfig: NextConfig = {
  images: {
    /*
     * Narrow on purpose. remotePatterns is what stops the optimiser being
     * turned into an open proxy, so it is pinned to this project's storage
     * host and to the public object path - not to the host in general.
     */
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseHostname,
        pathname: "/storage/v1/object/public/**",
      },
    ],
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
};

export default nextConfig;
