import { Suspense } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PedalSearch } from '@/components/pedals/pedal-search';
import { PedalCard } from '@/components/pedals/pedal-card';

interface PageProps {
  searchParams: Promise<{
    search?: string;
    category?: string;
    manufacturer?: string;
  }>;
}

export default async function PedalsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  // Build query with filters
  let query = supabase
    .from('pedals')
    .select('*')
    .order('manufacturer')
    .order('name');

  if (params.search) {
    query = query.or(`name.ilike.%${params.search}%,manufacturer.ilike.%${params.search}%`);
  }

  if (params.category) {
    query = query.eq('category', params.category);
  }

  if (params.manufacturer) {
    query = query.eq('manufacturer', params.manufacturer);
  }

  const { data: pedals } = await query.limit(100);

  // Get unique manufacturers for filter
  const { data: manufacturerData } = await supabase
    .from('pedals')
    .select('manufacturer')
    .order('manufacturer');

  const manufacturers = [...new Set(manufacturerData?.map((p) => p.manufacturer) || [])];

  return (
    <div className="container py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pedal Database</h1>
          <p className="text-muted-foreground">
            Browse and search effects pedals
          </p>
        </div>
        <Link href="/pedals/new">
          <Button>Add Custom Pedal</Button>
        </Link>
      </div>

      <Suspense fallback={<div>Loading filters...</div>}>
        <PedalSearch manufacturers={manufacturers} />
      </Suspense>

      {pedals && pedals.length > 0 ? (
        <>
          <p className="text-sm text-muted-foreground mb-4">
            {pedals.length} pedal{pedals.length !== 1 ? 's' : ''} found
          </p>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {pedals.map((pedal) => (
              <Link key={pedal.id} href={`/pedals/${pedal.id}`}>
                <PedalCard pedal={pedal} />
              </Link>
            ))}
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <h3 className="text-lg font-semibold mb-2">No pedals found</h3>
            <p className="text-muted-foreground text-center mb-4">
              {params.search || params.category || params.manufacturer
                ? 'Try adjusting your filters'
                : 'Run the database seed to populate the pedal database'}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
