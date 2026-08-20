import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

/**
 * THE 404 IS DECIDED HERE, AND THAT IS THE ONLY REASON THIS LAYOUT EXISTS.
 *
 * A `loading.tsx` wraps the segment's page in a Suspense boundary, and once
 * that boundary's shell is flushed the HTTP status is already sent - so a page
 * that calls notFound() AFTER streaming begins answers 200 with a not-found
 * page inside it. That is a soft 404, and it is exactly the bug a loading.tsx
 * at `pedals/` caused earlier today.
 *
 * A layout runs BEFORE the boundary below it flushes. So the decision moves up
 * here and is made from the cheapest question that answers it - does the row
 * exist - while the page below keeps the expensive query (the pedal plus its
 * jacks) and streams behind the skeleton.
 *
 * The cost is one extra indexed lookup of a single column. The alternative is
 * choosing between a correct status and any loading state at all.
 */
export default async function PedalDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Shape first: Postgres rejects a non-UUID with 22P02, which would be a 500
  // on a URL anyone can type.
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const { data } = await supabase.from('pedals').select('id').eq('id', id).maybeSingle();
  if (!data) notFound();

  return <>{children}</>;
}
