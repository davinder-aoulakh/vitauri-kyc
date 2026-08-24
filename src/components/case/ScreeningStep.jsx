import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Shield, AlertTriangle, CheckCircle, Loader2, RefreshCw, ExternalLink, ChevronDown, ChevronUp, Eye, Radio, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { addDays, format } from 'date-fns';
import HitsTable from '@/components/case/screening/HitsTable';
import HitDetailPanel from '@/components/case/screening/HitDetailPanel';

export default function ScreeningStep({ caseId, tenantId, currentUser, kycCase, client, onCaseChanged }) {
  const navigate = useNavigate();

  const [hits, setHits] = useState([]);
  const [monitoringAlerts, setMonitoringAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedHit, setSelectedHit] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmedOnboardingHits, setConfirmedOnboardingHits] = useState([]);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [diditAmlSummary, setDiditAmlSummary] = useState(null); // { status, total_hits, screenings, warnings, thresholds, ongoing_monitoring, synced_at }
  const [showThresholds, setShowThresholds] = useState(false);
  const [expandedHitIdx, setExpandedHitIdx] = useState(null);
  const [updatingHitId, setUpdatingHitId] = useState(null); // hit.id being updated in Didit

  useEffect(() => { loadAll(); }, [caseId]);

  async function loadAll(opts = {}) {
    if (opts.sync) setSyncing(true);
    else setLoading(true);

    const [hitsData, alertsData] = await Promise.all([
      base44.entities.ScreeningHit.filter({ case_id: caseId }, '-created_date'),
      tenantId ? base44.entities.MonitoringAlert.filter({ tenant_id: tenantId }, '-created_date', 50) : Promise.resolve([]),
    ]);
    setHits(hitsData || []);
    setMonitoringAlerts(alertsData || []);

    // Pull latest Didit AML results for any pending IDV items
    await syncDiditAml(hitsData || [], opts.sync);

    if (!opts.sync) setLoading(false);
    setSyncing(false);
  }

  async function syncDiditAml(existingHits, forcePull = false) {
    try {
      const caseOutreaches = await base44.entities.OutreachRequest.filter({ case_id: caseId });
      const caseIds = new Set((caseOutreaches || []).map(r => r.id));
      const clientOutreaches = await base44.entities.OutreachRequest.filter({ client_id: kycCase?.client_id });
      const allOutreaches = [
        ...(caseOutreaches || []),
        ...(clientOutreaches || []).filter(r => !caseIds.has(r.id)),
      ];

      // Find IDV items — pull from Didit for any that have no terminal status yet
      const pendingIdvItems = [];
      for (const req of allOutreaches) {
        for (const item of (req.items || [])) {
          const isIdv = item.field_type === 'id_verification' || item.didit_session_id ||
            (item.item_type === 'data_point' && (item.label || '').toLowerCase().match(/id[&\s]?v|identity\s*verif|idv/i)) ||
            (item.response_text && (() => { try { return JSON.parse(item.response_text)?.didit_session_id; } catch { return false; } })());
          if (!isIdv) continue;
          // Check terminal status — also look inside response_text JSON
          let hasTerminal = item.idv_status && item.idv_status !== 'Pending';
          if (!hasTerminal && item.response_text) {
            try { const p = JSON.parse(item.response_text); hasTerminal = p?.idv_status && p.idv_status !== 'Pending'; } catch {}
          }
          const hasSession = item.didit_session_id || item.response_text;
          if (!hasTerminal && hasSession) pendingIdvItems.push({ req, item });
        }
      }

      if (pendingIdvItems.length > 0 || forcePull) {
        setSyncing(true);
        for (const { req, item } of pendingIdvItems) {
          try {
            await base44.functions.invoke('getDiditSessionResult', {
              session_id:  item.didit_session_id || null,
              outreach_id: req.id,
              item_id:     item.item_id,
              tenant_id:   tenantId,
            });
          } catch {}
        }
      }

      // Re-fetch after potential pull
      const refreshedCaseOutreaches = await base44.entities.OutreachRequest.filter({ case_id: caseId });
      const refreshedClientOutreaches = await base44.entities.OutreachRequest.filter({ client_id: kycCase?.client_id });
      const refreshedAll = [
        ...(refreshedCaseOutreaches || []),
        ...(refreshedClientOutreaches || []).filter(r => !new Set((refreshedCaseOutreaches || []).map(r => r.id)).has(r.id)),
      ];

      // Collect AML summary from all IDV items with terminal status
      // Also parse response_text JSON if direct fields are missing (legacy portal submission bug)
      let amlSummary = null;
      for (const req of refreshedAll) {
        for (const rawItem of (req.items || [])) {
          const isIdv = rawItem.field_type === 'id_verification' || rawItem.didit_session_id ||
            (rawItem.item_type === 'data_point' && (rawItem.label || '').toLowerCase().match(/id[&\s]?v|identity\s*verif|idv/i)) ||
            (rawItem.response_text && (() => { try { return JSON.parse(rawItem.response_text)?.didit_session_id; } catch { return false; } })());
          if (!isIdv) continue;

          // Unpack response_text if direct idv_* fields missing
          let item = rawItem;
          if (!item.idv_status && item.response_text) {
            try {
              const parsed = JSON.parse(item.response_text);
              if (parsed?.idv_status) item = { ...item, ...parsed };
            } catch {}
          }

          if (!item.idv_status || item.idv_status === 'Pending') continue;
          if (item.idv_aml_hits != null) {
            if (!amlSummary || new Date(item.idv_checked_at) > new Date(amlSummary.synced_at)) {
              // If hits exist but screenings detail missing, re-sync from Didit to get full data
              let screenings = item.idv_aml_screenings || null;
              if (item.idv_aml_hits > 0 && !screenings && item.didit_session_id) {
                try {
                  const syncRes = await base44.functions.invoke('getDiditSessionResult', {
                    session_id:  item.didit_session_id,
                    outreach_id: req.id,
                    item_id:     rawItem.item_id,
                    tenant_id:   tenantId,
                  });
                  const syncData = syncRes?.data ?? syncRes;
                  if (syncData?.idv_aml_screenings) screenings = syncData.idv_aml_screenings;
                } catch {}
              }
              amlSummary = {
                status:              item.idv_aml_status || (item.idv_aml_hits === 0 ? 'Clear' : 'Flagged'),
                total_hits:          item.idv_aml_hits,
                screenings,
                warnings:            item.idv_aml_warnings || [],
                ongoing_monitoring:  item.idv_aml_ongoing_monitoring || false,
                adverse_media:       item.idv_aml_adverse_media || false,
                thresholds: {
                  match:   item.idv_aml_match_threshold   ?? null,
                  approve: item.idv_aml_approve_threshold ?? null,
                  review:  item.idv_aml_review_threshold  ?? null,
                  name_w:  item.idv_aml_name_weight       ?? null,
                  dob_w:   item.idv_aml_dob_weight        ?? null,
                  country_w: item.idv_aml_country_weight  ?? null,
                },
                synced_at:  item.idv_checked_at,
                session_id: item.didit_session_id,
              };
            }
          }
        }
      }
      setDiditAmlSummary(amlSummary);

      // Auto-import Didit AML hits as ScreeningHit records (if hits exist)
      const existingDiditHit = existingHits.some(h => h.source === 'Didit_AML');
      if (!existingDiditHit && amlSummary?.total_hits > 0) {
        await base44.entities.ScreeningHit.create({
          tenant_id:        tenantId,
          case_id:          caseId,
          client_id:        kycCase?.client_id,
          entity_name:      client?.full_name || 'Client',
          entity_type:      'Client',
          source:           'Didit_AML',
          hit_name:         `Didit AML Alert — ${amlSummary.total_hits} hit(s) detected`,
          confidence_score: 85,
          status:           'New',
          hit_details: { didit_session_id: amlSummary.session_id, aml_hits: amlSummary.total_hits, aml_status: amlSummary.status },
          ai_recommendation: 'Review Required',
          ai_rationale:  `Didit identity verification returned ${amlSummary.total_hits} AML screening hit(s).`,
        });
        const fresh = await base44.entities.ScreeningHit.filter({ case_id: caseId }, '-created_date');
        setHits(fresh || []);
      }

      // Step 3 auto-complete: AML clear + no active ScreeningHits
      const currentHits = await base44.entities.ScreeningHit.filter({ case_id: caseId }, '-created_date');
      const activeHits = (currentHits || []).filter(h => !['Discounted'].includes(h.status));
      if (amlSummary?.total_hits === 0 && activeHits.length === 0 && kycCase?.step_3_status !== 'complete') {
        await base44.entities.KycCase.update(caseId, { step_3_status: 'complete' });
        await base44.entities.AuditEvent.create({
          tenant_id: tenantId, case_id: caseId, client_id: kycCase?.client_id,
          actor_type: 'System', actor_name: 'System',
          event_type: 'step_3_autocompleted',
          notes: 'Step 3 auto-completed: Didit AML returned 0 hits and no active screening hits.',
        });
        onCaseChanged?.();
      }

    } catch (err) {
      console.error('syncDiditAml error:', err);
    }
  }

  async function updateHitStatusInDidit(hit, newReviewStatus) {
    if (!diditAmlSummary?.session_id) return;
    setUpdatingHitId(hit.id || hit.hit_id);
    try {
      await base44.functions.invoke('updateDiditHitStatus', {
        session_id:    diditAmlSummary.session_id,
        screening_id:  diditAmlSummary.screenings?.[0]?.id || null,
        hit_id:        hit.id || hit.hit_id,
        review_status: newReviewStatus,
        tenant_id:     tenantId,
      });
      // Update local state optimistically
      setDiditAmlSummary(prev => {
        if (!prev?.screenings) return prev;
        const screenings = prev.screenings.map(s => ({
          ...s,
          hits: (s.hits || []).map(h =>
            (h.id || h.hit_id) === (hit.id || hit.hit_id)
              ? { ...h, review_status: newReviewStatus }
              : h
          ),
        }));
        return { ...prev, screenings };
      });
    } catch (err) {
      console.error('Failed to update hit status in Didit:', err);
    } finally {
      setUpdatingHitId(null);
    }
  }

  async function handleDecision(hit, decision, justification) {
    setSubmitting(true);
    const newStatus = decision === 'Discounted' ? 'Discounted' : decision === 'Confirmed' ? 'Confirmed_Match' : 'Under_Review';

    await base44.entities.ScreeningHit.update(hit.id, {
      analyst_decision: decision,
      analyst_justification: justification,
      status: newStatus,
      resolved_by_user_id: currentUser?.id,
    });

    await base44.entities.AuditEvent.create({
      tenant_id:     tenantId,
      case_id:       caseId,
      actor_user_id: currentUser?.id,
      actor_name:    currentUser?.full_name,
      actor_type:    'User',
      event_type:    `screening_decision_${decision.toLowerCase()}`,
      before_state:  { status: hit.status, analyst_decision: null },
      after_state:   { status: newStatus, analyst_decision: decision },
      notes:         justification,
    });

    if (decision === 'Confirmed') {
      if (kycCase?.case_type === 'Onboarding') {
        const indicators = await base44.entities.RiskIndicator.filter({ tenant_id: tenantId });
        const screeningIndicator = indicators?.find(i =>
          i.name?.toLowerCase().includes('screening') ||
          i.name?.toLowerCase().includes('pep') ||
          i.name?.toLowerCase().includes('sanction')
        );
        if (screeningIndicator) {
          await base44.entities.RiskAssessment.create({
            tenant_id:       tenantId,
            case_id:         caseId,
            entity_id:       hit.client_id || kycCase?.client_id,
            entity_type:     'Client',
            entity_name:     hit.entity_name,
            indicator_id:    screeningIndicator.id,
            indicator_name:  screeningIndicator.name,
            score:           'High',
            ai_narrative:    `Confirmed screening hit: ${hit.hit_name} (${hit.source}). ${hit.ai_rationale || ''}`.trim(),
            analyst_narrative: `Confirmed match — ${justification}`,
          });
        }
        setConfirmedOnboardingHits(prev => [...prev, hit]);
      } else {
        const dueDate = format(addDays(new Date(), 30), 'yyyy-MM-dd');
        const edrCase = await base44.entities.KycCase.create({
          tenant_id:            tenantId,
          client_id:            kycCase?.client_id,
          case_type:            'Event_Driven_Review',
          status:               'Draft',
          assigned_analyst_id:  currentUser?.id,
          trigger_reason:       `Screening hit confirmed: ${hit.hit_name} (${hit.source}) — ${justification}`,
          due_date:             dueDate,
          created_by_user_id:   currentUser?.id,
        });
        await base44.entities.AuditEvent.create({
          tenant_id:     tenantId,
          case_id:       caseId,
          actor_user_id: currentUser?.id,
          actor_name:    currentUser?.full_name,
          actor_type:    'User',
          event_type:    'edr_case_created_from_screening',
          notes:         `EDR case created: ${edrCase.id}. Trigger: confirmed screening hit — ${hit.hit_name} (${hit.source}).`,
        });
      }
    }

    setSubmitting(false);
    setSelectedHit(null);
    await loadAll();
  }

  const SOURCE_TABS = [
    { value: 'all',          label: 'All',           color: '' },
    { value: 'Didit_AML',    label: 'Didit AML',     color: 'text-purple-700' },
    { value: 'PEP_List',     label: 'PEP',           color: 'text-purple-700' },
    { value: 'Sanctions_EU', label: 'EU Sanctions',  color: 'text-red-700' },
    { value: 'Sanctions_UN', label: 'UN Sanctions',  color: 'text-red-700' },
    { value: 'Adverse_Media',label: 'Adverse Media', color: 'text-amber-700' },
    { value: 'Internal_Flag',label: 'Internal',      color: 'text-slate-600' },
  ];

  const visibleHits   = sourceFilter === 'all' ? hits : hits.filter(h => h.source === sourceFilter);
  const pendingCount  = hits.filter(h => h.status === 'New').length;
  const resolvedCount = hits.filter(h => ['Discounted', 'Confirmed_Match'].includes(h.status)).length;
  const newAlerts     = monitoringAlerts.filter(a => a.status === 'New').length;
  const sourceCount   = (source) => hits.filter(h => h.source === source).length;
  const sourcePending = (source) => hits.filter(h => h.source === source && h.status === 'New').length;

  return (
    <div className="space-y-4 relative">

      {/* Confirmed onboarding hit banner */}
      {confirmedOnboardingHits.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-800">
              ⚠ Confirmed screening hit{confirmedOnboardingHits.length > 1 ? 's' : ''} — elevated to High risk
            </p>
            <p className="text-xs text-amber-700">
              This hit is being handled within this onboarding case and elevated as a <strong>HIGH risk indicator in Step 6</strong>.
            </p>
            <ul className="mt-1 space-y-0.5">
              {confirmedOnboardingHits.map(h => (
                <li key={h.id} className="text-xs text-amber-700 font-medium">• {h.hit_name} ({h.source?.replace(/_/g, ' ')})</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-sm text-foreground">AML & Sanctions Screening</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Results sourced automatically from Didit verification sessions
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => loadAll({ sync: true })} disabled={loading || syncing}>
          {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {syncing ? 'Syncing…' : 'Sync from Didit'}
        </Button>
      </div>

      {/* Didit AML Summary card — shown when a Didit session has been processed */}
      {diditAmlSummary && (
        <div className={cn(
          'rounded-xl border-2 overflow-hidden',
          diditAmlSummary.total_hits === 0 ? 'border-emerald-200' : 'border-amber-300'
        )}>
          {/* Summary header */}
          <div className={cn(
            'flex items-center justify-between px-4 py-3 gap-3',
            diditAmlSummary.total_hits === 0 ? 'bg-emerald-50' : 'bg-amber-50'
          )}>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-xl">{diditAmlSummary.total_hits === 0 ? '✅' : '⚠️'}</span>
              <div className="min-w-0">
                <div className="font-semibold text-sm flex items-center flex-wrap gap-1.5">
                  Didit AML Screening
                  <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full',
                    diditAmlSummary.total_hits === 0
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-700'
                  )}>
                    {diditAmlSummary.status || (diditAmlSummary.total_hits === 0 ? 'Clear' : 'Flagged')}
                  </span>
                  {/* Ongoing monitoring badge */}
                  {diditAmlSummary.ongoing_monitoring && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                      <Radio className="w-3 h-3" /> Continuous Monitoring
                    </span>
                  )}
                  {/* Adverse media badge */}
                  {diditAmlSummary.adverse_media && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                      + Adverse Media
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {diditAmlSummary.total_hits} hit{diditAmlSummary.total_hits !== 1 ? 's' : ''} detected
                  {diditAmlSummary.synced_at && (
                    <span className="ml-2 opacity-60">
                      · Synced {new Date(diditAmlSummary.synced_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Thresholds toggle */}
              {diditAmlSummary.thresholds?.match != null && (
                <button
                  onClick={() => setShowThresholds(v => !v)}
                  className="text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  {showThresholds ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  Thresholds
                </button>
              )}
              <div className={cn(
                'text-3xl font-bold',
                diditAmlSummary.total_hits === 0 ? 'text-emerald-600' : 'text-amber-600'
              )}>
                {diditAmlSummary.total_hits}
              </div>
            </div>
          </div>

          {/* Warning risk-code badges */}
          {diditAmlSummary.warnings?.length > 0 && (
            <div className={cn(
              'px-4 py-2.5 flex flex-wrap gap-1.5 border-t',
              diditAmlSummary.total_hits === 0 ? 'bg-emerald-50/60 border-emerald-100' : 'bg-amber-50/60 border-amber-200'
            )}>
              <span className="text-xs text-muted-foreground font-medium mr-1 self-center">Risk flags:</span>
              {diditAmlSummary.warnings.map((w, i) => {
                const code = w.risk || w.code || '';
                const style =
                  code.includes('SANCTIONED') || code.includes('MATCH_FOUND') ? 'bg-red-100 text-red-700 border-red-200' :
                  code.includes('PEP')       ? 'bg-purple-100 text-purple-700 border-purple-200' :
                  code.includes('ADVERSE')   ? 'bg-orange-100 text-orange-700 border-orange-200' :
                  code.includes('HIGH_RISK') ? 'bg-amber-100 text-amber-700 border-amber-200' :
                  'bg-slate-100 text-slate-600 border-slate-200';
                return (
                  <span key={i} title={w.short_description || code}
                    className={cn('text-xs px-2 py-0.5 rounded-full border font-medium cursor-default', style)}>
                    {code.replace(/_/g, ' ')}
                  </span>
                );
              })}
            </div>
          )}

          {/* Thresholds & weights strip (collapsible) */}
          {showThresholds && diditAmlSummary.thresholds && (
            <div className="px-4 py-3 bg-muted/20 border-t border-border">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Scoring Thresholds & Weights</div>
              <div className="flex flex-wrap gap-4 text-xs">
                {diditAmlSummary.thresholds.match   != null && <div><span className="text-muted-foreground">Match threshold</span> <span className="font-semibold ml-1">{diditAmlSummary.thresholds.match}%</span></div>}
                {diditAmlSummary.thresholds.approve != null && <div><span className="text-muted-foreground">Auto-approve above</span> <span className="font-semibold text-emerald-700 ml-1">{diditAmlSummary.thresholds.approve}%</span></div>}
                {diditAmlSummary.thresholds.review  != null && <div><span className="text-muted-foreground">Manual review above</span> <span className="font-semibold text-amber-700 ml-1">{diditAmlSummary.thresholds.review}%</span></div>}
                {diditAmlSummary.thresholds.name_w  != null && <div><span className="text-muted-foreground">Name weight</span> <span className="font-semibold ml-1">{diditAmlSummary.thresholds.name_w}%</span></div>}
                {diditAmlSummary.thresholds.dob_w   != null && <div><span className="text-muted-foreground">DOB weight</span> <span className="font-semibold ml-1">{diditAmlSummary.thresholds.dob_w}%</span></div>}
                {diditAmlSummary.thresholds.country_w != null && <div><span className="text-muted-foreground">Country weight</span> <span className="font-semibold ml-1">{diditAmlSummary.thresholds.country_w}%</span></div>}
              </div>
              <p className="text-xs text-muted-foreground/60 mt-2">Scores above the review threshold require manual analyst decision. Scores above the approve threshold are auto-cleared.</p>
            </div>
          )}

          {/* AML hit details — Didit V3 aml_screenings[].hits[] */}
          {diditAmlSummary.total_hits > 0 && diditAmlSummary.screenings && (() => {
            const screenings = Array.isArray(diditAmlSummary.screenings) ? diditAmlSummary.screenings : [diditAmlSummary.screenings];
            const screening = screenings[0] || {};
            const allHits = screening.hits || [];
            const screenedData = screening.screened_data;

            return (
              <div className="px-4 pb-4 bg-card space-y-3">
                {/* Screened data summary */}
                {screenedData && (
                  <div className="bg-muted/40 border border-border rounded-lg px-4 py-3">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Screened Data</div>
                    <div className="grid grid-cols-4 gap-4 text-xs">
                      {screenedData.full_name && <div><div className="text-muted-foreground">Full name</div><div className="font-semibold">{screenedData.full_name}</div></div>}
                      {screenedData.nationality && <div><div className="text-muted-foreground">Nationality</div><div className="font-semibold">{screenedData.nationality}</div></div>}
                      {screenedData.date_of_birth && <div><div className="text-muted-foreground">Date of birth</div><div className="font-semibold">{screenedData.date_of_birth}</div></div>}
                      {screenedData.document_number && <div><div className="text-muted-foreground">Document Number</div><div className="font-semibold">{screenedData.document_number}</div></div>}
                    </div>
                  </div>
                )}

                {/* Hits header */}
                {allHits.length > 0 && (
                  <div className="text-xs font-semibold text-muted-foreground">
                    Matches ({allHits.length})
                  </div>
                )}

                {/* Hit rows */}
                {allHits.length > 0 ? (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/40 border-b border-border text-muted-foreground uppercase tracking-wide">
                          <th className="text-left px-3 py-2 w-4"></th>
                          <th className="text-left px-3 py-2">Name</th>
                          <th className="text-left px-3 py-2">Status</th>
                          <th className="text-left px-3 py-2">Match Score</th>
                          <th className="text-left px-3 py-2">Risk Score</th>
                          <th className="text-left px-3 py-2">Categories</th>
                          <th className="text-left px-3 py-2">Country / DOB</th>
                          <th className="text-left px-3 py-2">Appears On</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-card">
                        {allHits.map((hit, idx) => {
                          const hitKey = hit.id || String(idx);
                          const matchScore = hit.match_score ?? (hit.score != null ? Math.round(hit.score * 100) : null);
                          const riskScore  = hit.risk_score ?? null;
                          const reviewStatus = hit.review_status || 'Unreviewed';
                          const isFalsePositive = reviewStatus === 'False Positive';
                          const isExpanded = expandedHitIdx === hitKey;
                          const isUpdating = updatingHitId === hitKey;
                          const adverseMedia = hit.adverse_media || hit.media_analysis;
                          const hasDetail = adverseMedia || (hit.sources?.length > 0) || (hit.connections?.length > 0);

                          const REVIEW_OPTIONS = [
                            { value: 'Unreviewed',      label: 'UNREVIEWED',      style: 'bg-blue-100 text-blue-700' },
                            { value: 'Confirmed Match', label: 'CONFIRMED MATCH', style: 'bg-red-100 text-red-700' },
                            { value: 'False Positive',  label: 'FALSE POSITIVE',  style: 'bg-slate-100 text-slate-600' },
                            { value: 'Inconclusive',    label: 'INCONCLUSIVE',    style: 'bg-amber-100 text-amber-700' },
                          ];
                          const currentOption = REVIEW_OPTIONS.find(o => o.value === reviewStatus) || REVIEW_OPTIONS[0];

                          return (
                            <React.Fragment key={hitKey}>
                              <tr className={cn('hover:bg-muted/20', isExpanded && 'bg-muted/10')}>
                                {/* Expand toggle */}
                                <td className="px-2 py-2.5">
                                  {hasDetail && (
                                    <button
                                      onClick={() => setExpandedHitIdx(isExpanded ? null : hitKey)}
                                      className="text-muted-foreground hover:text-foreground"
                                    >
                                      <ChevronRight className={cn('w-3.5 h-3.5 transition-transform', isExpanded && 'rotate-90')} />
                                    </button>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 font-medium text-foreground">
                                  {hit.caption || hit.name || `Hit ${idx + 1}`}
                                </td>
                                {/* Status dropdown — updates Didit directly */}
                                <td className="px-3 py-2.5">
                                  <div className="relative group inline-block">
                                    <div className={cn(
                                      'px-2 py-0.5 rounded-full font-medium text-xs cursor-pointer flex items-center gap-1 select-none',
                                      currentOption.style,
                                      isUpdating && 'opacity-50 pointer-events-none'
                                    )}>
                                      {isUpdating
                                        ? <Loader2 className="w-3 h-3 animate-spin" />
                                        : currentOption.label
                                      }
                                      <ChevronDown className="w-2.5 h-2.5 opacity-60" />
                                    </div>
                                    <div className="absolute left-0 top-full mt-1 z-50 hidden group-hover:block bg-card border border-border rounded-lg shadow-lg min-w-[160px] py-1">
                                      {REVIEW_OPTIONS.map(opt => (
                                        <button
                                          key={opt.value}
                                          onClick={() => updateHitStatusInDidit(hit, opt.value)}
                                          className={cn(
                                            'w-full text-left px-3 py-1.5 text-xs font-medium hover:bg-muted/50 flex items-center gap-2',
                                            opt.value === reviewStatus && 'opacity-50 pointer-events-none'
                                          )}
                                        >
                                          <span className={cn('w-2 h-2 rounded-full', opt.style.replace('text-', 'bg-').split(' ')[0])} />
                                          {opt.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-3 py-2.5">
                                  {matchScore != null ? (
                                    <div className="flex items-center gap-2">
                                      <div className="w-16 bg-muted rounded-full h-1.5">
                                        <div
                                          className={cn('h-1.5 rounded-full', matchScore >= 93 ? 'bg-primary' : 'bg-slate-400')}
                                          style={{ width: `${matchScore}%` }}
                                        />
                                      </div>
                                      <span className="font-medium">{matchScore}%</span>
                                    </div>
                                  ) : '—'}
                                </td>
                                <td className="px-3 py-2.5">
                                  {riskScore != null ? (
                                    <div className="flex items-center gap-2">
                                      <div className="w-16 bg-muted rounded-full h-1.5">
                                        <div
                                          className={cn('h-1.5 rounded-full', riskScore >= 86 ? 'bg-red-500' : riskScore >= 40 ? 'bg-amber-400' : 'bg-slate-400')}
                                          style={{ width: `${riskScore}%` }}
                                        />
                                      </div>
                                      <span className="font-medium">{riskScore}%</span>
                                    </div>
                                  ) : '—'}
                                </td>
                                <td className="px-3 py-2.5">
                                  <div className="flex flex-wrap gap-1">
                                    {(hit.categories || []).map((cat, i) => (
                                      <span key={i} className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-xs font-medium">{cat}</span>
                                    ))}
                                    {hit.match_type && (
                                      <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-xs">{hit.match_type}</span>
                                    )}
                                    {(!hit.categories?.length && !hit.match_type) && <span className="text-muted-foreground">—</span>}
                                  </div>
                                </td>
                                <td className="px-3 py-2.5 text-xs text-muted-foreground space-y-0.5">
                                  {(hit.properties?.country || hit.country) && <div>🌍 {hit.properties?.country || hit.country}</div>}
                                  {(hit.properties?.birthDate || hit.date_of_birth) && <div>🗓 {hit.properties?.birthDate || hit.date_of_birth}</div>}
                                  {!hit.properties?.country && !hit.country && !hit.properties?.birthDate && !hit.date_of_birth && '—'}
                                </td>
                                <td className="px-3 py-2.5">
                                  <div className="flex flex-wrap gap-1">
                                    {(hit.datasets || []).map((ds, i) => (
                                      <span key={i} className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-xs font-medium">
                                        {ds.length > 4 ? ds.substring(0, 3).toUpperCase() : ds}
                                      </span>
                                    ))}
                                    {(!hit.datasets?.length) && <span className="text-muted-foreground">—</span>}
                                  </div>
                                </td>
                              </tr>

                              {/* Expanded detail row — adverse media, sources */}
                              {isExpanded && hasDetail && (
                                <tr className="bg-muted/5">
                                  <td colSpan={8} className="px-4 py-3">
                                    {adverseMedia && (
                                      <div className="space-y-3">
                                        {/* Media Analysis Summary */}
                                        <div className="flex items-center gap-4 text-xs">
                                          {adverseMedia.sentiment && (
                                            <div>
                                              <span className="text-muted-foreground">Sentiment: </span>
                                              <span className={cn('font-semibold px-2 py-0.5 rounded-full text-xs',
                                                adverseMedia.sentiment_score < -1 ? 'bg-red-100 text-red-700' :
                                                adverseMedia.sentiment_score < 0 ? 'bg-amber-100 text-amber-700' :
                                                'bg-slate-100 text-slate-600'
                                              )}>
                                                {adverseMedia.sentiment}
                                              </span>
                                            </div>
                                          )}
                                          {adverseMedia.sentiment_score != null && (
                                            <div><span className="text-muted-foreground">Score: </span><span className="font-semibold">{adverseMedia.sentiment_score}</span></div>
                                          )}
                                          {adverseMedia.entity_type && (
                                            <div><span className="text-muted-foreground">Entity Type: </span><span className="font-semibold">{adverseMedia.entity_type}</span></div>
                                          )}
                                        </div>

                                        {/* Adverse Keywords */}
                                        {adverseMedia.adverse_keywords?.length > 0 && (
                                          <div>
                                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Adverse Keywords</div>
                                            <div className="flex flex-wrap gap-1.5">
                                              {adverseMedia.adverse_keywords.map((kw, ki) => (
                                                <span key={ki} className="bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full text-xs font-medium">
                                                  {typeof kw === 'string' ? kw : `${kw.keyword || kw.word} (${kw.count || 1})`}
                                                </span>
                                              ))}
                                            </div>
                                          </div>
                                        )}

                                        {/* Media Articles */}
                                        {adverseMedia.articles?.length > 0 && (
                                          <div>
                                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                                              Media Articles ({adverseMedia.articles.length})
                                            </div>
                                            <div className="space-y-2">
                                              {adverseMedia.articles.slice(0, 5).map((article, ai) => (
                                                <div key={ai} className="bg-card border border-border rounded-lg px-3 py-2.5 flex gap-3">
                                                  {article.thumbnail && (
                                                    <img src={article.thumbnail} alt="" className="w-12 h-10 rounded object-cover flex-shrink-0" />
                                                  )}
                                                  <div className="min-w-0">
                                                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                                      {article.sentiment && (
                                                        <span className={cn('text-xs px-1.5 py-0 rounded font-medium',
                                                          article.sentiment?.toLowerCase().includes('highly') ? 'bg-red-100 text-red-700' :
                                                          article.sentiment?.toLowerCase().includes('negative') ? 'bg-orange-100 text-orange-700' :
                                                          'bg-slate-100 text-slate-600'
                                                        )}>
                                                          {article.sentiment?.toUpperCase()}
                                                        </span>
                                                      )}
                                                      {article.country && (
                                                        <span className="text-xs text-muted-foreground">🌍 {article.country}</span>
                                                      )}
                                                    </div>
                                                    {article.url ? (
                                                      <a href={article.url} target="_blank" rel="noopener noreferrer"
                                                        className="text-xs font-medium text-primary hover:underline line-clamp-2">
                                                        {article.title || article.url}
                                                      </a>
                                                    ) : (
                                                      <div className="text-xs font-medium">{article.title}</div>
                                                    )}
                                                    {article.snippet && (
                                                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{article.snippet}</div>
                                                    )}
                                                    {article.date && (
                                                      <div className="text-xs text-muted-foreground/60 mt-0.5">{article.date}</div>
                                                    )}
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* Sources */}
                                    {hit.sources?.length > 0 && (
                                      <div className="mt-2">
                                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Sources</div>
                                        <div className="flex flex-wrap gap-2">
                                          {hit.sources.map((src, si) => (
                                            <span key={si} className="text-xs bg-muted px-2 py-0.5 rounded border border-border">
                                              {typeof src === 'string' ? src : (src.name || src.source || JSON.stringify(src))}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground italic px-1">No detailed hit records available.</div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs defaultValue="case">
          <TabsList className="bg-muted/50 border border-border h-auto p-1">
            <TabsTrigger value="case" className="text-xs px-3 py-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm">
              Case Screening
              {pendingCount > 0 && (
                <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                  {pendingCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="monitoring" className="text-xs px-3 py-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm">
              Monitoring Alerts
              {newAlerts > 0 && (
                <span className="ml-1.5 bg-orange-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                  {newAlerts}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Case Screening Tab */}
          <TabsContent value="case" className="mt-3">
            {hits.length === 0 ? (
              <div className="bg-card border border-border rounded-xl py-12 text-center">
                <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
                <p className="text-sm font-medium text-muted-foreground">No AML hits found</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  {diditAmlSummary
                    ? 'Didit returned no AML screening hits for this client.'
                    : 'Awaiting Didit verification results from Step 1 outreach.'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Stats */}
                <div className="flex gap-3 text-xs flex-wrap">
                  <div className="bg-card border border-border rounded-lg px-3 py-2 flex items-center gap-2">
                    <span className="w-2 h-2 bg-orange-400 rounded-full" />
                    <span className="text-muted-foreground">Pending:</span>
                    <span className="font-semibold">{pendingCount}</span>
                  </div>
                  <div className="bg-card border border-border rounded-lg px-3 py-2 flex items-center gap-2">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full" />
                    <span className="text-muted-foreground">Resolved:</span>
                    <span className="font-semibold">{resolvedCount}</span>
                  </div>
                  <div className="bg-card border border-border rounded-lg px-3 py-2 flex items-center gap-2">
                    <span className="w-2 h-2 bg-slate-400 rounded-full" />
                    <span className="text-muted-foreground">Total:</span>
                    <span className="font-semibold">{hits.length}</span>
                  </div>
                </div>

                {pendingCount > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <span className="text-sm text-red-700 font-medium">
                      {pendingCount} hit{pendingCount !== 1 ? 's' : ''} require analyst review.
                    </span>
                  </div>
                )}

                {/* Source filter */}
                <div className="flex gap-1.5 flex-wrap">
                  {SOURCE_TABS.filter(t => t.value === 'all' || sourceCount(t.value) > 0).map(tab => (
                    <button
                      key={tab.value}
                      onClick={() => setSourceFilter(tab.value)}
                      className={cn(
                        'text-xs px-3 py-1 rounded-full border font-medium transition-colors flex items-center gap-1.5',
                        sourceFilter === tab.value
                          ? 'bg-primary text-white border-primary'
                          : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground bg-card'
                      )}
                    >
                      {tab.label}
                      {tab.value !== 'all' && (
                        <span className={cn(
                          'rounded-full px-1.5 py-0 text-xs font-semibold',
                          sourceFilter === tab.value ? 'bg-white/20 text-white' :
                          sourcePending(tab.value) > 0 ? 'bg-orange-100 text-orange-700' : 'bg-muted text-muted-foreground'
                        )}>
                          {sourceCount(tab.value)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <HitsTable hits={visibleHits} onRowClick={setSelectedHit} onQuickDecision={handleDecision} submitting={submitting} />
              </div>
            )}
          </TabsContent>

          {/* Monitoring Alerts Tab */}
          <TabsContent value="monitoring" className="mt-3">
            {monitoringAlerts.length === 0 ? (
              <div className="bg-card border border-border rounded-xl py-16 text-center">
                <Shield className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm font-medium text-muted-foreground">No monitoring alerts</p>
                <p className="text-xs text-muted-foreground/60 mt-1">24/7 monitoring alerts for active clients appear here</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{newAlerts} new alert{newAlerts !== 1 ? 's' : ''} across all active clients</p>
                  <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => navigate('/monitoring')}>
                    <ExternalLink className="w-3 h-3" /> Open Monitoring Console
                  </Button>
                </div>
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="text-left px-4 py-3">Entity</th>
                        <th className="text-left px-4 py-3">Type</th>
                        <th className="text-left px-4 py-3">Source</th>
                        <th className="text-left px-4 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {monitoringAlerts.slice(0, 15).map(alert => (
                        <tr key={alert.id} className="hover:bg-muted/20 cursor-pointer" onClick={() => navigate('/monitoring')}>
                          <td className="px-4 py-2.5 text-xs font-medium">{alert.entity_name}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{alert.alert_type?.replace(/_/g, ' ')}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{alert.source || '—'}</td>
                          <td className="px-4 py-2.5">
                            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                              alert.status === 'New' ? 'bg-orange-100 text-orange-700' :
                              alert.status === 'Dismissed' ? 'bg-slate-100 text-slate-600' :
                              'bg-blue-100 text-blue-700'
                            )}>
                              {alert.status?.replace(/_/g, ' ')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* Slide-over Hit Detail Panel */}
      {selectedHit && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setSelectedHit(null)} />
          <HitDetailPanel
            hit={selectedHit}
            onClose={() => setSelectedHit(null)}
            onDecision={handleDecision}
            submitting={submitting}
          />
        </>
      )}
    </div>
  );
}