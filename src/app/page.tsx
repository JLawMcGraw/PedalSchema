import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/server';
import { RailsMark } from '@/components/layout/rails-mark';
import { AssemblingBoard } from '@/components/landing/assembling-board';
import { OpenEditorCta } from '@/components/landing/open-editor-cta';
import { GuestLink } from '@/components/landing/guest-link';
import {
  CHAIN_STAGES,
  PEDAL_CATEGORIES,
  getFamilyColor,
  type ChainStage,
} from '@/lib/constants/pedal-categories';

const NAV_LINK =
  'font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors duration-200 hover:text-foreground';

/**
 * What each stage is FOR, in a sentence.
 *
 * The only hand-written thing in this section. The stages themselves, their
 * order, and their colours are all read off the engine's own table below - see
 * `chainStages()`. Keyed by `ChainStage` so the type makes adding a stage
 * without writing its gloss a compile error rather than a blank cell.
 */
const STAGE_NOTES: Record<ChainStage, string> = {
  tuner: 'First, on a clean signal before anything colours it.',
  filter: 'Wah, envelope filters and octave, tracking your picking.',
  dynamics: 'Compressors evening out the raw peaks before the dirt.',
  gain: 'Drives and fuzz in the middle, lower gain before higher.',
  eq: 'Shaping what the gain stages just made, before it moves.',
  modulation: 'Chorus, phaser, flanger and tremolo, texturing the dirt.',
  time: 'Delay and reverb last, for space around the finished sound.',
  utility: 'Gates, volume and loopers - the catch-all, placed per pedal rather than as a block.',
};

/**
 * The chain stages, DERIVED - not a list typed into this page.
 *
 * The handoff drew six stages in an order of its own. The app orders by
 * `PEDAL_CATEGORIES.defaultOrder` and bands those positions with
 * `CHAIN_STAGES`, and the two disagreed: the drawing put dynamics before
 * filters where the engine puts filter at 20 and compressor at 30, and it
 * omitted EQ and utility entirely.
 *
 * Reproducing the drawing would have made this section a second opinion about
 * pedal order, wrong the moment the optimizer changed and wrong SILENTLY,
 * because nothing would fail. So the page reads the engine's table, and what
 * it shows is what the app will actually do to your board.
 *
 * ORDER COMES FROM `CHAIN_STAGES` AS DECLARED, and is deliberately not
 * re-derived from `defaultOrder`. Re-deriving it was the first attempt and it
 * was wrong: a stage is a BANDING of positions, not a contiguous run of them,
 * so sorting stages by the lowest position they contain put UTILITY fifth -
 * between Gain and EQ - because a noise gate sits at 90. Utility also holds
 * volume at 150 and loopers at 160, so no single position is honest for it,
 * and "the chain goes ... gain, utility, EQ ..." is a claim the app does not
 * make. `CHAIN_STAGES` is already hand-ordered in the engine and puts the
 * catch-all last, which is the answer.
 *
 * The colour is the family of the categories banded into that stage - taken by
 * majority, because a stage is a band of positions and not a family.
 */
