import React, { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { COUNTRIES, COUNTRY_META, countryByName } from '@/lib/countries';
import Flag from './Flag';

// Searchable country picker with flags. The value stays the country NAME (as stored everywhere today);
// legacy values like "Netherlands (NL)" still show their flag.
export default function CountrySelect({ value, onChange, placeholder = 'Select country', className, disabled, includeOther = true }) {
  const [open, setOpen] = useState(false);
  const current = countryByName(value);
  const names = COUNTRIES.filter((n) => includeOther || n !== 'Other');
  const items = names.map((name) => ({ name, iso2: COUNTRY_META.find((c) => c.name === name)?.iso2 || null }));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn('flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-left disabled:opacity-50', className)}
        >
          {current ? <Flag iso2={current.iso2} /> : null}
          <span className={cn('flex-1 truncate', !value && 'text-muted-foreground')}>{value || placeholder}</span>
          <ChevronDown className="w-4 h-4 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[240px]" align="start">
        <Command>
          <CommandInput placeholder="Search country…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {items.map((c) => (
                <CommandItem key={c.name} value={`${c.name} ${c.iso2 || ''}`} onSelect={() => { onChange(c.name); setOpen(false); }}>
                  {c.iso2 ? <Flag iso2={c.iso2} className="mr-2" /> : <span className="mr-2 w-5" />}
                  <span className="flex-1">{c.name}</span>
                  {current?.name === c.name && <Check className="w-4 h-4 text-primary" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
