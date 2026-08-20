import { describe, it, expect } from 'vitest';
import {
  copyName,
  withoutColumns,
  CONFIG_COLUMNS_NOT_COPIED,
  PLACED_PEDAL_COLUMNS_NOT_COPIED,
} from '@/lib/duplicate-configuration';

describe('copyName', () => {
  it('adds the suffix', () => {
    expect(copyName('test')).toBe('test (copy)');
  });

  /*
   * Duplicating a duplicate is the common case - it is how someone tries three
   * variants of a layout - and "test (copy) (copy)" is what it looks like when
   * only the first one was thought about.
   */
  it('counts instead of stacking suffixes', () => {
    expect(copyName('test (copy)')).toBe('test (copy 2)');
    expect(copyName('test (copy 2)')).toBe('test (copy 3)');
    expect(copyName('test (copy 9)')).toBe('test (copy 10)');
  });

  it('leaves a name that merely mentions copy alone', () => {
    expect(copyName('copy of test')).toBe('copy of test (copy)');
    expect(copyName('test (copyright)')).toBe('test (copyright) (copy)');
  });

  it('survives an empty base', () => {
    expect(copyName('')).toBe(' (copy)');
  });
});

describe('withoutColumns', () => {
  it('drops exactly the named columns', () => {
    const row = { id: 'x', name: 'test', board_id: 'b', is_public: true };
    expect(withoutColumns(row, ['id', 'is_public'])).toEqual({ name: 'test', board_id: 'b' });
  });

  /*
   * THE POINT OF THE WHOLE MODULE. A hand-written column list drops any column
   * a later migration adds; a strip list carries it. `configuration_pedals` has
   * gained four columns across four migrations, and each would have been
   * silently lost on the day it landed.
   */
  it('carries a column nobody has heard of yet', () => {
    const row = {
      id: 'x', configuration_id: 'c', created_at: 't',
      pedal_id: 'p', x_inches: 1, rotation_locked: true,
      some_column_added_next_year: 'kept',
    };
    const copied = withoutColumns(row, PLACED_PEDAL_COLUMNS_NOT_COPIED);
    expect(copied.some_column_added_next_year).toBe('kept');
    expect(copied.rotation_locked).toBe(true);
    expect(copied).not.toHaveProperty('id');
    expect(copied).not.toHaveProperty('configuration_id');
  });

  it('never carries publication state to a copy', () => {
    // is_public is the dangerous one: copying it fails nothing at all, and
    // puts a board the user believes is private behind a live URL.
    const row = { id: 'x', name: 'test', is_public: true, share_slug: 'abc', user_id: 'u' };
    const copied = withoutColumns(row, CONFIG_COLUMNS_NOT_COPIED);
    expect(copied).not.toHaveProperty('is_public');
    expect(copied).not.toHaveProperty('share_slug');
    expect(copied.user_id).toBe('u');
  });

  it('leaves the original untouched', () => {
    const row = { id: 'x', name: 'test' };
    withoutColumns(row, ['id']);
    expect(row).toEqual({ id: 'x', name: 'test' });
  });
});
