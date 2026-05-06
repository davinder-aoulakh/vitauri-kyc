import React from 'react';
import { Shield, AlertTriangle, CheckCircle, Clock, FileSearch } from 'lucide-react';
import { cn } from '@/lib/utils';

const SOURCE_LABELS = {
  PEP_List: 'PEP',
  Sanctions_EU: 'EU Sanctions',
  Sanctions_UN: 'UN Sanctions',
  Adverse_Media: 'Adverse Media',
  Internal_Flag: 'Internal Flag',
};

const SOURCE_COLORS = {
  PEP_List:      'bg-purple-100 text-purple-700',
  Sanctions_EU:  'bg-red-100 text-red-700',
  Sanctions_UN:  'bg-red-100 text-red-700',
  Adverse_Media: 'bg-amber-100 text-amber-700',
  Internal_Flag: 'bg-slate-100 text-slate-700',
};

const REC_LABELS = {
  Confirmed_Match:       { label: 'Confirmed Match', color: 'text-red-700 bg-red-50' },
  Possible_Match:        { label: 'Possible Match',  color: 'text-amber-700 bg-amber-50' },
  Likely_False_Positive: { label: 'False Positive?', color: 'text-emerald-700 bg-emerald-50' },
};

const DECISION_LABELS = {
  Discounted:     { label: 'Discounted', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
  Confirmed:      { label: 'Confirmed',  color: 'bg-red-100 text-red-700',         icon: AlertTriangle },
  Pending:        { label: 'Pending',    color: 'bg-amber-100 text-amber-700',     icon: Clock },
};

export default function HitsTable({ hits, onRowClick }) {
  if (hits.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
            <th className="text-left px-4 py-3">Entity</th>
            <th className="text-left px-4 py-3">Hit Name</th>
            <th className="text-left px-4 py-3">Source</th>
            <th className="text-left px-4 py-3">Confidence</th>
            <th className="text-left px-4 py-3">AI Triage</th>
            <th className="text-left px-4 py-3">Decision</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {hits.map(hit => {
            const isNew = hit.status === 'New';
            const confColor = hit.confidence_score >= 80
              ? 'text-red-600 bg-red-50 border-red-200'
              : hit.confidence_score >= 50
                ? 'text-amber-600 bg-amber-50 border-amber-200'
                : 'text-slate-500 bg-slate-50 border-slate-200';
            const rec = REC_LABELS[hit.ai_recommendation];
            const dec = DECISION_LABELS[hit.analyst_decision];
            const DecIcon = dec?.icon;

            return (
              <tr
                key={hit.id}
                onClick={() => onRowClick(hit)}
                className={cn(
                  'cursor-pointer transition-colors hover:bg-muted/30',
                  isNew && 'bg-orange-50/40'
                )}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {isNew && <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" />}
                    <span className="font-medium text-foreground text-xs">{hit.entity_name}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{hit.entity_type}</div>
                </td>
                <td className="px-4 py-3 max-w-[180px]">
                  <div className="text-xs text-foreground truncate">{hit.hit_name}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', SOURCE_COLORS[hit.source] || 'bg-slate-100 text-slate-600')}>
                    {SOURCE_LABELS[hit.source] || hit.source}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={cn('text-xs font-bold px-2 py-0.5 rounded-md border', confColor)}>
                    {hit.confidence_score}%
                  </span>
                </td>
                <td className="px-4 py-3">
                  {rec && (
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', rec.color)}>
                      {rec.label}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {dec ? (
                    <span className={cn('inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium', dec.color)}>
                      <DecIcon className="w-3 h-3" />
                      {dec.label}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-700">
                      <Clock className="w-3 h-3" />
                      Needs Review
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}