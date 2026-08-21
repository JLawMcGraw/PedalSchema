#!/usr/bin/env node
/**
 * The catalogue cache must not change WHAT the editor is offered.
 *
 * `lib/catalogue` replaced three unconditional queries with a cached read of
 * the `is_system = true` rows plus a live read of the caller's own. That is
 * only equivalent if those two sets partition the table - so this gate proves
 * the partition against the real database rather than against the policy text.
 *
 * The failure it exists to catch is silent: a row with `is_system = false` and
 * `created_by = null` belongs to neither half, so it would vanish from the
 * library with no error anywhere. Nothing in the app would report it.
 *
 * Usage: node .claude/scripts/verify-catalogue-cache.js
 */
const { loadEnv } = require('./lib/twin');
const { createClient } = require('@supabase/supabase-js');

const TABLES = ['pedals', 'amps', 'power_supplies'];

(async () => {
  loadEnv();

  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  let failed = 0;

  for (const table of TABLES) {
    const { data: all, error } = await service
      .from(table)
      .select('id, is_system, created_by');
    if (error) {
      console.error(`FAIL ${table}: read failed - ${error.message}`);
      failed++;
      continue;
    }

    const system = all.filter((r) => r.is_system === true);
    const owned = all.filter((r) => r.is_system !== true && r.created_by != null);
    const orphaned = all.filter((r) => r.is_system !== true && r.created_by == null);

    console.log(
      `${table}: ${all.length} total = ${system.length} system + ${owned.length} owned + ${orphaned.length} orphaned`
    );

    // 1. The partition must be total. An orphan is invisible to both halves.
    if (orphaned.length > 0) {
      console.error(
        `  FAIL: ${orphaned.length} row(s) are neither system nor owned - these would ` +
          `disappear from the catalogue. ids: ${orphaned.slice(0, 5).map((r) => r.id).join(', ')}`
      );
      failed++;
    }

    // 2. The anon role must actually be able to read the cached half. The cache
    //    is filled by a session-less client; if RLS refuses it the library comes
    //    back empty for everyone.
    const { data: anonRows, error: anonError } = await anon
      .from(table)
      .select('id')
      .eq('is_system', true);
    if (anonError) {
      console.error(`  FAIL: anon cannot read system ${table} - ${anonError.message}`);
      failed++;
    } else if (anonRows.length !== system.length) {
      console.error(
        `  FAIL: anon sees ${anonRows.length} system ${table}, service role sees ${system.length}`
      );
      failed++;
    } else {
      console.log(`  ok: anon reads all ${anonRows.length} system rows`);
    }
  }

  if (failed > 0) {
    console.error(`\nverify-catalogue-cache: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\nverify-catalogue-cache: PASS');
})();
