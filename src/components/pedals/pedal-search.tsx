'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { PedalCategory } from '@/types';

const CATEGORIES: { value: PedalCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All Categories' },
  { value: 'tuner', label: 'Tuner' },
  { value: 'filter', label: 'Filter / Wah' },
  { value: 'compressor', label: 'Compressor' },
  { value: 'pitch', label: 'Pitch' },
  { value: 'boost', label: 'Boost' },
  { value: 'overdrive', label: 'Overdrive' },
  { value: 'distortion', label: 'Distortion' },
  { value: 'fuzz', label: 'Fuzz' },
  { value: 'noise_gate', label: 'Noise Gate' },
  { value: 'eq', label: 'EQ' },
  { value: 'modulation', label: 'Modulation' },
  { value: 'tremolo', label: 'Tremolo' },
  { value: 'delay', label: 'Delay' },
  { value: 'reverb', label: 'Reverb' },
  { value: 'looper', label: 'Looper' },
  { value: 'volume', label: 'Volume' },
  { value: 'utility', label: 'Utility' },
  { value: 'multi_fx', label: 'Multi-FX' },
];

interface PedalSearchProps {
  manufacturers: string[];
}

export function PedalSearch({ manufacturers }: PedalSearchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [category, setCategory] = useState(searchParams.get('category') || 'all');
  const [manufacturer, setManufacturer] = useState(searchParams.get('manufacturer') || 'all');

  const updateFilters = useCallback(
    (newSearch: string, newCategory: string, newManufacturer: string) => {
      const params = new URLSearchParams();
      if (newSearch) params.set('search', newSearch);
      if (newCategory && newCategory !== 'all') params.set('category', newCategory);
      if (newManufacturer && newManufacturer !== 'all') params.set('manufacturer', newManufacturer);

      startTransition(() => {
        router.push(`/pedals?${params.toString()}`);
      });
    },
    [router]
  );

  const handleSearchChange = (value: string) => {
    setSearch(value);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters(search, category, manufacturer);
  };

  const handleCategoryChange = (value: string) => {
    setCategory(value);
    updateFilters(search, value, manufacturer);
  };

  const handleManufacturerChange = (value: string) => {
    setManufacturer(value);
    updateFilters(search, category, value);
  };

  const handleClear = () => {
    setSearch('');
    setCategory('all');
    setManufacturer('all');
    startTransition(() => {
      router.push('/pedals');
    });
  };

  const hasFilters = search || category !== 'all' || manufacturer !== 'all';

  return (
    <div className="flex flex-col gap-4 mb-6">
      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <Input
          placeholder="Search pedals..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="max-w-sm"
        />
        <Button type="submit" variant="secondary" disabled={isPending}>
          Search
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        <Select value={category} onValueChange={handleCategoryChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>
                {cat.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={manufacturer} onValueChange={handleManufacturerChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Manufacturer" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Manufacturers</SelectItem>
            {manufacturers.map((mfr) => (
              <SelectItem key={mfr} value={mfr}>
                {mfr}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button variant="ghost" onClick={handleClear} disabled={isPending}>
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
