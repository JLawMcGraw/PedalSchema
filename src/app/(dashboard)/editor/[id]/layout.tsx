import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

/**
 * THE 404 IS DECIDED HERE. Same reason as `pedals/[id]/layout.tsx` - see the
 * longer note there - and it matters more on this route than on that one.
 *
 * `loadConfiguration` fetches the board, the amp, every placed pedal, the
 * 67-pedal catalogue, the amp list and the power supplies. Waiting for all of
 * that before deciding whether the row even exists is the whole reason the
 * editor felt like a dead pause after a click. Asking the cheap question first
 * lets the expensive one stream behind a skeleton.
 *
 * RLS carries the permission half: "Users can view their own configurations"
 * means somebody else's board returns no row here, and a stranger's board is a
 * 404 rather than a 403 - which is the right answer, since confirming that an
 * id exists is itself a disclosure.
 */
export default async function EditorLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from('configurations')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (!data) notFound();

  return <>{children}</>;
}
