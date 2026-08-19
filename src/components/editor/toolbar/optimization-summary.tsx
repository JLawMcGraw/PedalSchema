'use client';

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useConfigurationStore } from '@/store/configuration-store';
import { Button } from '@/components/ui/button';
import { X, CaretDown, CaretRight } from '@phosphor-icons/react';

/** One decimal, without rendering "-0" */
function fmt(n: number): string {
  const r = Math.round(n * 10) / 10;
  return (r === 0 ? 0 : r).toString();
}

/**
 * What the last Optimize traded off.
 *
 * Every number here comes from the dimension list the optimizer actually
 * scored with (COST_DIMENSIONS in engine/layout/routing-cost), so this panel
 * cannot describe a ranking different from the one that moved the pedals.
 * It reports regressions and no-ops in the same voice as improvements.
 */
export function OptimizationSummary() {
  const [expanded, setExpanded] = useState(false);
  const { summary, dismiss } = useConfigurationStore(
    useShallow((s) => ({
      summary: s.lastOptimization,
      dismiss: s.dismissOptimizationSummary,
    }))
  );

  if (!summary) return null;

  const improved = summary.delta < -0.05;
  const worse = summary.delta > 0.05;

  return (
    <div
      className={[
        'flex flex-col border-b text-sm',
        improved ? 'bg-emerald-500/10' : worse ? 'bg-amber-500/10' : 'bg-muted/40',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 px-2 sm:px-4 py-1.5">
        <span className="font-medium shrink-0">Optimized:</span>
        <span className="min-w-0 truncate">{summary.headline}</span>

        {summary.changes.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 gap-1 shrink-0 ml-auto"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? <CaretDown className="h-3.5 w-3.5" /> : <CaretRight className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">
              {summary.changes.length} {summary.changes.length === 1 ? 'change' : 'changes'}
            </span>
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          className={`h-6 w-6 p-0 shrink-0 ${summary.changes.length > 0 ? '' : 'ml-auto'}`}
          onClick={dismiss}
          aria-label="Dismiss optimization summary"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {expanded && (
        <div className="px-2 sm:px-4 pb-2">
          <table className="w-full max-w-md text-xs">
            <tbody>
              {summary.changes.map((c) => (
                <tr key={c.key}>
                  <td className="py-0.5 pr-4 text-muted-foreground">{c.label}</td>
                  <td className="py-0.5 text-right tabular-nums">
                    {c.countDelta !== undefined && c.countDelta !== 0
                      ? `${c.countDelta > 0 ? '+' : ''}${c.countDelta}`
                      : `${c.delta > 0 ? '+' : ''}${fmt(c.delta)}`}
                  </td>
                </tr>
              ))}
              <tr className="border-t">
                <td className="py-0.5 pr-4 font-medium">total score</td>
                <td className="py-0.5 text-right tabular-nums font-medium">
                  {fmt(summary.before)} &rarr; {fmt(summary.after)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
