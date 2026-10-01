import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Compact inline error state with an optional Retry button.
 * Used wherever a load/generate call can fail or time out, so a
 * spinner never gets stuck forever with no way to recover.
 */
export default function InlineError({ message = 'Something went wrong.', onRetry, retryLabel = 'Retry', className }) {
  return (
    <div className={cn('flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5', className)}>
      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <Button size="sm" variant="outline" className="h-6 text-xs gap-1 border-red-300 text-red-700 hover:bg-red-100 flex-shrink-0" onClick={onRetry}>
          <RefreshCw className="w-3 h-3" /> {retryLabel}
        </Button>
      )}
    </div>
  );
}