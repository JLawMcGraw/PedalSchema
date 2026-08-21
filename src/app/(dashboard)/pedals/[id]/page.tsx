import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { Badge } from '@/components/ui/badge';
import { CaretLeft } from '@phosphor-icons/react/ssr';
import { getCategoryColor, getCategoryLabel } from '@/lib/constants/pedal-categories';
import {
  formatCurrentDraw,
  formatVoltage,
  formatDimensions,
  formatPolarity,
  formatJackType,
  formatJackSide,
  formatChainLocation,
} from '@/lib/format-pedal';
import type { JackSide, JackType, PowerPolarity, ChainLocation, PedalCategory } from '@/types';
import Image from 'next/image';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface JackRow {
  id: string;
  jack_type: JackType;
  side: JackSide;
  position_percent: number;
  label: string | null;
}

interface PedalRow {
  id: string;
  name: string;
  manufacturer: string;
  category: PedalCategory;
  width_inches: number;
  depth_inches: number;
  height_inches: number;
  voltage: number;
  current_ma: number | null;
  polarity: PowerPolarity;
  default_chain_position: number | null;
  preferred_location: ChainLocation;
  supports_4_cable: boolean;
  needs_buffer_before: boolean;
  needs_direct_pickup: boolean;
  is_system: boolean;
  image_url: string | null;
  notes: string | null;
  image_source_url: string | null;
  image_attribution: string | null;
  jacks_source_url: string | null;
  jacks_verified_at: string | null;
  dimensions_source_url: string | null;
  dimensions_verified_at: string | null;
  pedal_jacks: JackRow[];
}