function chainStages() {
  return CHAIN_STAGES.map((stage) => {
    const categories = PEDAL_CATEGORIES.filter((c) => c.stage === stage.value).sort(
      (a, b) => a.defaultOrder - b.defaultOrder
    );
    const tally = new Map<string, number>();
    for (const c of categories) tally.set(c.family, (tally.get(c.family) ?? 0) + 1);
    const family = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'utility';
    return {
      value: stage.value,
      label: stage.label,
      colour: getFamilyColor(family as never),
      note: STAGE_NOTES[stage.value],
    };
  });
}

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const stages = chainStages();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/*
        THE SAME 44px MONO BAR THE DASHBOARD USES.

        Not the app's <Header>, because the links differ for a logged-out
        visitor - but the same height and the same register, so the app does
        not change identity the moment you sign in.
      */}
      <header className="flex h-11 shrink-0 items-center gap-4 border-b border-border px-6">
        <Link href="/" className="flex items-center gap-2">
          <RailsMark />
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.2em]">
            PedalSchema
          </span>
        </Link>
        <nav className="ml-auto flex items-center gap-[18px]">
          {/* Both live behind the (dashboard) auth redirect - see GuestLink. */}
          <GuestLink href="/boards" className={NAV_LINK}>
            Boards
          </GuestLink>
          <GuestLink href="/pedals" className={NAV_LINK}>
            Pedal database
          </GuestLink>
          <Link href={user ? '/dashboard' : '/login'} className={NAV_LINK}>
            {user ? 'Dashboard' : 'Log in'}
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        {/*
          HERO - the page as a drafting sheet.

          The app measures things, so the page should look like it was drawn by
          something that measures things: a 48px grid ground, slug lines in the
          corners, and a dimension rule under the board carrying the board's
          own spec. It is also the register the editor's toolbar is in.
        */}
        <section
          className="border-b border-border"
          style={{
            backgroundImage:
              'linear-gradient(to right, oklch(0.345 0.013 250 / .30) 1px, transparent 1px),' +
              'linear-gradient(to bottom, oklch(0.345 0.013 250 / .30) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        >
          <div className="mx-auto max-w-[1280px] px-8 pb-14 pt-15">
            <div className="flex items-baseline justify-between font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <span>Sheet 01 — Pedalboard planner</span>
              <span>Scale 1:1 · Inches</span>
            </div>

            <h1 className="mt-8 max-w-[900px] text-[clamp(2.25rem,6vw,60px)] font-bold leading-[1.02] tracking-[-0.032em]">
              Your rig, to scale, before you spend a cent.
            </h1>
            <p className="mt-5 max-w-[620px] text-[17px] leading-[1.55] text-muted-foreground">
              Draw the board you own, drop in the pedals you own, and see whether they
              actually fit — then let it work out the signal order, the cable runs and the
              power draw before you buy anything.
            </p>

            <div className="mt-[30px]">
              <OpenEditorCta signedIn={Boolean(user)} />
            </div>

            {/* THE PRODUCT, WORKING. */}
            <div className="mt-11 px-0 sm:px-10">
              <AssemblingBoard className="h-[260px] w-full sm:h-[420px]" />
            </div>

            {/* The dimension rule: the board's own spec, stated as a drawing
                states it. */}
            <div className="mt-6 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              <span aria-hidden>□</span>
              <span className="h-px flex-1 bg-border" />
              <span>32.0 in</span>
              <span className="h-px flex-1 bg-border" />
              <span className="hidden sm:inline">Pedaltrain Classic Pro · 15 pedals · 1400mA</span>
            </div>
          </div>
        </section>

        {/* DETAIL A - what the optimizer does. */}
        <section className="mx-auto max-w-[1280px] px-8 py-14">
          <div className="flex flex-col gap-14 lg:flex-row">
            <div className="w-full shrink-0 lg:sticky lg:top-8 lg:h-fit lg:w-[380px]">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
                Optimize
              </p>
              <h2 className="mt-3 text-4xl font-bold leading-[1.12] tracking-[-0.024em]">
                It knows where each pedal goes.
              </h2>
              <p className="mt-4 text-base leading-[1.55] text-muted-foreground">
                Every pedal you add is placed by what it does to the signal, in the order
                players actually use. Hit Optimize and the board rearranges itself — and
                tells you what it traded away to do it.
              </p>
            </div>

            <div className="min-w-0 flex-1 border border-border bg-card">
              <div className="flex h-[46px] items-center justify-between border-b border-border bg-[oklch(0.185_0.008_250)] px-[18px]">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Signal chain order
                </span>
                <span className="flex h-[26px] items-center bg-primary px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-foreground">
                  Optimize
                </span>
              </div>
              {stages.map((stage, i) => (
                <div
                  key={stage.value}
                  className={`flex items-center gap-3.5 px-[18px] py-3.5 ${
                    i < stages.length - 1 ? 'border-b border-border/60' : ''
                  }`}
                >
                  <span className="w-5 shrink-0 font-mono text-[10px] tabular-nums tracking-[0.1em] text-muted-foreground">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0"
                    style={{ backgroundColor: stage.colour }}
                  />
                  <span className="w-[128px] shrink-0 font-mono text-xs font-semibold uppercase tracking-[0.13em] sm:w-[172px]">
                    {stage.label}
                  </span>
                  <span className="min-w-0 flex-1 text-sm leading-[1.5] text-muted-foreground">
                    {stage.note}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* DETAIL B - the editor. */}
        <section className="mx-auto max-w-[1280px] px-8 py-14">
          <div className="max-w-[720px]">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
              The editor
            </p>
            <h2 className="mt-3 text-4xl font-bold leading-[1.12] tracking-[-0.024em]">
              One screen, and every number on it is live.
            </h2>
            <p className="mt-4 text-base leading-[1.55] text-muted-foreground">
              Drag a pedal and the cable lengths, the current draw and the fit verdict all
              move with it. Nothing is a form you fill in and submit.
            </p>
          </div>

          {/* The tick-framed box. Four 10px corner ticks in the accent, at the
              OUTER corners - a drawing's registration marks, not a border. */}
          <div className="relative mt-10 border border-border bg-[oklch(0.185_0.008_250)] p-3">
            {[
              'absolute -left-px -top-px border-l-2 border-t-2',
              'absolute -right-px -top-px border-r-2 border-t-2',
              'absolute -bottom-px -left-px border-b-2 border-l-2',
              'absolute -bottom-px -right-px border-b-2 border-r-2',
            ].map((cls) => (
              <span key={cls} aria-hidden className={`${cls} size-2.5 border-primary`} />
            ))}
            <Image
              src="/landing/editor.png"
              alt="The PedalSchema editor: a board with fifteen pedals placed and cables routed, a readout across the top, the chain in the right panel."
              // The file's real intrinsic size. Next/Image uses these for the
              // aspect ratio it reserves before the bytes arrive; a guess here
              // is a layout shift on every first load.
              width={1602}
              height={902}
              className="block h-auto w-full"
              priority={false}
            />
          </div>

          <div className="mt-px grid grid-cols-1 gap-px border border-border bg-border sm:grid-cols-3">
            {[
              {
                label: 'Fit checking',
                body: 'Pedals that overlap or hang off the rails are flagged as you place them, at the real dimensions of both.',
              },
              {
                label: 'Cable lists',
                body: 'Every run measured, typed and totalled, so you order the lengths you need and not a bag of six-inch patches.',
              },
              {
                label: 'Power budget',
                body: 'Draw per pedal against your supply, per output — because a board fails at one output, not at the total.',
              },
            ].map((cell) => (
              <div key={cell.label} className="bg-background p-4 px-[18px]">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
                  {cell.label}
                </p>
                <p className="mt-2 text-sm leading-[1.5] text-muted-foreground">{cell.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CLOSE */}
        <section className="mx-auto max-w-[1280px] px-8 py-14">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-center">
            <h2 className="max-w-[620px] text-[34px] font-bold leading-[1.12] tracking-[-0.024em]">
              Start with the board you own. Or the one you&rsquo;re thinking about.
            </h2>
            <div className="shrink-0">
              <OpenEditorCta signedIn={Boolean(user)} />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-8 py-5">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span>PedalSchema · Sheet 01</span>
          <nav className="flex items-center gap-5">
            <GuestLink href="/boards" className="transition-colors duration-200 hover:text-foreground">
              Boards
            </GuestLink>
            <GuestLink href="/pedals" className="transition-colors duration-200 hover:text-foreground">
              Pedal database
            </GuestLink>
            <Link
              href={user ? '/dashboard' : '/login'}
              className="transition-colors duration-200 hover:text-foreground"
            >
              {user ? 'Dashboard' : 'Log in'}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
