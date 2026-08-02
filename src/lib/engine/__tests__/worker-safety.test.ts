/**
 * Nothing in the engine may guard on `typeof window`.
 *
 * debug-flag.ts explains why, and exists to be the alternative:
 *
 *   Bundlers replace `typeof window` with a literal when building for the
 *   browser, so in a client bundle the check folds to `true` - and a Worker is
 *   built as a client bundle but has no `window`.
 *
 * That module was written after this exact bug bit once. It fixed the instance
 * (layout/index.ts) and left the CLASS open: any engine file could reintroduce
 * the pattern, and it would stay harmless right up until an import edge pulled
 * that file into optimize.worker.ts's graph.
 *
 * Which is what happened. P1.5 made layout/routing-cost.ts import
 * cables/route-cables.ts to unify the two routers, and route-cables.ts carried
 * a `typeof window` guard for its DEBUG_PATHS flag. The whole engine is
 * worker-eligible by design ("The engine is pure and imports nothing from
 * React, Next or the DOM" - optimize.worker.ts), so the invariant belongs to
 * the engine as a whole, not to whichever files happen to be reachable today.
 *
 * The failure mode is worse than it sounds. This guard folds at MODULE
 * EVALUATION time, so the worker dies before `self.onmessage` is assigned:
 * the posted message is never answered, worker.onerror never reaches
 * run-optimize's pending map, the promise never settles, and the Optimize
 * button spins forever. A throw INSIDE the handler would have been caught and
 * fallen back inline; this one cannot be.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ENGINE = path.join(__dirname, '..');
const WORKER_ENTRY = path.join(ENGINE, 'layout', 'optimize.worker.ts');

/** Resolve a relative import specifier to a real .ts file, or null. */
function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null; // '@/types' is type-only and erased
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Everything that actually ends up inside the worker bundle.
 *
 * Reachability is the real invariant, not "lives under engine/".
 * run-optimize.ts guards on `typeof window` quite correctly - it is the module
 * that DECIDES whether to construct a worker, and runs only on the main
 * thread. A blanket engine-wide ban would flag it and teach the next reader to
 * add exceptions, which is how a guard rots.
 */
function workerGraph(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    const specs = [...source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of specs) {
      const resolved = resolveImport(file, spec);
      if (resolved) stack.push(resolved);
    }
  }
  return [...seen];
}

describe('engine is worker-safe', () => {
  const files = workerGraph(WORKER_ENTRY);

  it('reaches the modules it means to check', () => {
    // Guards the guard: a broken walk makes every assertion below vacuous.
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain(path.join(ENGINE, 'layout', 'index.ts'));
    expect(files).toContain(path.join(ENGINE, 'layout', 'routing-cost.ts'));
    // This edge is the one P1.5 added, and the reason the bug was reachable.
    expect(files).toContain(path.join(ENGINE, 'cables', 'route-cables.ts'));
    // The worker's HOST is not worker code and must not be swept in.
    expect(files).not.toContain(path.join(ENGINE, 'layout', 'run-optimize.ts'));
  });

  it('no engine module guards on `typeof window`', () => {
    const offenders = files.filter((f) => {
      const source = fs.readFileSync(f, 'utf8');
      // debug-flag.ts documents the hazard in prose; only flag real code.
      const withoutComments = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      return /typeof\s+window/.test(withoutComments);
    });

    expect(
      offenders.map((f) => path.relative(ENGINE, f)),
      'use isDebugEnabled() from engine/debug-flag instead - see that file for why'
    ).toEqual([]);
  });

  it('no engine module touches window/document/localStorage directly', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const source = fs.readFileSync(f, 'utf8');
      const withoutComments = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      if (/\b(window|document|localStorage|sessionStorage)\s*\./.test(withoutComments)) {
        offenders.push(path.relative(ENGINE, f));
      }
    }
    expect(
      offenders,
      'the engine runs in optimize.worker.ts, where none of these exist'
    ).toEqual([]);
  });
});
