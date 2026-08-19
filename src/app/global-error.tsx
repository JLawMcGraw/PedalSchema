'use client';

import { useEffect } from 'react';

/**
 * The last resort: a failure in the ROOT layout itself.
 *
 * This one replaces `<html>` and `<body>`, so it cannot use the app's layout,
 * its fonts, or its components - none of them rendered. That is also why the
 * styling is inline rather than Tailwind: if the root layout threw, the
 * stylesheet it imports may be exactly what is missing, and a page that
 * depends on the thing that just broke is not a fallback.
 *
 * Hard-coded to the palette in globals.css: substrate oklch(0.145 0.007 250)
 * and signal green oklch(0.80 0.17 152). If those change, change them here -
 * there is no way to share a token across this boundary.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[root] layout failed', error.digest ?? '(no digest)', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.75rem',
          padding: '1.5rem',
          textAlign: 'center',
          background: 'oklch(0.145 0.007 250)',
          color: 'oklch(0.96 0.004 250)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'oklch(0.72 0.012 250)' }}>
          PedalSchema
        </p>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>The app failed to start</h1>
        <p style={{ margin: 0, maxWidth: '40ch', color: 'oklch(0.72 0.012 250)' }}>
          Nothing was saved or lost. Reloading usually clears it.
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: '1rem',
            padding: '0.5rem 1rem',
            border: 0,
            borderRadius: '0.5rem',
            background: 'oklch(0.80 0.17 152)',
            color: 'oklch(0.19 0.04 152)',
            font: 'inherit',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
        {error.digest && (
          <p style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'oklch(0.72 0.012 250)' }}>
            reference {error.digest}
          </p>
        )}
      </body>
    </html>
  );
}
