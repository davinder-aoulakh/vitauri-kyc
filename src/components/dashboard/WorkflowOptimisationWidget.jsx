/**
 * Workflow Optimisation Widget — Dashboard widget for Manager/Director roles.
 * Calls the WorkflowOptimisation AI agent and displays prioritised bottleneck list.
 */
import React, { useState } from 'react';
import { useAiOrchestrator } from '@/hooks/useAiOrchestrator';
import { Button } from '@/components/ui/button';
import { Sparkles, Loader2, AlertTriangle, ChevronRight, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, differenceInDays } from 'date-fns';

const URGENCY_STYLE = {
  Critical: 'bg-red-100 text-red-700 border-red-200',
  High:     'bg-orange-100 text-orange-700 border-orange-200',
  Medium:   'bg-amber-100 text-amber-700 border-amber-200',
};

export default function WorkflowOptimisationWidget({ cases, clients, users, currentUser, tenantId, onNavigate }) {
  const [generated, setGenerated] = useState(false);

  const { invoke, loading, output, error, tokenInfo } = useAiOrchestrator({ tenantId, currentUser });

  async function analyse() {
    const today = new Date();
    const caseList = cases.map(c => ({
      id: c.id,
      client_name: clients[c.client_id]?.full_name || 'Unknown',
      status: c.status,
      risk_classification: c.risk_classification,
      days_open: c.created_date ? differenceInDays(today, new Date(c.created_date)) : 0,
      due_date: c.due_date || null,
      analyst_name: users?.find(u => u.id === c.assigned_analyst_id)?.full_name || 'Unassigned',
    }));
    await invoke('WorkflowOptimisation', { caseList });
    setGenerated(true);
  }

  const bottlenecks = output?.bottlenecks || [];
  const warnings    = output?.capacity_warnings || [];
  const summary     = output?.summary || '';

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-500" />
          <span className="font-semibold text-sm">AI Workflow Optimisation</span>
        </div>
        <Button size="sm" variant={generated ? 'ghost' : 'outline'}
          className={cn('gap-1.5 text-xs', !generated && 'border-purple-200 text-purple-700 hover:bg-purple-50')}
          onClick={analyse} disabled={loading}>
          {loading
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analysing…</>
            : generated
              ? <><RefreshCw className="w-3.5 h-3.5" /> Refresh</>
              : <><Sparkles className="w-3.5 h-3.5" /> Analyse Pipeline</>
          }
        </Button>
      </div>

      <div className="p-4">
        {!generated && !loading && (
          <div className="text-center py-6 space-y-2">
            <Sparkles className="w-8 h-8 text-purple-200 mx-auto" />
            <p className="text-xs text-muted-foreground">AI analysis of {cases.length} open cases — identify bottlenecks, overdue risks, and analyst load imbalances.</p>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-8 gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
            <span className="text-xs text-purple-600">Analysing {cases.length} cases…</span>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
            <AlertTriangle className="w-3.5 h-3.5 inline mr-1" /> {error}
          </div>
        )}

        {generated && output && !loading && (
          <div className="space-y-4">
            {/* Summary */}
            {summary && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs text-purple-900 leading-relaxed">
                {summary}
              </div>
            )}

            {/* Capacity warnings */}
            {warnings.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Capacity Warnings</div>
                {warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                    <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" /> {w}
                  </div>
                ))}
              </div>
            )}

            {/* Bottlenecks */}
            {bottlenecks.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Priority Actions ({bottlenecks.length})</div>
                {bottlenecks.slice(0, 5).map((b, i) => (
                  <div key={i}
                    className="border border-border rounded-lg p-3 hover:bg-muted/20 transition-colors cursor-pointer space-y-1.5"
                    onClick={() => b.case_id && onNavigate?.(`/case/${b.case_id}`)}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground truncate">{b.client_name || 'Unknown client'}</span>
                      <span className={cn('text-xs px-2 py-0.5 rounded-full border flex-shrink-0', URGENCY_STYLE[b.urgency] || URGENCY_STYLE.Medium)}>
                        {b.urgency}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-snug">{b.issue}</p>
                    <div className="flex items-center gap-1 text-xs text-primary font-medium">
                      <ChevronRight className="w-3 h-3" /> {b.recommended_action}
                    </div>
                  </div>
                ))}
                {bottlenecks.length > 5 && (
                  <div className="text-xs text-muted-foreground text-center py-1">+{bottlenecks.length - 5} more identified</div>
                )}
              </div>
            )}

            {tokenInfo && (
              <div className="text-xs text-muted-foreground/60 text-right">
                {tokenInfo.remaining.toLocaleString()} tokens remaining today
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}