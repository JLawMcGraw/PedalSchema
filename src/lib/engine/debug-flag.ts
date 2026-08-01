/**
 * Is a debug flag on, asked in a way that survives a Web Worker?
 *
 * `typeof window !== 'undefined'` is NOT a safe guard here. Bundlers replace
 * `typeof window` with a literal when building for the browser, so in a client
 * bundle the check folds to `true` - and a Worker is built as a client bundle
 * but has no `window`. The guard vanished, `window.location` threw
 * "window is not defined", and the optimizer worker died on every run:
 *
 *   ReferenceError: window is not defined
 *       at calculateGreedyPlacement
 *
 * runOptimize caught it and fell back to running inline, so the feature still
 * worked and nothing looked broken - the whole point of moving Optimize off
 * the main thread was silently lost. It took the worker reporting a STACK to
 * find, because the message alone arrives on the main thread with the
 * onmessage handler as its apparent origin.
 *
 * `globalThis` is a real runtime lookup that no bundler rewrites, and it is
 * defined in every environment this runs in - browser, worker, Node.
 */
export function isDebugEnabled(flag: string): boolean {
  const g = globalThis as { location?: { search?: string } };
  if (g.location?.search && new URLSearchParams(g.location.search).has(flag)) {
    return true;
  }
  // Offline replay: DEBUG_PLACEMENT=1 node ...
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  return !!env?.[flag.toUpperCase().replace(/[^A-Z0-9]/g, '_')] || !!env?.DEBUG_PLACEMENT;
}
