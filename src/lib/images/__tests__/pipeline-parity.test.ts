import { describe, expect, it } from 'vitest';
import adapter from '../../../../scraper/image-pipeline-adapter';
import {
  clearLowAlphaMatte,
  dropStrayBackground,
  knockOutBackground,
} from '../knockout';
import { image, SPECIMENS } from './fixtures';

describe('browser and Sharp pipeline parity', () => {
  it.each(SPECIMENS)('returns identical pixels for $name', async ({ build }) => {
    const input = build();
    const encoded = await adapter.encode(input);
    const browser = knockOutBackground(input);
    const node = await adapter.knockOutBackground(encoded);
    const decoded = await adapter.decode(node.buf);

    expect(node.status).toBe(browser.status);
    expect(decoded.image.width).toBe(browser.image.width);
    expect(decoded.image.height).toBe(browser.image.height);
    expect(Array.from(decoded.image.data)).toEqual(Array.from(browser.image.data));
  });

  it('uses identical low-alpha matte cleanup', async () => {
    const input = image(20, 20, (x, y) =>
      x >= 5 && x < 15 && y >= 5 && y < 15
        ? [30, 30, 35, 255]
        : [220, 220, 220, 12]
    );
    const browser = clearLowAlphaMatte(input);
    const node = await adapter.clearLowAlphaMatte(await adapter.encode(input));
    const decoded = await adapter.decode(node.buf);

    expect(node.cleared).toBe(browser.cleared);
    expect(Array.from(decoded.image.data)).toEqual(Array.from(browser.image.data));
  });

  it('uses identical conservative stray-island cleanup', async () => {
    const input = image(30, 30, (x, y) => {
      if (x >= 10 && x < 20 && y >= 10 && y < 20) return [30, 30, 35, 255];
      if (x >= 24 && x < 26 && y >= 24 && y < 26) return [245, 245, 245, 255];
      return [0, 0, 0, 0];
    });
    const browser = dropStrayBackground(input);
    const node = await adapter.dropStrayBackground(await adapter.encode(input));
    const decoded = await adapter.decode(node.buf);

    expect(node.dropped).toBe(browser.dropped);
    expect(node.blobs).toBe(browser.blobs);
    expect(Array.from(decoded.image.data)).toEqual(Array.from(browser.image.data));
  });

  it('keeps ragged-border acceptance behind the catalogue-only adapter flag', async () => {
    const input = image(40, 40, (x, y) => [
      (x * 37) % 256,
      (y * 91) % 256,
      (x * y * 13) % 256,
      255,
    ]);
    const encoded = await adapter.encode(input);
    const ordinary = await adapter.knockOutBackground(encoded);
    const reviewedCatalogueException = await adapter.knockOutBackground(
      encoded,
      true,
      35,
      true
    );

    expect(ordinary.status).toBe('ragged-background');
    expect(ordinary.ok).toBe(false);
    expect(reviewedCatalogueException.status).toBe('knocked-out');
    expect(reviewedCatalogueException.ok).toBe(true);
  });
});
