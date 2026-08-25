/**
 * The regression this guards: a real save failure reached a user as
 * "Failed to save: {}" - the work was gone and the reason with it.
 */
import { describe, it, expect } from 'vitest';
import { describeSaveError } from '../save-error';

describe('describeSaveError', () => {
  it('reads the message off an Error, where it is NOT enumerable', () => {
    // This is the `{}` case: JSON.stringify(new Error('x')) === '{}'
    const error = new TypeError('Failed to fetch');
    expect(JSON.stringify(error)).toBe('{}'); // the bug, in one line
    expect(describeSaveError(error)).toContain('Failed to fetch');
  });

  it('surfaces every field of a PostgrestError, including the code', () => {
    const text = describeSaveError({
      message: 'new row violates row-level security policy',
      details: 'Failing row contains (1, 2)',
      hint: 'Check the RLS policy',
      code: '42501',
    });
    expect(text).toContain('row-level security');
    expect(text).toContain('Failing row contains (1, 2)');
    expect(text).toContain('Check the RLS policy');
    expect(text).toContain('42501');
  });

  it('drops the stack trace supabase-js puts in details', () => {
    const text = describeSaveError({
      message: 'TypeError: Failed to fetch',
      details: 'TypeError: Failed to fetch\n    at foo (http://localhost:3000/chunk.js:1:1)',
    });
    expect(text).not.toContain('at foo');
    expect(text).not.toContain('\n');
  });

  it('does not repeat a detail that merely restates the message', () => {
    const text = describeSaveError({ message: 'boom', details: 'boom' });
    expect(text).toBe('boom');
  });

  it('is idempotent when a described failure is wrapped and described again', () => {
    const once = describeSaveError(new TypeError('Failed to fetch'));
    const twice = describeSaveError(new Error(once));
    expect(twice).toBe(once);
  });

  it('says something legible when the error carries nothing at all', () => {
    for (const empty of [{}, null, undefined, '']) {
      expect(describeSaveError(empty).length).toBeGreaterThan(10);
      expect(describeSaveError(empty)).not.toBe('{}');
    }
  });
});
