import Link from 'next/link';
import { RailsMark } from '@/components/layout/rails-mark';

export function AuthShell({
  mode,
  children,
}: {
  mode: 'login' | 'signup';
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex min-h-screen flex-col bg-background"
      style={{
        backgroundImage:
          'linear-gradient(to right, oklch(0.345 0.013 250 / .18) 1px, transparent 1px),' +
          'linear-gradient(to bottom, oklch(0.345 0.013 250 / .18) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
      }}
    >
      <header className="flex h-11 shrink-0 items-center border-b border-border bg-background/90 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <RailsMark />
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.2em]">
            PedalSchema
          </span>
        </Link>
        <Link
          href={mode === 'login' ? '/signup' : '/login'}
          className="ml-auto font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
        >
          {mode === 'login' ? 'Create account' : 'Log in'}
        </Link>
      </header>

      <main className="mx-auto grid w-full max-w-[1120px] flex-1 items-center gap-10 px-4 py-10 sm:px-8 lg:grid-cols-[1fr_440px] lg:gap-20">
        <section className="max-w-[560px]">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
            Board planning · Actual dimensions
          </p>
          <h1 className="mt-4 text-[clamp(2.4rem,6vw,4.5rem)] font-bold leading-[0.98] tracking-[-0.04em]">
            Measure twice.
            <br />
            Wire once.
          </h1>
          <p className="mt-5 max-w-[480px] text-base leading-relaxed text-muted-foreground">
            Keep your boards, pedal dimensions, signal order, cable runs and power budget in one measured plan.
          </p>
          <dl className="mt-8 grid max-w-[480px] grid-cols-3 border-y border-border py-3 font-mono">
            {[
              ['FIT', 'TO SCALE'],
              ['ROUTE', 'PER JACK'],
              ['POWER', 'PER OUTPUT'],
            ].map(([label, value]) => (
              <div key={label} className="border-r border-border px-3 first:pl-0 last:border-r-0 last:pr-0">
                <dt className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {label}
                </dt>
                <dd className="mt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="w-full">{children}</div>
      </main>
    </div>
  );
}
