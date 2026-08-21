import { ImageResponse } from 'next/og';
import { createClient } from '@/lib/supabase/server';
import { loadConfiguration } from '@/lib/load-configuration';
import { isValidShareSlug } from '@/lib/share-link';
import { getCategoryColor } from '@/lib/constants/pedal-categories';
import { derivePowerSummary } from '@/lib/engine/power';
import { rotatedFootprint } from '@/lib/engine/geometry/rotation';

/**
 * What a shared board looks like when someone pastes the link.
 *
 * A shared link is most people's first sight of this app, and it was
 * previewing as a bare title on a blank card - so the one thing the product
 * makes was the one thing the preview did not show. This draws the board.
 *
 * DELIBERATELY THE SAME DRAWING AS THE DASHBOARD CARD: blocks in their real
 * positions, coloured by signal family. No photos, no cables, no labels. The
 * reasoning in `board-thumbnail` applies harder here - this render happens on
 * a crawler's request, with no browser and a time budget.
 *
 * It is NOT that component, though, and could not be. `BoardThumbnail` is an
 * `<svg>` with `viewBox` and Tailwind classes; this runs through satori, which
 * takes a subset of CSS and no stylesheet at all. Hence positioned divs, one
 * explicit `display: flex` per box, and hex colours - the app's own tokens are
 * `oklch()`, which satori does not parse.
 */
export const runtime = 'nodejs';
export const alt = 'A pedalboard layout';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/* The app's substrate and hairline, resolved out of oklch() to hex. */
const BACKGROUND = '#16181d';
const PANEL = '#1e2027';
const BORDER = '#3a3d46';
const FOREGROUND = '#f2f3f5';
const MUTED = '#a8adb8';
const SIGNAL = '#5ee9a4';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  /*
   * A missing or unpublished board still has to return an IMAGE. Throwing
   * here gives the crawler a 500 and the link previews as nothing at all,
   * which is worse than the plain card this replaces.
   */
  const config = isValidShareSlug(slug)
    ? await loadConfiguration(await createClient(), { shareSlug: slug }, { includeLibrary: false })
    : null;

  if (!config) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%', height: '100%', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            background: BACKGROUND, color: MUTED, fontSize: 44,
          }}
        >
          PedalSchema
        </div>
      ),
      size
    );
  }

  const boardW = config.board.widthInches > 0 ? config.board.widthInches : 24;
  const boardD = config.board.depthInches > 0 ? config.board.depthInches : 12;

  // The drawing area, and the scale that fits the board inside it.
  const AREA = { width: 1104, height: 378 };
  const scale = Math.min(AREA.width / boardW, AREA.height / boardD);
  const drawnW = boardW * scale;
  const drawnH = boardD * scale;

  const power = derivePowerSummary(config.placedPedals, config.pedalsById);
  const model = [config.board.manufacturer, config.board.name].filter(Boolean).join(' ');

  const pedals = config.placedPedals.map((placed) => {
    const pedal = config.pedalsById[placed.pedalId] ?? placed.pedal;
    const { widthInches: w, depthInches: d } = rotatedFootprint(
      { widthInches: pedal?.widthInches ?? 2.5, depthInches: pedal?.depthInches ?? 4.5 },
      placed.rotationDegrees ?? 0
    );
    return {
      left: placed.xInches * scale,
      top: placed.yInches * scale,
      width: w * scale,
      height: d * scale,
      colour: pedal ? getCategoryColor(pedal.category) : MUTED,
    };
  });

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          background: BACKGROUND, color: FOREGROUND, padding: 48,
        }}
      >
        {/* Name and model */}
        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 24 }}>
          <div style={{ fontSize: 56, fontWeight: 600, letterSpacing: -1 }}>{config.name}</div>
          <div style={{ fontSize: 24, color: MUTED, marginTop: 6 }}>{model}</div>
        </div>

        {/* The board */}
        <div
          style={{
            display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            style={{
              display: 'flex', position: 'relative',
              width: drawnW, height: drawnH,
              background: PANEL, border: `2px solid ${BORDER}`,
              // A pedal sitting outside the board's bounds is a real state -
              // it is what a collision or an over-wide board looks like mid
              // edit - and without this it paints over the title.
              overflow: 'hidden',
            }}
          >
            {pedals.map((p, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: p.left, top: p.top, width: p.width, height: p.height,
                  background: p.colour, opacity: 0.85,
                }}
              />
            ))}
          </div>
        </div>

        {/* The register, same fields the editor's toolbar readout carries */}
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 40,
            marginTop: 24, paddingTop: 20, borderTop: `2px solid ${BORDER}`,
            fontSize: 24,
          }}
        >
          <div style={{ display: 'flex', gap: 10 }}>
            <span style={{ color: MUTED }}>PEDALS</span>
            <span>{config.placedPedals.length}</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <span style={{ color: MUTED }}>DRAW</span>
            {/* An unrecorded draw is not a draw of zero - see engine/power. */}
            <span>{power.unknown.length > 0 ? '≥' : ''}{power.knownTotalMa}mA</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <span style={{ color: MUTED }}>BOARD</span>
            <span>{boardW}×{boardD}in</span>
          </div>
          <div style={{ display: 'flex', marginLeft: 'auto', color: SIGNAL }}>PedalSchema</div>
        </div>
      </div>
    ),
    size
  );
}