async function loadPedal(id: string): Promise<PedalRow | null> {
  // Still guarded here, not only in layout.tsx: generateMetadata runs on its
  // own and would otherwise hand a malformed id straight to Postgres.
  if (!isUuid(id)) {
    return null;
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from('pedals')
    .select('*, pedal_jacks (id, jack_type, side, position_percent, label)')
    .eq('id', id)
    .maybeSingle();
  return (data as PedalRow) ?? null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const pedal = await loadPedal(id);
  if (!pedal) return { title: 'Pedal not found' };
  return {
    title: `${pedal.manufacturer} ${pedal.name}`,
    description: `${getCategoryLabel(pedal.category)} - ${formatDimensions(
      pedal.width_inches,
      pedal.depth_inches,
      pedal.height_inches
    )}, ${formatVoltage(pedal.voltage)} ${formatCurrentDraw(pedal.current_ma)}.`,
  };
}

/** One label/value row. The value is the thing being read, so it leads. */
function Spec({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-border/50 last:border-0">
      <dt className="text-sm text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-right tabular-nums">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        {title}
      </h2>
      <dl>{children}</dl>
    </section>
  );
}

export default async function PedalDetailPage({ params }: PageProps) {
  const { id } = await params;
  const pedal = await loadPedal(id);
  if (!pedal) notFound();

  const jacks = [...(pedal.pedal_jacks ?? [])].sort(
    (a, b) => a.side.localeCompare(b.side) || a.position_percent - b.position_percent
  );

  const provenance = [
    { label: 'Dimensions', url: pedal.dimensions_source_url, at: pedal.dimensions_verified_at },
    { label: 'Jacks', url: pedal.jacks_source_url, at: pedal.jacks_verified_at },
    { label: 'Photo', url: pedal.image_source_url, at: null },
  ].filter((p) => p.url);

  return (
    <div className="container py-8 max-w-5xl">
      {/* Every page needs a way back; this one is reached only by clicking a
          card, so returning to the list is the single most likely next move. */}
      <Link
        href="/pedals"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors duration-200 mb-6"
      >
        <CaretLeft className="h-4 w-4" />
        All pedals
      </Link>

      <article className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-start">
        {/* Photo */}
        <div className="rounded-xl border bg-muted/30 flex items-center justify-center min-h-56 p-6 overflow-hidden">
          {pedal.image_url ? (
            /* The one place a gear photo is the subject rather than a
               thumbnail, so it gets a real derivative - still a long way from
               the 2.75 MB original. */
            <Image
              src={pedal.image_url}
              alt={`${pedal.manufacturer} ${pedal.name} pedal, viewed from above`}
              width={640}
              height={480}
              sizes="(max-width: 768px) 100vw, 640px"
              className="max-h-72 w-auto object-contain"
            />
          ) : (
            <p className="text-sm text-muted-foreground text-center">
              No photo on file for this pedal.
            </p>
          )}
        </div>

        <div className="min-w-0">
          <header className="mb-6">
            <p className="text-sm text-muted-foreground">{pedal.manufacturer}</p>
            <h1 className="text-3xl font-bold tracking-tight break-words">{pedal.name}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Badge
                variant="outline"
                className="gap-1.5"
                style={{ borderColor: getCategoryColor(pedal.category) }}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: getCategoryColor(pedal.category) }}
                />
                {getCategoryLabel(pedal.category)}
              </Badge>
              {!pedal.is_system && <Badge variant="secondary">Yours</Badge>}
              {pedal.supports_4_cable && <Badge variant="secondary">4-cable method</Badge>}
            </div>
          </header>

          <div className="space-y-6">
            <Section title="Physical">
              <Spec label="Footprint">
                {formatDimensions(pedal.width_inches, pedal.depth_inches, pedal.height_inches)}
              </Spec>
              {pedal.dimensions_verified_at && (
                <Spec label="Dimensions checked">
                  {new Date(pedal.dimensions_verified_at).toLocaleDateString()}
                </Spec>
              )}
            </Section>

            <Section title="Power">
              <Spec label="Voltage">{formatVoltage(pedal.voltage)}</Spec>
              {/* null is NOT zero here - see lib/format-pedal. */}
              <Spec label="Current draw">
                {pedal.current_ma == null ? (
                  <span className="text-muted-foreground font-normal">
                    Unknown - not published
                  </span>
                ) : (
                  formatCurrentDraw(pedal.current_ma)
                )}
              </Spec>
              <Spec label="Polarity">{formatPolarity(pedal.polarity)}</Spec>
            </Section>

            <Section title="Signal chain">
              <Spec label="Usual position">
                {pedal.default_chain_position ?? <span className="text-muted-foreground font-normal">Not set</span>}
              </Spec>
              <Spec label="Preferred location">
                {formatChainLocation(pedal.preferred_location)}
              </Spec>
              <Spec label="Wants a buffer before it">
                {pedal.needs_buffer_before ? 'Yes' : 'No'}
              </Spec>
              <Spec label="Wants the pickup direct">
                {pedal.needs_direct_pickup ? 'Yes' : 'No'}
              </Spec>
            </Section>

            <Section title={`Jacks (${jacks.length})`}>
              {jacks.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  No jack positions recorded, so this pedal is wired from its
                  defaults on the board.
                </p>
              ) : (
                jacks.map((j) => (
                  <Spec key={j.id} label={j.label || formatJackType(j.jack_type)}>
                    {formatJackSide(j.side)} · {Math.round(j.position_percent)}%
                  </Spec>
                ))
              )}
            </Section>

            {pedal.notes && (
              <Section title="Notes">
                <p className="text-sm leading-relaxed">{pedal.notes}</p>
              </Section>
            )}

            {provenance.length > 0 && (
              <Section title="Where this came from">
                {provenance.map((p) => (
                  <Spec key={p.label} label={p.label}>
                    <a
                      href={p.url!}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline underline-offset-2 hover:text-primary transition-colors duration-200 font-normal"
                    >
                      Source
                    </a>
                    {p.at && (
                      <span className="text-muted-foreground font-normal">
                        {' '}· {new Date(p.at).toLocaleDateString()}
                      </span>
                    )}
                  </Spec>
                ))}
              </Section>
            )}
          </div>

          {/* Deliberately no call to action. "Start a board with this" was
              written here and removed: /editor/new cannot preselect a pedal,
              so the button would promise something it does not do - which is
              the whole defect A3 exists to fix. */}
        </div>
      </article>
    </div>
  );
}
