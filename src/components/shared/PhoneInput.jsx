import React, { useEffect, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { COUNTRY_META, splitPhone, joinPhone } from '@/lib/countries';
import Flag from './Flag';

const BY_NAME = [...COUNTRY_META].sort((a, b) => a.name.localeCompare(b.name));

// Country code (flag + "+31") and number as two fields; stored as one string "+31 647978701".
// defaultCountry: used when the value has no country code yet (client's country of residence, else NL).
export default function PhoneInput({ value, onChange, defaultCountry, className, placeholder = '6 12345678', disabled }) {
  const parsed = splitPhone(value, defaultCountry);
  const [iso2, setIso2] = useState(parsed.iso2);
  const [open, setOpen] = useState(false);
  // Keep the chosen flag when the value changes from outside (e.g. reset), unless its code no longer matches
  useEffect(() => { if (value && splitPhone(value, defaultCountry).dial !== COUNTRY_META.find((c) => c.iso2 === iso2)?.dial) setIso2(splitPhone(value, defaultCountry).iso2); }, [value]);
  const country = COUNTRY_META.find((c) => c.iso2 === iso2) || COUNTRY_META.find((c) => c.iso2 === parsed.iso2);
  const number = parsed.number;
  const digits = number.length;
  const invalid = digits > 0 && (digits < 6 || digits > 14);

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" disabled={disabled}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
              aria-label="Country code">
              <Flag iso2={country?.iso2} />
              <span className="tabular-nums">{country?.dial}</span>
              <ChevronDown className="w-3.5 h-3.5 opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-64" align="start">
            <Command>
              <CommandInput placeholder="Country or code…" />
              <CommandList className="max-h-72">
                <CommandEmpty>No country found.</CommandEmpty>
                <CommandGroup>
                  {BY_NAME.map((c) => (
                    <CommandItem key={c.iso2} value={`${c.name} ${c.dial} ${c.iso2}`}
                      onSelect={() => { setIso2(c.iso2); setOpen(false); onChange(joinPhone(c.dial, number)); }}>
                      <Flag iso2={c.iso2} className="mr-2" />
                      <span className="flex-1">{c.name}</span>
                      <span className="text-muted-foreground tabular-nums">{c.dial}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Input
          inputMode="tel"
          value={number}
          disabled={disabled}
          onChange={(e) => onChange(joinPhone(country.dial, e.target.value))}
          placeholder={placeholder}
          className={cn('h-9 text-sm', invalid && 'border-amber-400')}
        />
      </div>
      {invalid && <p className="text-xs text-amber-700">Check the number: {digits} digits after the country code.</p>}
    </div>
  );
}
