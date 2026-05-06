import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Shield, AlertTriangle, CheckCircle, Loader2, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const MOCK_HITS = [
  {
    entity_name: 'Client',
    source: 'Adverse_Media',
    hit_name: 'Adverse Media — Financial Regulator Investigation',
    confidence_score: 87,
    ai_recommendation: 'Confirmed_Match',
    ai_rationale: 'HIGH confidence (87%). The name and jurisdiction match the client record closely. Regulator investigation article from credible source. Unlikely false positive. Recommend confirming and considering EDR.',
    status: 'New',
  },
  {
    entity_name: 'Related Party — J.M. Holt',
    source: 'PEP_List',
    hit_name: 'PEP Match — Former Municipal Official',
    confidence_score: 54,
    ai_recommendation: 'Likely_False_Positive',
    ai_rationale: 'LOW confidence (54%). DoB discrepancy and middle name mismatch. Political role ended 4+ years ago. Recommend discounting as false positive, with written justification.',
    status: 'New',
  },
];

export default function ScreeningStep({ caseId, tenantId, currentUser }) {
  const [hits, setHits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [screening, setScreening] = useState(false);
  const [expandedHit, setExpandedHit] = useState(null);
  const [justification, setJustification] = useState({});
  const [submitting, setSubmitting] = useState(null);

  useEffect(() => { loadHits(); }, [caseId]);

  async function loadHits() {
    const data = await base44.entities.ScreeningHit.filter({ case_id: caseId });
    setHits(data || []);
    setLoading(false);
  }

  async function runScreening() {
    setScreening(true);
    // Seed mock hits for demo
    for (const hit of MOCK_HITS) {
      await base44.entities.ScreeningHit.create({
        ...hit,
        tenant_id: tenantId,
        case_id: caseId,
        entity_type: 'Client',
        hit_details: {},
      });
    }
    await loadHits();
    setScreening(false);
  }

  async function makeDecision(hit, decision) {
    const j = justification[hit.id] || '';
    if (decision === 'Discounted' && j.length < 20) {
      alert('Please provide at least 20 characters of justification for discounting a hit.');
      return;
    }
    setSubmitting(hit.id);
    await base44.entities.ScreeningHit.update(hit.id, {
      analyst_decision: decision,
      analyst_justification: j,
      status: decision === 'Discounted' ? 'Discounted' : 'Confirmed_Match',
    });
    await base44.entities.AuditEvent.create({
      tenant_id: tenantId,
      case_id: caseId,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: `screening_hit_${decision.toLowerCase()}`,
      notes: j,
    });
    await loadHits();
    setSubmitting(null);
  }

  const pendingHits = hits.filter(h => h.status === 'New' || h.status === 'Under_Review');

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm text-foreground">PEP / Sanctions / Adverse Media Screening</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Screen the client and all related parties</p>
        </div>
        <Button
          onClick={runScreening}
          disabled={screening || hits.length > 0}
          className="gap-2 text-sm"
          variant={hits.length > 0 ? 'outline' : 'default'}
        >
          {screening ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
          {screening ? 'Screening…' : hits.length > 0 ? 'Re-screen All' : 'Screen All Entities'}
        </Button>
      </div>

      {/* Alert Banner */}
      {pendingHits.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-sm text-red-700 font-medium">
            {pendingHits.length} screening hit{pendingHits.length !== 1 ? 's' : ''} require review. Click any hit below.
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : hits.length === 0 ? (
        <div className="bg-card border border-border rounded-xl py-12 text-center">
          <Shield className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Click "Screen All Entities" to run screening</p>
        </div>
      ) : (
        <div className="space-y-3">
          {hits.map(hit => (
            <HitCard
              key={hit.id}
              hit={hit}
              expanded={expandedHit === hit.id}
              onToggle={() => setExpandedHit(expandedHit === hit.id ? null : hit.id)}
              justification={justification[hit.id] || ''}
              onJustification={text => setJustification(j => ({ ...j, [hit.id]: text }))}
              onDecision={decision => makeDecision(hit, decision)}
              submitting={submitting === hit.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HitCard({ hit, expanded, onToggle, justification, onJustification, onDecision, submitting }) {
  const confidenceColor = hit.confidence_score >= 80 ? 'text-red-600 bg-red-50' : hit.confidence_score >= 50 ? 'text-amber-600 bg-amber-50' : 'text-slate-600 bg-slate-50';
  const recColor = hit.ai_recommendation === 'Confirmed_Match' ? 'bg-red-100 text-red-700' : hit.ai_recommendation === 'Likely_False_Positive' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700';
  const isDone = ['Discounted', 'Confirmed_Match', 'Escalated'].includes(hit.status);

  return (
    <div className={cn('border rounded-xl overflow-hidden transition-colors', isDone ? 'border-border opacity-60' : 'border-border bg-card')}>
      <button className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors" onClick={onToggle}>
        <div className="flex items-center gap-3">
          <div className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', confidenceColor)}>
            {hit.confidence_score}%
          </div>
          <div>
            <div className="text-sm font-medium text-foreground">{hit.entity_name} — {hit.source?.replace(/_/g,' ')}</div>
            <div className="text-xs text-muted-foreground">{hit.hit_name}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {hit.analyst_decision ? (
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', hit.analyst_decision === 'Discounted' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
              {hit.analyst_decision}
            </span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">Needs Review</span>
          )}
          <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border">
          <div className="grid md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-border">
            {/* Hit Details */}
            <div className="p-4 space-y-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Hit Details</div>
              <div className="space-y-2">
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">Source</span><span className="font-medium">{hit.source?.replace(/_/g,' ')}</span></div>
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">Entity</span><span className="font-medium">{hit.entity_name}</span></div>
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">Confidence</span><span className={cn('font-semibold', hit.confidence_score >= 80 ? 'text-red-600' : hit.confidence_score >= 50 ? 'text-amber-600' : 'text-green-600')}>{hit.confidence_score}%</span></div>
              </div>
            </div>

            {/* AI Panel */}
            <div className="p-4 space-y-3 bg-purple-50/30">
              <div className="text-xs font-semibold text-purple-700 uppercase tracking-wide">AI Screening Triage</div>
              <div className={cn('text-xs px-2.5 py-1.5 rounded-lg font-medium inline-block', recColor)}>
                {hit.ai_recommendation?.replace(/_/g,' ')}
              </div>
              <p className="text-xs text-foreground/80 leading-relaxed">{hit.ai_rationale}</p>
              <div className="flex gap-2 text-xs">
                <button className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100 transition-colors font-medium">Accept</button>
                <button className="px-2 py-1 bg-amber-50 text-amber-700 rounded hover:bg-amber-100 transition-colors font-medium">Edit</button>
                <button className="px-2 py-1 bg-red-50 text-red-700 rounded hover:bg-red-100 transition-colors font-medium">Override</button>
              </div>
            </div>
          </div>

          {/* Decision Section */}
          {!isDone && (
            <div className="p-4 border-t border-border bg-muted/20">
              <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Analyst Decision</div>
              <Textarea
                value={justification}
                onChange={e => onJustification(e.target.value)}
                placeholder="Written justification required (min 20 characters for discounting)…"
                className="text-xs min-h-12 mb-3"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs gap-1 border-green-300 text-green-700 hover:bg-green-50"
                  onClick={() => onDecision('Discounted')}
                  disabled={submitting}
                >
                  <CheckCircle className="w-3 h-3" />
                  Discount (False Positive)
                </Button>
                <Button
                  size="sm"
                  className="text-xs gap-1 bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => onDecision('Confirmed')}
                  disabled={submitting}
                >
                  <AlertTriangle className="w-3 h-3" />
                  Confirm → Escalate EDR
                </Button>
                {submitting && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}