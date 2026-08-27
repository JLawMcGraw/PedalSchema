import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BoardThumbnail } from '../boards/board-thumbnail';
import { AssemblingBoard } from '../landing/assembling-board';

function element(markup: string, attribute: string, value: string): string {
  const start = markup.indexOf(`${attribute}="${value}"`);
  expect(start).toBeGreaterThanOrEqual(0);
  const opening = markup.lastIndexOf('<', start);
  const closing = markup.indexOf('>', start);
  return markup.slice(opening, closing + 1);
}

describe('pedal physical scale', () => {
  it('uses catalogue width and depth for the landing pedal image', () => {
    const markup = renderToStaticMarkup(
      <AssemblingBoard
        pedals={{
          'BOSS PW-3': {
            imageUrl: '/pw-3.png',
            widthInches: 3.25,
            depthInches: 7.5,
          },
        }}
      />
    );

    const groupStart = markup.indexOf('data-pedal-key="BOSS PW-3"');
    const groupEnd = markup.indexOf('</g>', groupStart);
    const pedal = markup.slice(groupStart, groupEnd);
    expect(pedal).toContain('width="3.25"');
    expect(pedal).toContain('height="7.5"');
    expect(pedal).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it('keeps the landing fallback at the recorded catalogue dimensions', () => {
    const markup = renderToStaticMarkup(<AssemblingBoard />);
    const groupStart = markup.indexOf('data-pedal-key="Strymon Timeline"');
    const groupEnd = markup.indexOf('</g>', groupStart);
    const pedal = markup.slice(groupStart, groupEnd);
    expect(pedal).toContain('width="6.75"');
    expect(pedal).toContain('height="5.1"');
  });

  it('uses the same physical dimensions and rotation in board thumbnails', () => {
    const markup = renderToStaticMarkup(
      <BoardThumbnail
        widthInches={32}
        depthInches={16}
        pedals={[
          {
            xInches: 1,
            yInches: 2,
            widthInches: 3.15,
            depthInches: 7.56,
            rotation: 90,
            category: 'filter',
            imageUrl: '/pw-3.png',
          },
        ]}
      />
    );

    const pedal = element(markup, 'data-thumbnail-pedal', '0');
    expect(pedal).toContain('width="3.15"');
    expect(pedal).toContain('height="7.56"');
    expect(pedal).toContain('transform="rotate(90, 4.78, 3.575)"');
    expect(pedal).toContain('preserveAspectRatio="xMidYMid meet"');
  });
});
