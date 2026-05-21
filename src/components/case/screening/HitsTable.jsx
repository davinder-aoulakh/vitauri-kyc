import React, { useState } from 'react';
import { Shield, AlertTriangle, CheckCircle, Clock, FileSearch, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const MIN_DISCOUNT_CHARS = 10;

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
  Discounted: { label: 'Discounted', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
  Confirmed:  { label: 'Confirmed',  color: 'bg-red-100 text-red-700',         icon: AlertTriangle },
  Pending:    { label: 'Pending',    color: 'bg-amber-100 text-amber-700',     icon: Clock },
};

function QuickResolveRow({ hit, onDecision, submitting }) {
  const [just, setJust] = useState('');
  const meetsMinimum = just.length >= MIN_DISCOUNT_CHARS;

  return (
    <tr className="bg-muted/30">
      <td colSpan={6} className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="flex flex-col gap-1 flex-1">
            <Textarea
              value={just}
              onChange={e => setJust(e.target.value)}
              placeholder="Enter reason for discounting this hit (min. 10 characters)"
              className="text-xs min-h-10 resize-none"
            />
            <span className={cn('text-xs', meetsMinimum ? 'text-muted-foreground' : 'text-red-500')}>
              {just.length} / {MIN_DISCOUNT_CHARS} characters minimum
            </span>
          </div>
          <TooltipProvider>
            <div className="flex flex-col gap-1.5 flex-shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={-1}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                      disabled={!meetsMinimum || submitting}
                      onClick={() => onDecision(hit, 'Discounted', just)}
                    >
                      <CheckCircle className="w-3 h-3" /> Discount
                    </Button>
                  </span>
                </TooltipTrigger>
                {!meetsMinimum && (
                  <TooltipContent side="left" className="text-xs max-w-48">
                    Please provide at least 10 characters of justification
                  </TooltipContent>
                )}
              </Tooltip>
              <Button
                size="sm"
                className="text-xs h-7 gap-1 bg-red-600 hover:bg-red-700 text-white"
                disabled={just.length < 5 || submitting}
                onClick={() => onDecision(hit, 'Confirmed', just)}
              >
                <AlertTriangle className="w-3 h-3" /> Confirm + EDR
              </Button>
            </div>
          </TooltipProvider>
        </div>
      </td>
    </tr>
  );
}

export default function HitsTable({ hits, onRowClick, onQuickDecision, submitting }) {
  const [expandedRow, setExpandedRow] = useState(null);

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
            const isExpanded = expandedRow === hit.id;
            const isDone = ['Discounted', 'Confirmed_Match', 'Escalated'].includes(hit.status);

            return (
              <React.Fragment key={hit.id}>
                <tr
                  className={cn(
                    'cursor-pointer transition-colors hover:bg-muted/30',
                    isNew && 'bg-orange-50/40',
                    isExpanded && 'bg-muted/20'
                  )}
                >
                  <td className="px-4 py-3" onClick={() => onRowClick(hit)}>
                    <div className="flex items-center gap-2">
                      {isNew && <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" />}
                      <span className="font-medium text-foreground text-xs">{hit.entity_name}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{hit.entity_type}</div>
                  </td>
                  <td className="px-4 py-3 max-w-[180px]" onClick={() => onRowClick(hit)}>
                    <div className="text-xs text-foreground truncate">{hit.hit_name}</div>
                  </td>
                  <td className="px-4 py-3" onClick={() => onRowClick(hit)}>
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', SOURCE_COLORS[hit.source] || 'bg-slate-100 text-slate-600')}>
                      {SOURCE_LABELS[hit.source] || hit.source}
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={() => onRowClick(hit)}>
                    <span className={cn('text-xs font-bold px-2 py-0.5 rounded-md border', confColor)}>
                      {hit.confidence_score}%
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={() => onRowClick(hit)}>
                    {rec && (
                      <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', rec.color)}>
                        {rec.label}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
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
                      {/* Quick resolve toggle — only for unresolved hits */}
                      {!isDone && onQuickDecision && (
                        <button
                          title="Quick resolve"
                          onClick={() => setExpandedRow(isExpanded ? null : hit.id)}
                          className={cn(
                            'p-1 rounded-md transition-colors text-muted-foreground hover:text-foreground hover:bg-muted',
                            isExpanded && 'bg-muted text-foreground'
                          )}
                        >
                          <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', isExpanded && 'rotate-180')} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {/* Quick resolve inline panel */}
                {isExpanded && !isDone && onQuickDecision && (
                  <QuickResolveRow
                    hit={hit}
                    onDecision={(h, d, j) => { onQuickDecision(h, d, j); setExpandedRow(null); }}
                    submitting={submitting}
                  />
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}