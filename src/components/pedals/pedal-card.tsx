import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { PedalCategory } from '@/types';

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

const CATEGORY_COLORS: Record<PedalCategory, string> = {
  tuner: 'bg-slate-500',
  filter: 'bg-purple-500',
  compressor: 'bg-blue-500',
  pitch: 'bg-cyan-500',
  boost: 'bg-yellow-500',
  overdrive: 'bg-green-500',
  distortion: 'bg-orange-500',
  fuzz: 'bg-red-500',
  noise_gate: 'bg-gray-500',
  eq: 'bg-indigo-500',
  modulation: 'bg-pink-500',
  tremolo: 'bg-rose-500',
  delay: 'bg-teal-500',
  reverb: 'bg-sky-500',
  looper: 'bg-lime-500',
  volume: 'bg-amber-500',
  utility: 'bg-stone-500',
  multi_fx: 'bg-violet-500',
};

const CATEGORY_LABELS: Record<PedalCategory, string> = {
  tuner: 'Tuner',
  filter: 'Filter',
  compressor: 'Comp',
  pitch: 'Pitch',
  boost: 'Boost',
  overdrive: 'OD',
  distortion: 'Dist',
  fuzz: 'Fuzz',
  noise_gate: 'Gate',
  eq: 'EQ',
  modulation: 'Mod',
  tremolo: 'Trem',
  delay: 'Delay',
  reverb: 'Verb',
  looper: 'Loop',
  volume: 'Vol',
  utility: 'Util',
  multi_fx: 'Multi',
};

export function PedalCard({ pedal, onClick, selected }: PedalCardProps) {
  return (
    <Card
      className={`hover:border-primary/50 transition-colors ${onClick ? 'cursor-pointer' : ''} ${selected ? 'border-primary ring-2 ring-primary/20' : ''}`}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base truncate">{pedal.name}</CardTitle>
            <CardDescription className="truncate">{pedal.manufacturer}</CardDescription>
          </div>
          <Badge
            variant="secondary"
            className={`text-xs text-white shrink-0 ${CATEGORY_COLORS[pedal.category]}`}
          >
            {CATEGORY_LABELS[pedal.category]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-sm text-muted-foreground space-y-1">
          <p>
            {pedal.width_inches}&quot; × {pedal.depth_inches}&quot; × {pedal.height_inches}&quot;
          </p>
          <p>
            {pedal.voltage}V{pedal.current_ma ? ` / ${pedal.current_ma}mA` : ''}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export { CATEGORY_COLORS, CATEGORY_LABELS };
