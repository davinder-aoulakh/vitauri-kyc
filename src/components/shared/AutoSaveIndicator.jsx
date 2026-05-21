import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Tiny inline status chip shown in step headers.
 * Pass autoSaving=true while the save is in flight; lastSaved to show the confirmation tick.
 */
export default function AutoSaveIndicator({ autoSaving, lastSaved, className }) {
  if (!autoSaving && !lastSaved) return null;

  return (
    <span className={cn('flex items-center gap-1 text-xs text-muted-foreground', className)}>
      {autoSaving ? (
        <>
          <Loader2 className="w-3 h-3 animate-spin" />
          Saving…
        </>
      ) : (
        <span className="text-emerald-600 font-medium">✓ Auto-saved</span>
      )}
    </span>
  );
}