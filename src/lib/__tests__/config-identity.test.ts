/**
 * The behaviour these guard is the one you cannot see: an edit that commits
 * when it should have been discarded marks the board Unsaved, and looks
 * exactly like an edit that was correctly discarded until you read the badge.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveNameEdit,
  resolveDescriptionEdit,
  NAME_MAX,
  DESCRIPTION_MAX,
} from '../config-identity';

describe('resolveNameEdit', () => {
  it('commits a real change', () => {
    expect(resolveNameEdit('Tour rig', 'Untitled Board')).toBe('Tour rig');
  });

  it('discards an edit that changes nothing, so the board stays clean', () => {
    // Click the title, click away. This is the case that produces a false
    // Unsaved badge if it commits.
    expect(resolveNameEdit('Tour rig', 'Tour rig')).toBeNull();
  });

  it('discards an edit that differs only by surrounding whitespace', () => {
    expect(resolveNameEdit('  Tour rig  ', 'Tour rig')).toBeNull();
  });

  it('trims before committing', () => {
    expect(resolveNameEdit('  Tour rig  ', 'Untitled Board')).toBe('Tour rig');
  });

  it('reverts an empty name rather than committing one', () => {
    // `name` is NOT NULL in the schema and is the board's only handle on the
    // dashboard. Select-all-then-delete must not be able to erase it.
    expect(resolveNameEdit('', 'Tour rig')).toBeNull();
    expect(resolveNameEdit('   ', 'Tour rig')).toBeNull();
    expect(resolveNameEdit('\t\n', 'Tour rig')).toBeNull();
  });

  it('clamps to NAME_MAX', () => {
    const long = 'x'.repeat(NAME_MAX + 40);
    expect(resolveNameEdit(long, 'Tour rig')).toHaveLength(NAME_MAX);
  });

  it('discards when the clamped draft equals the current name', () => {
    // The clamp runs BEFORE the equality check, so re-committing an
    // already-clamped name is a no-op rather than a permanent dirty flag.
    const clamped = 'x'.repeat(NAME_MAX);
    expect(resolveNameEdit('x'.repeat(NAME_MAX + 10), clamped)).toBeNull();
  });
});

describe('resolveDescriptionEdit', () => {
  it('commits a real change', () => {
    expect(resolveDescriptionEdit('Fly rig, no power brick', '')).toBe(
      'Fly rig, no power brick'
    );
  });

  it('treats empty as a legal value - clearing a description is intentional', () => {
    // This is the one place the two functions deliberately disagree.
    expect(resolveDescriptionEdit('', 'Fly rig')).toBe('');
    expect(resolveNameEdit('', 'Fly rig')).toBeNull();
  });

  it('discards an edit that changes nothing', () => {
    expect(resolveDescriptionEdit('Fly rig', 'Fly rig')).toBeNull();
    expect(resolveDescriptionEdit('', '')).toBeNull();
  });

  it('clamps to DESCRIPTION_MAX', () => {
    const long = 'x'.repeat(DESCRIPTION_MAX + 100);
    expect(resolveDescriptionEdit(long, '')).toHaveLength(DESCRIPTION_MAX);
  });
});
