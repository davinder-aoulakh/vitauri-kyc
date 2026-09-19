/**
 * ProfileFieldRow — single field row in the unified profile verification grid.
 * Shows: label | current value | AI suggestion (source badge, confidence pill) | Accept new / Request info / Keep existing
 */
import React, { useState } from 'react';
import { Check, X, Pencil, ExternalLink, AlertTriangle, FileText, Globe, MessageSquare, Info, Mail, Flag, RotateCcw, RefreshCw, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

const SOURCE_ICONS = {
  document: FileText,
  outreach: MessageSquare,
  osint:    Globe,
  didit:    ShieldCheck,
};
const SOURCE_COLORS = {
  document: 'bg-blue-100 text-blue-700 border-blue-200',
  outreach: 'bg-violet-100 text-violet-700 border-violet-200',
  osint:    'bg-emerald-100 text-emerald-700 border-emerald-200',
  didit:    'bg-teal-100 text-teal-700 border-teal-200',
};
const STATUS_CONFIG = {
  suggested:      { label: 'AI Suggested', bg: 'bg-purple-50 border-purple-200' },
  low_confidence: { label: 'Low Confidence', bg: 'bg-amber-50 border-amber-200' },
  conflict:       { label: 'Conflict', bg: 'bg-red-50 border-red-200' },
  confirmed:      { label: '✓ Confirmed', bg: 'bg-emerald-50 border-emerald-200' },
  rejected:       { label: 'Rejected', bg: 'bg-slate-50 border-slate-200' },
  info_requested: { label: '⏳ Info requested', bg: 'bg-amber-50 border-amber-200' },
  missing:        { label: 'Missing', bg: 'bg-muted/30 border-border' },
};

function ConfidencePill({ confidence }) {
  if (confidence == null || confidence === 0) return null;
  const color = confidence >= 85 ? 'bg-emerald-100 text-emerald-700' : confidence >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600';
  return <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-mono font-medium', color)}>{confidence}%</span>;
}

function SourceBadge({ source_type, source_ref }) {
  if (!source_type) return null;
  const Icon = SOURCE_ICONS[source_type] || Globe;
  const colorClass = SOURCE_COLORS[source_type] || 'bg-slate-100 text-slate-600';

  const parts = source_ref?.split('::') || [];
  const label = source_type === 'document' ? (parts[1] || 'Document')
    : source_type === 'osint' ? (parts[0] || 'OSINT')
    : source_type === 'didit' ? (source_ref || 'Didit IDV')
    : (source_ref || 'Outreach');
  const url = source_type === 'osint' && parts[1] ? parts[1] : null;

  return (
    <span className={cn('inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border font-medium max-w-[140px] truncate', colorClass)}>
      <Icon className="w-2.5 h-2.5 flex-shrink-0" />
      <span className="truncate">{label}</span>
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 hover:opacity-70" onClick={e => e.stopPropagation()}>
          <ExternalLink className="w-2.5 h-2.5" />
        </a>
      )}
    </span>
  );
}

