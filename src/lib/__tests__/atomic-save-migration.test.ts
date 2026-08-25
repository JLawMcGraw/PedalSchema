import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260825000001_atomic_configuration_saves.sql'),
  'utf8'
);

describe('atomic configuration save migration', () => {
  it('defines durable overrides and optimistic revisions', () => {
    expect(migration).toContain('ADD COLUMN revision BIGINT NOT NULL DEFAULT 1');
    expect(migration).toContain('ADD COLUMN location_override BOOLEAN NOT NULL DEFAULT false');
  });

  it('locks and verifies the owned row before changing anything', () => {
    const lock = migration.indexOf('FOR UPDATE;');
    const update = migration.indexOf('UPDATE configurations');
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(update);
    expect(migration).toContain('AND user_id = auth.uid()');
    expect(migration).toContain("ERRCODE = '40001'");
  });

  it('keeps configuration update, prune, and upsert inside the RPC', () => {
    expect(migration).toContain('UPDATE configurations');
    expect(migration).toContain('DELETE FROM configuration_pedals');
    expect(migration).toContain('INSERT INTO configuration_pedals');
    expect(migration).toContain('ON CONFLICT (id) DO UPDATE');
  });
});
