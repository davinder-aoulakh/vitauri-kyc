import React from 'react';
import { AlertTriangle } from 'lucide-react';

export default function FxMissingBadge({ count }) {
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
      <AlertTriangle className="h-3.5 w-3.5" />
      FX missing for {count} transaction{count === 1 ? '' : 's'} — totals exclude them
    </span>
  );
}