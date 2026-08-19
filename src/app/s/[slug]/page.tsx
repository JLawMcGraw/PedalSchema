import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { loadConfiguration } from '@/lib/load-configuration';
import { isValidShareSlug } from '@/lib/share-link';
import { SharedBoardView } from './shared-board-view';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/*
 * A published board, readable by anyone.
 *
 * This route sits OUTSIDE the (dashboard) group on purpose. That group's
 * layout redirects to /login when there is no user, and `proxy.ts` guards
 * /dashboard, /editor, /boards, /pedals and /amps - none of which match /s.
 * A shared link has to work for someone with no account at all, which is the
 * whole point of sharing it.
 *
 * Nothing here trusts the slug for access control. RLS grants SELECT on any
 * configuration with is_public = true, and the loader requires is_public as
 * well as the slug, so unpublishing closes the link immediately.
 */

async function load(slug: string) {
  if (!isValidShareSlug(slug)) return null;
  const supabase = await createClient();
  // No library: the pedal catalogue and amp list feed the editor's panels,
  // and this page has none.
  return loadConfiguration(supabase, { shareSlug: slug }, { includeLibrary: false });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const config = await load(slug);
  if (!config) return { title: 'Board not found' };
  return {
    title: `${config.name} - PedalSchema`,
    description:
      config.description ||
      `A ${config.board.name} with ${config.placedPedals.length} pedals.`,
  };
}

export default async function SharedBoardPage({ params }: PageProps) {
  const { slug } = await params;
  const config = await load(slug);
  if (!config) notFound();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b shrink-0">
        <div className="container flex items-center justify-between gap-4 h-14">
          <div className="min-w-0">
            <h1 className="font-semibold truncate">{config.name}</h1>
            <p className="text-xs text-muted-foreground truncate">
              {[config.board.manufacturer, config.board.name].filter(Boolean).join(' ')}
              {' · '}
              {config.placedPedals.length} pedal
              {config.placedPedals.length === 1 ? '' : 's'}
            </p>
          </div>
          {/* A shared board is most people's first sight of the app, so the
              only call to action is the honest one: this is what it makes. */}
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-200 shrink-0"
          >
            PedalSchema
          </Link>
        </div>
      </header>

      {config.description && (
        <p className="container py-3 text-sm text-muted-foreground border-b">
          {config.description}
        </p>
      )}

      <main className="flex-1 min-h-0">
        <SharedBoardView config={config} />
      </main>
    </div>
  );
}
