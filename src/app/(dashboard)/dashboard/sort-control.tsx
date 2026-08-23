'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CaretDown, Check } from '@phosphor-icons/react';
import { SORTS, DEFAULT_SORT, type SortKey } from './sort';

/**
 * How the boards below the hero are ordered.
 *
 * NO SEARCH, NO FILTER, NO PAGINATION CONTROL beside it. At one to three
 * boards those are furniture - a search box over three rows is a control that
 * costs a click to do what the eye already did. Sort survives because at three
 * boards "which did I touch last" and "which is the big one" are different
 * questions with different answers.
 *
 * State lives in the URL, not in this component. The list is rendered on the
 * server, so a sort held in React state could only reorder what the server
 * already chose to send - which is wrong the moment there is a second page.
 */
export function SortControl({ value }: { value: SortKey }) {
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          {SORTS[value]}
          <CaretDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(Object.keys(SORTS) as SortKey[]).map((key) => (
          <DropdownMenuItem
            key={key}
            data-sort-option={key}
            onClick={() => {
              /*
               * The default is written as the ABSENCE of the param rather
               * than as `?sort=edited`. Two URLs that render the
               * same page is a small thing until one of them is what gets
               * shared or bookmarked.
               */
              router.push(key === DEFAULT_SORT ? '/dashboard' : `/dashboard?sort=${key}`);
            }}
          >
            <Check
              className={`mr-2 h-4 w-4 ${key === value ? 'opacity-100' : 'opacity-0'}`}
            />
            {SORTS[key]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
