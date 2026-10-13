import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { History } from 'lucide-react';
import { format } from 'date-fns';
import ProfileStatusPill from './ProfileStatusPill';

export default function ProfileVersionsPopover({ profiles, selectedId, onSelect }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs">
          <History className="w-3.5 h-3.5" /> Versions ({profiles.length})
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1.5">
        {profiles.length === 0 && <p className="p-3 text-xs text-muted-foreground">No versions yet.</p>}
        <div className="max-h-72 overflow-y-auto">
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-accent ${p.id === selectedId ? 'bg-accent' : ''}`}
            >
              <span>
                <span className="font-semibold">v{p.version}</span>
                <span className="ml-2 text-muted-foreground">{p.created_date ? format(new Date(p.created_date), 'd MMM yyyy') : ''}</span>
              </span>
              <ProfileStatusPill status={p.status} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}