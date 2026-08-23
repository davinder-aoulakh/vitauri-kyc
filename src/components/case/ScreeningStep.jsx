import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Shield, AlertTriangle, CheckCircle, Loader2, RefreshCw,
  ExternalLink, Users
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { addDays, format } from 'date-fns';
import HitsTable from '@/components/case/screening/HitsTable';
import HitDetailPanel from '@/components/case/screening/HitDetailPanel';
import { runScreening, triageHit } from '@/lib/screeningVendor';
import { resolvePendingDiditSessions } from '@/lib/diditResolve';

export default function ScreeningStep({ caseId, tenantId, currentUser, kycCase, client, onAutoComplete }) {
  const navigate = useNavigate();

  // Case screening hits
  const [hits, setHits] = useState([]);
  const [monitoringAlerts, setMonitoringAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Batch screening progress
  const [screening, setScreening] = useState(false);
  const [screenProgress, setScreenProgress] = useState({ done: 0, total: 0 });
  const [screenSummary, setScreenSummary] = useState(null); // { hitCount, entityCount }

  // Selected hit for slide-over
  const [selectedHit, setSelectedHit] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmedOnboardingHits, setConfirmedOnboardingHits] = useState([]);

  // Didit AML
  const [diditAmlItems, setDiditAmlItems] = useState([]);
  const [importingAml, setImportingAml]   = useState(false);
  const [amlImported, setAmlImported]     = useState(false);

  useEffect(() => { loadAll(); }, [caseId]);

  // Auto-complete: once screening has actually run (real hits on file, a
  // completed batch run, or imported Didit AML results) and nothing is left
  // pending analyst review, this step is done — no separate manual click needed.
  useEffect(() => {
    if (loading || kycCase?.step_3_status === 'complete') return;
    const screeningWasRun = hits.length > 0 || screenSummary != null || amlImported;
    const pendingCount = hits.filter(h => h.status === 'New').length;
    if (screeningWasRun && pendingCount === 0) {
      onAutoComplete?.();
    }
  }, [loading, hits, screenSummary, amlImported]);

  async function loadAll() {
    const [hitsData, alertsData] = await Promise.all([
      base44.entities.ScreeningHit.filter({ case_id: caseId }, '-created_date'),
      tenantId ? base44.entities.MonitoringAlert.filter({ tenant_id: tenantId }, '-created_date', 50) : Promise.resolve([]),
    ]);
    setHits(hitsData || []);
    setMonitoringAlerts(alertsData || []);
    setLoading(false);

    // Load Didit AML results from completed outreach IDV items
    try {
      // Search 1: case-linked outreach
      const caseOutreaches = await base44.entities.OutreachRequest.filter({ case_id: caseId });
      const caseIds = new Set((caseOutreaches || []).map(r => r.id));

      // Search 2: standalone outreach for this client (case_id: null)
      const clientOutreaches = await base44.entities.OutreachRequest.filter({ client_id: kycCase?.client_id });
      const standaloneOnes   = (clientOutreaches || []).filter(r => !caseIds.has(r.id));

      let allOutreaches = [...(caseOutreaches || []), ...standaloneOnes];

      // Reliability backstop — see IdentityVerificationStep for why this is
      // needed: a session can finish after the client's browser stops
      // polling it, and nothing else ever reads the result back otherwise.
      const resolvedAny = await resolvePendingDiditSessions(allOutreaches, tenantId);
      if (resolvedAny) {
        const [freshCase, freshClient] = await Promise.all([
          base44.entities.OutreachRequest.filter({ case_id: caseId }),
          base44.entities.OutreachRequest.filter({ client_id: kycCase?.client_id }),
        ]);
        const freshCaseIds = new Set((freshCase || []).map(r => r.id));
        allOutreaches = [...(freshCase || []), ...(freshClient || []).filter(r => !freshCaseIds.has(r.id))];
      }

      const amlItems = [];
      for (const req of allOutreaches) {
        for (const item of (req.items || [])) {
          // Accept id_verification items OR any item that Didit processed (has session_id)
          const isIdv = item.field_type === 'id_verification' || item.didit_session_id;
          if (isIdv &&
              item.idv_status !== 'Pending' &&
              (item.idv_aml_hits || 0) > 0) {
            amlItems.push(item);
          }
        }
      }
      setDiditAmlItems(amlItems);
      setAmlImported((hitsData || []).some(h => h.source === 'Didit_AML'));
    } catch { /* non-fatal */ }
  }

  async function importDiditAmlHits() {
    setImportingAml(true);
    try {
      for (const item of diditAmlItems) {
        await base44.entities.ScreeningHit.create({
          tenant_id:        kycCase?.tenant_id || tenantId,
          case_id:          caseId,
          client_id:        kycCase?.client_id,
          entity_name:      client?.full_name || 'Client',
          entity_type:      'Client',
          source:           'Didit_AML',
          hit_name:         `Didit AML Alert — ${item.idv_aml_hits} hit(s) detected`,
          confidence_score: 85,
          status:           'New',
          hit_details: {
            didit_session_id: item.didit_session_id,
            aml_hits:         item.idv_aml_hits,
            aml_status:       item.idv_aml_status || 'Flagged',
            document_type:    item.idv_document_type,
            document_number:  item.idv_document_number,
            full_name:        [item.idv_extracted_first_name, item.idv_extracted_last_name].filter(Boolean).join(' '),
            nationality:      item.idv_extracted_nationality,
          },
          ai_recommendation: 'Review Required',
          ai_rationale: `Didit identity verification returned ${item.idv_aml_hits} AML screening hit(s) during the client portal verification session. Open the full Didit session report for individual hit details.`,
        });
      }
      await base44.entities.AuditEvent.create({
        tenant_id:     kycCase?.tenant_id || tenantId,
        case_id:       caseId,
        actor_user_id: currentUser?.id,
        actor_name:    currentUser?.full_name,
        actor_type:    'User',
        event_type:    'didit_aml_imported',
        notes:         `Didit AML results imported: ${diditAmlItems.length} alert(s) from portal verification.`,
      });
      setAmlImported(true);
      await loadAll();
    } finally { setImportingAml(false); }
  }

  async function batchScreen() {
    setScreening(true);
    setScreenSummary(null);

    // Build entity list: client + related parties
    const entities = [];
    if (client) {
      entities.push({
        id: client.id,
        name: client.full_name,
        type: 'Client',
        dateOfBirth: client.date_of_birth,
        registrationNumber: client.registration_number,
        country: client.registered_country || client.nationality,
      });
    }
    // Load related parties
    const links = await base44.entities.ClientRelatedPartyLink.filter({ client_id: kycCase?.client_id });
    if (links?.length > 0) {
      const rps = await Promise.all(links.map(l => base44.entities.RelatedParty.filter({ id: l.related_party_id })));
      rps.flat().filter(Boolean).forEach(rp => {
        entities.push({
          id: rp.id,
          name: rp.full_name,
          type: 'Related_Party',
          dateOfBirth: rp.date_of_birth,
          registrationNumber: rp.registration_number,
          country: rp.registered_country || rp.nationality,
        });
      });
    }

    setScreenProgress({ done: 0, total: entities.length });

    let totalHits = 0;
    let entitiesWithHits = 0;

    for (const entity of entities) {
      const vendorHits = await runScreening(entity);
      setScreenProgress(p => ({ ...p, done: p.done + 1 }));

      if (vendorHits.length > 0) {
        entitiesWithHits++;
        totalHits += vendorHits.length;
        for (const vh of vendorHits) {
          const triage = triageHit(vh, entity);
          await base44.entities.ScreeningHit.create({
            tenant_id: tenantId,
            case_id: caseId,
            client_id: entity.type === 'Client' ? entity.id : kycCase?.client_id,
            related_party_id: entity.type === 'Related_Party' ? entity.id : undefined,
            entity_name: entity.name,
            entity_type: entity.type === 'Client' ? 'Client' : 'Related_Party',
            source: vh.source,
            hit_name: vh.hitName,
            confidence_score: vh.confidenceScore,
            hit_details: vh.rawDetails,
            status: 'New',
            ai_recommendation: triage.recommendation,
            ai_rationale: triage.rationale,
          });
        }
      }
    }

    await base44.entities.AuditEvent.create({
      tenant_id: tenantId,
      case_id: caseId,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'batch_screening_run',
      notes: `Batch screening completed: ${entities.length} entities screened, ${totalHits} hits found across ${entitiesWithHits} entities.`,
    });

    setScreenSummary({ hitCount: totalHits, entityCount: entities.length, entitiesWithHits });
    setScreening(false);
    await loadAll();
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
      tenant_id: tenantId,
      case_id: caseId,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: `screening_decision_${decision.toLowerCase()}`,
      before_state: { status: hit.status, analyst_decision: null },
      after_state: { status: newStatus, analyst_decision: decision },
      notes: justification,
      is_override: false,
    });

    // If Confirmed — handle differently for Onboarding vs existing client cases
    if (decision === 'Confirmed') {
      if (kycCase?.case_type === 'Onboarding') {
        // Onboarding: handle in-case, do NOT create EDR
        // Add a High-risk RiskAssessment indicator entry
        const indicators = await base44.entities.RiskIndicator.filter({ tenant_id: tenantId });
        const screeningIndicator = indicators?.find(i =>
          i.name?.toLowerCase().includes('screening') || i.name?.toLowerCase().includes('pep') || i.name?.toLowerCase().includes('sanction')
        );
        if (screeningIndicator) {
          await base44.entities.RiskAssessment.create({
            tenant_id: tenantId,
            case_id: caseId,
            entity_id: hit.client_id || kycCase?.client_id,
            entity_type: 'Client',
            entity_name: hit.entity_name,
            indicator_id: screeningIndicator.id,
            indicator_name: screeningIndicator.name,
            score: 'High',
            ai_narrative: `Confirmed screening hit: ${hit.hit_name} (${hit.source}). ${hit.ai_rationale || ''}`.trim(),
            analyst_narrative: `Confirmed match — ${justification}`,
          });
        }
        await base44.entities.AuditEvent.create({
          tenant_id: tenantId,
          case_id: caseId,
          actor_user_id: currentUser?.id,
          actor_name: currentUser?.full_name,
          actor_type: 'User',
          event_type: 'screening_confirmed_hit_onboarding',
          notes: `Confirmed screening hit (${hit.hit_name} / ${hit.source}) handled in-case. Elevated as High risk indicator in Risk Assessment. EDR will be triggered post-onboarding if client is accepted. Justification: ${justification}`,
        });
        setConfirmedOnboardingHits(prev => [...prev, hit]);
      } else {
        // Existing client (Periodic Review, EDR, etc.): create EDR case as before
        const dueDate = format(addDays(new Date(), 30), 'yyyy-MM-dd');
        const edrCase = await base44.entities.KycCase.create({
          tenant_id: tenantId,
          client_id: kycCase?.client_id,
          case_type: 'Event_Driven_Review',
          status: 'Draft',
          assigned_analyst_id: currentUser?.id,
          trigger_reason: `Screening hit confirmed: ${hit.hit_name} (${hit.source}) — ${justification}`,
          due_date: dueDate,
          created_by_user_id: currentUser?.id,
        });
        await base44.entities.AuditEvent.create({
          tenant_id: tenantId,
          case_id: caseId,
          actor_user_id: currentUser?.id,
          actor_name: currentUser?.full_name,
          actor_type: 'User',
          event_type: 'edr_case_created_from_screening',
          notes: `EDR case created: ${edrCase.id}. Trigger: confirmed screening hit — ${hit.hit_name} (${hit.source}). Justification: ${justification}`,
        });
      }
    }

    setSubmitting(false);
    setSelectedHit(null);
    await loadAll();
  }

  const [sourceFilter, setSourceFilter] = useState('all');

  const SOURCE_TABS = [
    { value: 'all',          label: 'All',           color: '' },
    { value: 'PEP_List',     label: 'PEP',           color: 'text-purple-700' },
    { value: 'Sanctions_EU', label: 'EU Sanctions',  color: 'text-red-700' },
    { value: 'Sanctions_UN', label: 'UN Sanctions',  color: 'text-red-700' },
    { value: 'Adverse_Media',label: 'Adverse Media', color: 'text-amber-700' },
    { value: 'Internal_Flag',label: 'Internal',      color: 'text-slate-600' },
  ];

  const visibleHits = sourceFilter === 'all' ? hits : hits.filter(h => h.source === sourceFilter);
  const pendingCount = hits.filter(h => h.status === 'New').length;
  const resolvedCount = hits.filter(h => ['Discounted', 'Confirmed_Match'].includes(h.status)).length;
  const newAlerts = monitoringAlerts.filter(a => a.status === 'New').length;

  // Source breakdown counts for tabs
  const sourceCount = (source) => hits.filter(h => h.source === source).length;
  const sourcePending = (source) => hits.filter(h => h.source === source && h.status === 'New').length;

  return (
    <div className="space-y-4 relative">
      {/* Didit AML Alerts Banner */}
      {diditAmlItems.length > 0 && (
        <div className={cn(
          'rounded-xl border p-4',
          amlImported ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
        )}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">⚠</span>
              <div>
                <div className="text-sm font-semibold text-amber-900">
                  Didit AML Alerts
                  {amlImported && (
                    <span className="ml-2 text-emerald-700 text-xs font-normal">(imported to screening hits)</span>
                  )}
                </div>
                <div className="text-xs text-amber-700">
                  {diditAmlItems.length} Didit verification session{diditAmlItems.length !== 1 ? 's' : ''} returned AML hits.
                  {!amlImported && ' Import them below to review alongside other screening results.'}
                </div>
              </div>
            </div>
            {!amlImported && (
              <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white gap-2"
                onClick={importDiditAmlHits} disabled={importingAml}>
                {importingAml
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Importing…</>
                  : '+ Import Didit AML Hits'}
              </Button>
            )}
          </div>
          <div className="mt-3 pt-3 border-t border-amber-200/60 space-y-1.5">
            {diditAmlItems.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-amber-900">
                  {item.label || 'ID Verification'} —{' '}
                  <span className="font-semibold">{item.idv_aml_hits} hit(s)</span>
                  {item.idv_extracted_first_name &&
                    ` · ${[item.idv_extracted_first_name, item.idv_extracted_last_name].filter(Boolean).join(' ')}`}
                </span>
                {item.didit_session_id && (
                  <span className="text-muted-foreground font-mono">
                    Session: {item.didit_session_id.substring(0, 12)}…
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Controls Row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-sm text-foreground">PEP / Sanctions / Adverse Media Screening</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Screen the client and all related parties simultaneously</p>
        </div>
        <div className="flex items-center gap-2">
          {hits.length > 0 && (
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={loadAll} disabled={screening}>
              <RefreshCw className="w-3 h-3" /> Refresh
            </Button>
          )}
          <Button
            size="sm"
            onClick={batchScreen}
            disabled={screening}
            className="gap-2 text-xs"
          >
            {screening
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Screening {screenProgress.done}/{screenProgress.total}…</>
              : <><Shield className="w-3.5 h-3.5" />{hits.length > 0 ? 'Re-screen All Entities' : 'Screen All Entities'}</>
            }
          </Button>
        </div>
      </div>

      {/* Progress Bar during screening */}
      {screening && screenProgress.total > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Screening entities…</span>
            <span>{screenProgress.done} / {screenProgress.total}</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${screenProgress.total > 0 ? (screenProgress.done / screenProgress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Summary Banner */}
      {screenSummary && (
        <div className={cn(
          'rounded-xl border p-3 flex items-center gap-3 text-sm',
          screenSummary.hitCount > 0 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        )}>
          {screenSummary.hitCount > 0
            ? <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            : <CheckCircle className="w-4 h-4 flex-shrink-0" />
          }
          <span className="font-medium">
            {screenSummary.hitCount > 0
              ? `${screenSummary.hitCount} hit${screenSummary.hitCount !== 1 ? 's' : ''} found across ${screenSummary.entitiesWithHits} of ${screenSummary.entityCount} entities screened`
              : `All clear — ${screenSummary.entityCount} entities screened with no hits`
            }
          </span>
          <button className="ml-auto text-xs underline opacity-70 hover:opacity-100" onClick={() => setScreenSummary(null)}>×</button>
        </div>
      )}

      {/* Pending alert */}
      {!loading && pendingCount > 0 && !screenSummary && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-sm text-red-700 font-medium">
            {pendingCount} hit{pendingCount !== 1 ? 's' : ''} require analyst review. Click any row to open the detail panel.
          </span>
        </div>
      )}

      {/* Onboarding confirmed-hit banner */}
      {confirmedOnboardingHits.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-800">
              ⚠ Confirmed screening hit{confirmedOnboardingHits.length > 1 ? 's' : ''} — elevated to High risk
            </p>
            <p className="text-xs text-amber-700">
              This hit is being handled within this onboarding case and will be elevated as a <strong>HIGH risk indicator in Step 6 (Risk Assessment)</strong>.
              An EDR case will be created automatically after onboarding is complete if the client is accepted.
            </p>
            <ul className="mt-1 space-y-0.5">
              {confirmedOnboardingHits.map(h => (
                <li key={h.id} className="text-xs text-amber-700 font-medium">
                  • {h.hit_name} ({h.source?.replace(/_/g, ' ')})
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Tabs */}
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
              <div className="bg-card border border-border rounded-xl py-16 text-center">
                <Shield className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm font-medium text-muted-foreground">No screening results yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Click "Screen All Entities" to run PEP, Sanctions & Adverse Media checks</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Stats row */}
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

                {/* Source filter tabs */}
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
                        <tr
                          key={alert.id}
                          className="hover:bg-muted/20 cursor-pointer"
                          onClick={() => navigate('/monitoring')}
                        >
                          <td className="px-4 py-2.5 text-xs font-medium">{alert.entity_name}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{alert.alert_type?.replace(/_/g,' ')}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{alert.source || '—'}</td>
                          <td className="px-4 py-2.5">
                            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                              alert.status === 'New' ? 'bg-orange-100 text-orange-700' :
                              alert.status === 'Dismissed' ? 'bg-slate-100 text-slate-600' :
                              'bg-blue-100 text-blue-700'
                            )}>
                              {alert.status?.replace(/_/g,' ')}
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
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setSelectedHit(null)}
          />
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