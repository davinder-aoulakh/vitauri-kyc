import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  X, Shield, AlertTriangle, CheckCircle, Brain, User, Building2,
  ChevronDown, ChevronUp, Loader2, FileSearch, ExternalLink
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const SOURCE_LABELS = {
  PEP_List: 'PEP List',
  Sanctions_EU: 'EU Sanctions',
  Sanctions_UN: 'UN Sanctions',
  Adverse_Media: 'Adverse Media',
  Internal_Flag: 'Internal Flag',
};

const REC_CONFIG = {
  Confirmed_Match:       { label: 'Confirmed Match — Escalate', color: 'bg-red-100 text-red-700 border-red-200', icon: AlertTriangle },
  Possible_Match:        { label: 'Possible Match — Review',    color: 'bg-amber-100 text-amber-700 border-amber-200', icon: FileSearch },
  Likely_False_Positive: { label: 'Likely False Positive',      color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle },
};

export default function HitDetailPanel({ hit, onClose, onDecision, submitting }) {
  const [justification, setJustification] = useState('');
  const [rawOpen, setRawOpen] = useState(false);

  const isDone = ['Discounted', 'Confirmed_Match', 'Escalated'].includes(hit.status);
  const rec = REC_CONFIG[hit.ai_recommendation] || REC_CONFIG.Possible_Match;
  const RecIcon = rec.icon;

  const confColor = hit.confidence_score >= 80
    ? 'text-red-600 bg-red-50 border-red-200'
    : hit.confidence_score >= 50
      ? 'text-amber-600 bg-amber-50 border-amber-200'
      : 'text-slate-600 bg-slate-50 border-slate-200';

  function submit(decision) {
    onDecision(hit, decision, justification);
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex flex-col bg-card border-l border-border shadow-2xl w-full max-w-lg animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-primary" />
          <div>
            <div className="font-semibold text-sm text-foreground">Screening Hit Detail</div>
            <div className="text-xs text-muted-foreground">{hit.entity_name}</div>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted transition-colors">
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* Hit Summary */}
        <div className="bg-muted/30 rounded-xl border border-border p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-sm text-foreground">{hit.hit_name}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{SOURCE_LABELS[hit.source] || hit.source}</div>
            </div>
            <span className={cn('text-sm font-bold px-2.5 py-1 rounded-lg border flex-shrink-0', confColor)}>
              {hit.confidence_score}%
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div>
              <span className="text-muted-foreground">Entity</span>
              <div className="font-medium mt-0.5">{hit.entity_name}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Entity Type</span>
              <div className="font-medium mt-0.5">{hit.entity_type}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Source</span>
              <div className="font-medium mt-0.5">{SOURCE_LABELS[hit.source] || hit.source}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Status</span>
              <div className="font-medium mt-0.5">{hit.status?.replace(/_/g, ' ')}</div>
            </div>
          </div>
        </div>

        {/* Raw Details expandable */}
        {hit.hit_details && Object.keys(hit.hit_details).length > 0 && (
          <div className="border border-border rounded-xl overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted/30 transition-colors"
              onClick={() => setRawOpen(o => !o)}
            >
              <span>Raw Source Details</span>
              {rawOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {rawOpen && (
              <div className="px-4 pb-3 border-t border-border bg-muted/20">
                <pre className="text-xs text-foreground/80 whitespace-pre-wrap overflow-auto max-h-40 mt-2">
                  {JSON.stringify(hit.hit_details, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* AI Triage Panel */}
        <div className="bg-purple-50/50 border border-purple-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-purple-600" />
            <span className="text-xs font-semibold text-purple-800 uppercase tracking-wide">AI Screening Triage</span>
          </div>
          <div className={cn('inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border', rec.color)}>
            <RecIcon className="w-3.5 h-3.5" />
            {rec.label}
          </div>
          <p className="text-sm text-foreground/80 leading-relaxed">{hit.ai_rationale}</p>
        </div>

        {/* Analyst Decision */}
        {isDone ? (
          <div className="bg-muted/30 rounded-xl border border-border p-4">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Decision Recorded</div>
            <div className="text-sm font-medium text-foreground">{hit.analyst_decision}</div>
            {hit.analyst_justification && (
              <div className="text-xs text-muted-foreground mt-1.5 italic">"{hit.analyst_justification}"</div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Analyst Decision</div>
            <Textarea
              value={justification}
              onChange={e => setJustification(e.target.value)}
              placeholder="Written justification required. Minimum 20 characters for discounting a hit."
              className="text-sm min-h-20 resize-none"
            />
            <div className="text-xs text-muted-foreground">{justification.length} characters</div>

            <div className="grid grid-cols-1 gap-2">
              <Button
                variant="outline"
                className="justify-start gap-2 h-auto py-3 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                disabled={justification.length < 20 || submitting}
                onClick={() => submit('Discounted')}
              >
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <div className="text-left">
                  <div className="font-medium text-sm">Discount — False Positive</div>
                  <div className="text-xs text-emerald-600">Close hit, no further action required</div>
                </div>
              </Button>

              <Button
                variant="outline"
                className="justify-start gap-2 h-auto py-3 border-amber-300 text-amber-700 hover:bg-amber-50"
                disabled={!justification.trim() || submitting}
                onClick={() => submit('Pending')}
              >
                <FileSearch className="w-4 h-4 flex-shrink-0" />
                <div className="text-left">
                  <div className="font-medium text-sm">Pending — Request More Info</div>
                  <div className="text-xs text-amber-600">Pause hit, create outreach request</div>
                </div>
              </Button>

              <Button
                className="justify-start gap-2 h-auto py-3 bg-red-600 hover:bg-red-700 text-white"
                disabled={!justification.trim() || submitting}
                onClick={() => submit('Confirmed')}
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
                <div className="text-left">
                  <div className="font-medium text-sm">Confirm Match — Escalate to EDR</div>
                  <div className="text-xs text-red-200">Create Event-Driven Review case</div>
                </div>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}