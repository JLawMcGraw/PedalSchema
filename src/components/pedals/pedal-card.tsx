import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { PedalCategory } from '@/types';
import { getCategoryColor, getCategoryShortLabel } from '@/lib/constants/pedal-categories';
import { formatCurrentDraw, formatDimensions, formatVoltage } from '@/lib/format-pedal';

interface PedalCardProps {
  pedal: {
    id: string;
    name: string;
    manufacturer: string;
    category: PedalCategory;
    width_inches: number;
    depth_inches: number;
    height_inches: number;
    voltage: number;
    current_ma: number | null;
    image_url: string | null;
  };
  onClick?: () => void;
  selected?: boolean;
}

export function PedalCard({ pedal, onClick, selected }: PedalCardProps) {
  return (
    <Card
      className={`hover:border-primary/50 transition-colors ${onClick ? 'cursor-pointer' : ''} ${selected ? 'border-primary ring-2 ring-primary/20' : ''}`}
      onClick={onClick}
    >
      {pedal.image_url && (
        <div className="flex items-center justify-center h-36 mx-4 mt-4 rounded-md bg-muted/40 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pedal.image_url}
            alt={`${pedal.manufacturer} ${pedal.name}`}
            className="max-h-full max-w-full object-contain"
            loading="lazy"
          />
        </div>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base truncate">{pedal.name}</CardTitle>
            <CardDescription className="truncate">{pedal.manufacturer}</CardDescription>
          </div>
          {/* The colour is a MARK beside the text, not the text's own colour:
              the dot carries the signal family, the label carries the exact
              category, and the words stay in ordinary ink. */}
          <Badge variant="secondary" className="text-xs shrink-0 gap-1.5">
            <span
              aria-hidden
              className="size-2 rounded-full shrink-0"
              style={{ backgroundColor: getCategoryColor(pedal.category) }}
            />
            {getCategoryShortLabel(pedal.category)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-sm text-muted-foreground space-y-1">
          <p>{formatDimensions(pedal.width_inches, pedal.depth_inches, pedal.height_inches)}</p>
          <p>
            {formatVoltage(pedal.voltage)} / {formatCurrentDraw(pedal.current_ma)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