export default function ProfileFieldRow({
  fieldKey, label, suggestion, currentValue,
  onAccept, onReject, onManualEdit, onRequestInfo, onReopen, onReapply,
  accepting,
}) {
  const [editing, setEditing] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [infoMenuOpen, setInfoMenuOpen] = useState(false);

  const status = suggestion?.status || 'missing';
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.missing;
  const hasValue = suggestion?.value != null && suggestion.value !== '';
  const isConfirmed = status === 'confirmed';
  const isRejected = status === 'rejected';
  const isMissing = status === 'missing';
  const isConflict = status === 'conflict';
  const isInfoRequested = status === 'info_requested';
  const showActions = !editing && !isConfirmed && !isRejected && !isInfoRequested;

  function startEdit() {
    setManualValue(suggestion?.value || currentValue || '');
    setEditing(true);
  }

  function submitEdit() {
    if (manualValue.trim()) {
      onManualEdit(fieldKey, manualValue.trim());
    }
    setEditing(false);
  }

  return (
    <div className={cn('rounded-lg border px-3 py-2.5 space-y-1.5 transition-colors', config.bg)}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        {/* Label + current value */}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{label}</div>
          {editing ? (
            <div className="flex items-center gap-1.5 mt-1">
              <input
                className="flex-1 text-sm border border-input rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                value={manualValue}
                onChange={e => setManualValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitEdit(); if (e.key === 'Escape') setEditing(false); }}
                autoFocus
              />
              <button onClick={submitEdit} className="text-xs px-2 py-1 bg-primary text-white rounded font-medium hover:bg-primary/90">Save</button>
              <button onClick={() => setEditing(false)} className="text-xs px-2 py-1 border border-border rounded text-muted-foreground hover:bg-muted">Cancel</button>
            </div>
          ) : (
            <div className="text-sm font-medium text-foreground">
              {isConfirmed && currentValue ? currentValue
                : hasValue ? suggestion.value
                : <span className="text-muted-foreground/50 italic">—</span>
              }
            </div>
          )}
        </div>

        {/* Actions — 3-button pattern */}
        {showActions && (
          <div className="flex items-center gap-1 flex-shrink-0 relative">
            {hasValue && (
              <button
                onClick={() => onAccept(fieldKey, suggestion)}
                disabled={accepting}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 font-medium"
              >
                <Check className="w-3 h-3" /> Accept new
              </button>
            )}
            {hasValue && (
              <button
                onClick={() => setInfoMenuOpen(o => !o)}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-amber-500 text-white hover:bg-amber-600 font-medium"
              >
                <Info className="w-3 h-3" /> Request info
              </button>
            )}
            {hasValue && (
              <button
                onClick={() => onReject(fieldKey)}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600 font-medium"
              >
                <X className="w-3 h-3" /> Keep existing
              </button>
            )}
            <button
              onClick={startEdit}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:bg-muted font-medium"
            >
              <Pencil className="w-3 h-3" />
            </button>

            {infoMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 bg-popover border border-border rounded-lg shadow-lg overflow-hidden w-48">
                <button
                  onClick={() => { setInfoMenuOpen(false); onRequestInfo(fieldKey, 'email'); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-muted/60 flex items-center gap-2"
                >
                  <Mail className="w-3 h-3 text-muted-foreground" /> Email client for clarification
                </button>
                <button
                  onClick={() => { setInfoMenuOpen(false); onRequestInfo(fieldKey, 'flag'); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-muted/60 flex items-center gap-2 border-t border-border/50"
                >
                  <Flag className="w-3 h-3 text-muted-foreground" /> Flag for internal review
                </button>
              </div>
            )}
          </div>
        )}

        {isConfirmed && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-emerald-700 font-semibold">✓ Confirmed</span>
            {suggestion?.applied && (
              <button onClick={() => onReapply?.(fieldKey)} className="text-xs text-primary hover:underline flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Re-apply
              </button>
            )}
            <button onClick={startEdit} className="text-muted-foreground hover:text-foreground">
              <Pencil className="w-3 h-3" />
            </button>
          </div>
        )}

        {isRejected && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground italic">Kept existing</span>
            <button onClick={startEdit} className="text-xs text-primary hover:underline">Fill manually</button>
          </div>
        )}

        {isInfoRequested && !editing && (
          <div className="flex items-center gap-1.5">
            <button onClick={() => onReopen?.(fieldKey)} className="text-xs text-primary hover:underline flex items-center gap-1">
              <RotateCcw className="w-3 h-3" /> Reopen
            </button>
          </div>
        )}
      </div>

      {/* Source + confidence row */}
      {!isMissing && !isConfirmed && !isRejected && (
        <div className="flex items-center gap-2 flex-wrap">
          <SourceBadge source_type={suggestion?.source_type} source_ref={suggestion?.source_ref} />
          <ConfidencePill confidence={suggestion?.confidence} />
          {isConflict && (
            <span className="inline-flex items-center gap-1 text-xs text-red-600 font-medium">
              <AlertTriangle className="w-3 h-3" /> Conflict
            </span>
          )}
          {status === 'low_confidence' && (
            <span className="text-xs text-amber-600 font-medium">Low confidence — verify manually</span>
          )}
        </div>
      )}

      {/* Conflict detail */}
      {isConflict && suggestion?.conflict_note && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 leading-relaxed">
          {suggestion.conflict_note}
        </div>
      )}

      {/* Missing state manual entry prompt */}
      {isMissing && !editing && (
        <button onClick={startEdit} className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1">
          <Pencil className="w-3 h-3" /> Enter manually
        </button>
      )}
    </div>
  );
}