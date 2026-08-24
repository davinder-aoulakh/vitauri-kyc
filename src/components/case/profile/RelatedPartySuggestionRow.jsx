/**
 * RelatedPartySuggestionRow — one suggested related party from the pipeline.
 */
import React, { useState } from 'react';
import { Check, X, ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

function ConfidencePill({ confidence }) {
  if (!confidence) return null;
  const color = confidence >= 85 ? 'bg-emerald-100 text-emerald-700' : confidence >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600';
  return <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-mono font-medium', color)}>{confidence}%</span>;
}

export default function RelatedPartySuggestionRow({ rp, rpIndex, onAccept, onReject, accepting }) {
  const [expanded, setExpanded] = useState(false);
  const isConfirmed = rp.status === 'confirmed';
  const isRejected  = rp.status === 'rejected';

  const nameField  = rp.fields && rp.fields.full_name;
  const sourceRef  = (nameField && nameField.source_ref) || '';
  const parts      = sourceRef.split('::');
  const docName    = parts[1] || parts[0] || 'Document';
  const shortDoc   = docName.length > 20 ? docName.slice(0, 18) + '…' : docName;

  const fieldEntries = Object.entries(rp.fields || {}).filter(function(entry) { return entry[1] != null; });

  return (
    <div className={cn(
      'rounded-lg border px-3 py-2.5 space-y-1.5',
      isConfirmed ? 'bg-emerald-50 border-emerald-200' :
      isRejected  ? 'bg-muted/20 border-border opacity-60' :
      'bg-blue-50/40 border-blue-200'
    )}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-7 h-7 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-semibold text-blue-700">{(rp.full_name || '?').charAt(0)}</span>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground truncate">{rp.full_name}</div>
            <div className="text-xs text-muted-foreground">
              {rp.role_in_relationship || '—'}
              {rp.ownership_percentage ? ` · ${rp.ownership_percentage}%` : ''}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <ConfidencePill confidence={nameField && nameField.confidence} />
          <span className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded border bg-blue-100 text-blue-700 border-blue-200 font-medium">
            <FileText className="w-2.5 h-2.5" />
            {shortDoc}
          </span>
          {!isConfirmed && !isRejected && (
            <>
              <button
                onClick={() => onAccept(rpIndex, rp)}
                disabled={accepting}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 font-medium"
              >
                <Check className="w-3 h-3" /> Add
              </button>
              <button
                onClick={() => onReject(rpIndex)}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:bg-muted"
              >
                <X className="w-3 h-3" />
              </button>
            </>
          )}
          {isConfirmed && <span className="text-xs text-emerald-700 font-semibold">✓ Added</span>}
          {isRejected  && <span className="text-xs text-muted-foreground italic">Rejected</span>}
          <button onClick={() => setExpanded(function(e) { return !e; })} className="text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="pt-1 border-t border-blue-100 space-y-1 text-xs">
          {fieldEntries.map(function(entry) {
            const key = entry[0];
            const field = entry[1];
            return (
              <div key={key} className="flex items-center gap-2">
                <span className="text-muted-foreground w-28 capitalize">{key.replace(/_/g, ' ')}</span>
                <span className="font-medium">{field.value || '—'}</span>
                <ConfidencePill confidence={field.confidence} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}