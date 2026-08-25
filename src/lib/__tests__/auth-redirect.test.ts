import { describe, expect, it } from 'vitest';
import { safeAuthDestination } from '../auth-redirect';

describe('safeAuthDestination', () => {
  it('keeps application-local paths, queries, and fragments', () => {
    expect(safeAuthDestination('/dashboard')).toBe('/dashboard');
    expect(safeAuthDestination('/editor/abc?tab=power#output-2')).toBe(
      '/editor/abc?tab=power#output-2'
    );
  });

  it('rejects protocol-relative, absolute, backslash, and malformed destinations', () => {
    for (const value of [
      '//attacker.example',
      'https://attacker.example',
      '/\\attacker.example',
      '\\attacker.example',
      '%2F%2Fattacker.example',
      '',
      null,
    ]) {
      expect(safeAuthDestination(value)).toBe('/dashboard');
    }
  });
});
