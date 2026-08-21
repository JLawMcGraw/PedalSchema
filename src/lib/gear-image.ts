/**
 * An optimised URL for a gear photo, for the places `next/image` cannot go.
 *
 * The card and detail views use `<Image>` directly. The editor canvas cannot:
 * a pedal photo there is an SVG `<image href>` clipped to the pedal body and
 * rotated with it, and `next/image` renders an `<img>` in a DOM tree, not an
 * SVG element. So the canvas asks the optimiser for a URL by hand.
 *
 * This is the same endpoint `<Image>` calls - there is no second pipeline and
 * no second cache. What it saves is what the measurement on 2026-08-21 found:
 * one editor load pulled 12.13 MB of full-resolution PNG out of Supabase
 * Storage to draw pedals a couple of hundred pixels wide.
 */

/**
 * The widths Next will actually generate: `imageSizes` then `deviceSizes`.
 * Asking for anything else is refused by the optimiser, so a request is
 * snapped UP to the next one - never down, or a zoomed-in canvas goes soft.
 */
const NEXT_IMAGE_WIDTHS = [
  16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840,
];

export function gearImageUrl(src: string, targetWidth: number): string {
  // Only remote originals go through the optimiser. A data: URI is already
  // inline, and a relative path is served by this app anyway - routing either
  // through /_next/image would cost a round trip to save nothing.
  if (!/^https?:\/\//i.test(src)) return src;

  const width = NEXT_IMAGE_WIDTHS.find((w) => w >= targetWidth) ?? NEXT_IMAGE_WIDTHS.at(-1)!;
  /*
   * `q` IS REQUIRED, and the first version of this left it off.
   *
   * Next 16 answers a hand-built optimiser request without one with
   * `400 "q" parameter (quality) is required`. The default quality applies to
   * the <Image> COMPONENT, which always emits a `q` of its own - it is not a
   * default the endpoint fills in. Nothing threw: the canvas `<image>` fired
   * onError, `showImage` went false, and 22 pedal photos silently stopped
   * rendering. verify-pedal-images caught it; a screenshot would not have,
   * because a pedal with no photo is a legitimate state that looks fine.
   *
   * 75 is Next's default and the only value in the `images.qualities`
   * allow-list, so using anything else would need config for no visible gain.
   */
  return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=75`;
}
