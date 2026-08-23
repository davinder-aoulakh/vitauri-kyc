import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Shield, AlertTriangle, CheckCircle, Loader2, RefreshCw, ExternalLink } from 'lucide-react';
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
  const [diditAmlSummary, setDiditAmlSummary] = useState(null); // { status, total_hits, items, synced_at }

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
            (item.item_type === 'data_point' && (item.label || '').toLowerCase().match(/id[&\s]?v|identity\s*verif|idv/i));
          if (!isIdv) continue;
          const hasTerminal = item.idv_status && item.idv_status !== 'Pending';
          const hasSession  = item.didit_session_id || item.response_text;
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
      let amlSummary = null;
      for (const req of refreshedAll) {
        for (const item of (req.items || [])) {
          const isIdv = item.field_type === 'id_verification' || item.didit_session_id;
          if (!isIdv || !item.idv_status || item.idv_status === 'Pending') continue;
          if (item.idv_aml_hits != null) {
            if (!amlSummary || new Date(item.idv_checked_at) > new Date(amlSummary.synced_at)) {
              amlSummary = {
                status:     item.idv_aml_status || (item.idv_aml_hits === 0 ? 'Clear' : 'Flagged'),
                total_hits: item.idv_aml_hits,
                screenings: item.idv_aml_screenings || null,
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
          <div className={cn(
            'flex items-center justify-between px-4 py-3 gap-3',
            diditAmlSummary.total_hits === 0 ? 'bg-emerald-50' : 'bg-amber-50'
          )}>
            <div className="flex items-center gap-2">
              <span className="text-xl">{diditAmlSummary.total_hits === 0 ? '✅' : '⚠️'}</span>
              <div>
                <div className="font-semibold text-sm">
                  Didit AML Screening
                  <span className={cn('ml-2 text-xs font-bold px-2 py-0.5 rounded-full',
                    diditAmlSummary.total_hits === 0
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-700'
                  )}>
                    {diditAmlSummary.status || (diditAmlSummary.total_hits === 0 ? 'Clear' : 'Flagged')}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {diditAmlSummary.total_hits} hit{diditAmlSummary.total_hits !== 1 ? 's' : ''} detected
                  {diditAmlSummary.synced_at && (
                    <span className="ml-2 opacity-60">
                      · Synced from Didit {new Date(diditAmlSummary.synced_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className={cn(
              'text-3xl font-bold',
              diditAmlSummary.total_hits === 0 ? 'text-emerald-600' : 'text-amber-600'
            )}>
              {diditAmlSummary.total_hits}
            </div>
          </div>

          {/* AML hit details if any */}
          {diditAmlSummary.total_hits > 0 && diditAmlSummary.screenings && (
            <div className="px-4 py-3 bg-card divide-y divide-border">
              {(Array.isArray(diditAmlSummary.screenings) ? diditAmlSummary.screenings : [diditAmlSummary.screenings]).map((s, i) => (
                <div key={i} className="py-2 text-xs">
                  <div className="font-medium text-foreground">{s.name || s.entity_name || `Hit ${i + 1}`}</div>
                  {s.match_types && <div className="text-muted-foreground mt-0.5">{Array.isArray(s.match_types) ? s.match_types.join(', ') : s.match_types}</div>}
                  {s.score != null && <div className="text-muted-foreground">Score: {Math.round(s.score)}%</div>}
                </div>
              ))}
            </div>
          )}
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