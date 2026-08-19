import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { loadConfiguration } from '@/lib/load-configuration';
import { EditorClient } from './editor-client';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditorPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  // Every row-to-type transform lives in lib/load-configuration, shared with
  // the public /s/[slug] view - see the note there on why there is one copy.
  const config = await loadConfiguration(supabase, { id });
  if (!config) notFound();

  return (
    <EditorClient
      configId={config.id}
      configName={config.name}
      configDescription={config.description}
      isPublic={config.isPublic}
      shareSlug={config.shareSlug}
      board={config.board}
      amp={config.amp}
      useEffectsLoop={config.useEffectsLoop}
      use4CableMethod={config.use4CableMethod}
      modulationInLoop={config.modulationInLoop}
      routingConfig={config.routingConfig}
      placedPedals={config.placedPedals}
      pedalsById={config.pedalsById}
      availablePedals={config.availablePedals}
      availableAmps={config.availableAmps}
      powerSupplies={config.powerSupplies}
      powerSupply={config.powerSupply}
    />
  );
}
