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

export default function ScreeningStep({ caseId, tenantId, currentUser, kycCase, client }) {
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

  useEffect(() => { loadAll(); }, [caseId]);

  async function loadAll() {
    const [hitsData, alertsData] = await Promise.all([
      base44.entities.ScreeningHit.filter({ case_id: caseId }, '-created_date'),
      tenantId ? base44.entities.MonitoringAlert.filter({ tenant_id: tenantId }, '-created_date', 50) : Promise.resolve([]),
    ]);
    setHits(hitsData || []);
    setMonitoringAlerts(alertsData || []);
    setLoading(false);
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

    // If Confirmed → create EDR case
    if (decision === 'Confirmed') {
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
        notes: `EDR case created: ${edrCase.id}. Trigger: ${hit.hit_name}`,
      });
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