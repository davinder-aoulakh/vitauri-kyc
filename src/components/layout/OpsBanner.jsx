import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

export default function OpsBanner({ tenantName, onExit }) {
  if (!tenantName) return null;
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-2 text-amber-800 text-sm">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        <span>
          Viewing <strong>{tenantName}</strong> — Read-Only · Ops Mode · No changes can be made
        </span>
      </div>
      <button
        onClick={onExit}
        className="flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 font-medium px-2 py-1 rounded hover:bg-amber-100 transition-colors"
      >
        <X className="w-3 h-3" />
        Exit Ops View
      </button>
    </div>
  );
}