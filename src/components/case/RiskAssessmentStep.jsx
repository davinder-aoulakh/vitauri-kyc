/**
 * Risk Assessment Step — orchestrates S-090, S-091, S-092
 * State is persisted via useRiskAssessmentPersistence (RiskAssessment entity + KycCase.risk_assessment_meta)
 */
import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Loader2, User, Users, Building2, BarChart3, ArrowRight, ArrowLeft, CheckCircle, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { deselectedIds } from '@/lib/riskAutosave';
import { cn } from '@/lib/utils';
import IndicatorPicker, { ALL_INDICATORS } from '@/components/risk/IndicatorPicker';
import IndicatorAssessment from '@/components/risk/IndicatorAssessment';
import ConsolidatedRiskView from '@/components/risk/ConsolidatedRiskView';
import InlineError from '@/components/shared/InlineError';
import TmSignalsBox from '@/components/risk/TmSignalsBox';
import { useRiskAssessmentPersistence } from '@/hooks/useRiskAssessmentPersistence';

export default function RiskAssessmentStep({ kycCase, client, currentUser, onCaseUpdate }) {
  const [relatedParties, setRelatedParties] = useState([]);
  const [rpLoading, setRpLoading] = useState(true);
  const [rpError, setRpError] = useState(null);
  // The tab the analyst was on is remembered per case (this browser tab), so coming back to the step returns there.
  const tabKey = `risk_tab:${kycCase?.id}`;
  const [activeTab, setActiveTabState] = useState(() => {
    try { return window.sessionStorage.getItem(tabKey) || 'picker'; } catch { return 'picker'; }
  });
  const setActiveTab = (t) => {
    setActiveTabState(t);
    try { window.sessionStorage.setItem(tabKey, t); } catch { /* storage blocked */ }
  };

  const lastRelationRef = React.useRef(null);

  // { refs, lines } reported by TmSignalsBox; null while the box is not shown (flag off / no TM data)
  const [tmSignals, setTmSignals] = useState(null);
  const handleTmSignals = React.useCallback((refs, lines) => setTmSignals({ refs, lines }), []);

  const {
    loading,
    savedTmSignalRefs,
    saveState, lastSavedAt,
    selections, selectionConfirmed,
    allScores,
    narrativeAccepted, overallNarratives, entityOverrides, consolidatedOverride,
    updateSelections, updateSelectionConfirmed,
    updateAllScores, setAllScoresFull,
    updateNarrativeAccepted, updateOverallNarratives,
    updateEntityOverrides, updateConsolidatedOverride,
    removeIndicatorRecords,
  } = useRiskAssessmentPersistence({ kycCase, client, tmSignalRefs: tmSignals?.refs ?? null, onCaseUpdate });

  useEffect(() => { loadRelatedParties(); }, [kycCase?.client_id]);

  async function loadRelatedParties() {
    if (!kycCase?.client_id) { setRpLoading(false); return; }
    setRpError(null);
    try {
      const links = await base44.entities.ClientRelatedPartyLink.filter({ client_id: kycCase.client_id });
      if (links?.length > 0) {
        const rps = await Promise.all(links.map(l => base44.entities.RelatedParty.filter({ id: l.related_party_id })));
        setRelatedParties(rps.flat().filter(Boolean));
      }
    } catch (err) {
      console.error('RiskAssessmentStep loadRelatedParties error:', err);
      setRpError(err?.message || 'Failed to load related parties.');
    } finally {
      setRpLoading(false);
    }
  }

  const entities = [
    { key: 'client', label: client?.full_name || 'Client', type: client?.client_type === 'ORG' ? 'ORG_Client' : 'NP_Client', role: 'Primary Client', data: client },
    ...relatedParties.map(rp => ({
      key: `rp_${rp.id}`,
      label: rp.full_name,
      type: rp.party_type === 'ORG' ? 'ORG_Related_Party' : 'NP_Related_Party',
      role: rp.role_in_relationship || 'Related Party',
      data: rp,
    })),
  ];

  // When selections change, remove the records of the indicators the analyst de-selected in THIS change only
  // (a stale or partial selection can then never delete scored work).
  function handleSelectionsChange(next) {
    const removed = deselectedIds(selections, next);
    updateSelections(next);
    for (const [entityKey, ids] of Object.entries(removed)) removeIndicatorRecords(entityKey, ids);
  }

  // Build the allScores shape expected by IndicatorAssessment (include __override from entityOverrides)
  function getEntityScores(entityKey) {
    const base = allScores[entityKey] || {};
    const override = entityOverrides[entityKey];
    return override ? { ...base, __override: override } : base;
  }

  // Called by IndicatorAssessment when a score/notes/narrative changes
  function handleScoresChange(entityKey, scores) {
    const { __override, ...indicatorScores } = scores;

    // Update RiskAssessment records for each changed indicator
    Object.entries(indicatorScores).forEach(([indicatorId, data]) => {
      // Notes typed before a score is chosen are kept on screen; the record itself is written once there is a score.
      const hasContent = data?.score || data?.notes || data?.ai_narrative;
      updateAllScores(entityKey, indicatorId, hasContent ? data : null);
    });

    // Persist override to meta
    if (__override !== undefined) {
      const next = { ...entityOverrides, [entityKey]: __override };
      updateEntityOverrides(next);
    }
  }

  function handleProceed(finalRisk) {
    onCaseUpdate?.(prev => ({ ...prev, risk_classification: finalRisk, step_6_status: 'complete' }));
  }

  if (loading || rpLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (rpError) {
    return <InlineError message={rpError} onRetry={loadRelatedParties} />;
  }

  // A remembered entity tab that no longer exists (related party removed) falls back to the picker.
  const validTabs = ['picker', 'consolidated', ...entities.map(e => `assess_${e.key}`)];
  const currentTab = validTabs.includes(activeTab) ? activeTab : 'picker';
  // "Relation View" opens the relation that was viewed last (or the client).
  if (currentTab.startsWith('assess_')) lastRelationRef.current = currentTab;
  const relationTab = validTabs.includes(lastRelationRef.current) ? lastRelationRef.current : `assess_${entities[0].key}`;
  const progressOf = (e) => {
    const ids = (selections[e.key] || []).filter(id => ALL_INDICATORS.some(i => i.id === id));
    return { total: ids.length, scored: ids.filter(id => allScores[e.key]?.[id]?.score).length };
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end -mb-2 text-[11px]" aria-live="polite">
        {saveState === 'saving' && <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>}
        {saveState === 'saved' && <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle className="h-3 w-3" /> All changes saved{lastSavedAt ? ` · ${format(lastSavedAt, 'HH:mm')}` : ''}</span>}
        {saveState === 'error' && <span className="inline-flex items-center gap-1 text-red-700"><AlertTriangle className="h-3 w-3" /> Not saved — retrying on your next change</span>}
      </div>
      <Tabs value={currentTab} onValueChange={setActiveTab}>
        <TabsList className="bg-muted/50 border border-border h-auto p-1 flex-wrap gap-1">
          <TabsTrigger value="picker" className="text-xs px-3 py-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" />
            1. Select Indicators
            {selectionConfirmed && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 ml-0.5" />}
          </TabsTrigger>
          {/* One general tab for all relations (client + related parties); the relation is chosen inside it. */}
          <TabsTrigger value={relationTab} className="text-xs px-3 py-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm gap-1.5">
            <Users className="w-3.5 h-3.5" />
            2. Relation View
            {entities.length > 1 && <span className="text-[10px] text-muted-foreground">({entities.length})</span>}
          </TabsTrigger>
          <TabsTrigger value="consolidated" className="text-xs px-3 py-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm">
            3. Consolidated View
          </TabsTrigger>
        </TabsList>

        {/* S-090 — Indicator Picker */}
        <TabsContent value="picker" className="mt-4">
          <TmSignalsBox
            client={client}
            onChange={handleTmSignals}
            initialRefs={tmSignals ? tmSignals.refs : savedTmSignalRefs}
          />
          <IndicatorPicker
            caseId={kycCase?.id}
            client={client}
            relatedParties={relatedParties}
            selections={selections}
            onChange={handleSelectionsChange}
            allScores={allScores}
            onConfirm={() => {
              updateSelectionConfirmed(true);
              if (entities.length > 0) setActiveTab(`assess_${entities[0].key}`);
            }}
          />
        </TabsContent>

        {/* S-091 — Per-Entity Assessment */}
        {entities.map((e, idx) => {
          // Only count IDs that resolve to a real indicator — a stale/unrecognised
          // indicator_id in selections (e.g. from an old AI Suggest run) can never be
          // scored, which would otherwise block proceeding forever.
          const selectedIds = (selections[e.key] || []).filter(id => ALL_INDICATORS.some(i => i.id === id));
          const entityScores = allScores[e.key] || {};
          const scoredCount = selectedIds.filter(id => entityScores[id]?.score).length;
          const totalCount = selectedIds.length;
          const allScored = totalCount > 0 && scoredCount === totalCount;

          const isFirst = idx === 0;
          const isLast = idx === entities.length - 1;
          const prevTab = isFirst ? 'picker' : `assess_${entities[idx - 1].key}`;
          const nextTab = isLast ? 'consolidated' : `assess_${entities[idx + 1].key}`;
          const backLabel = isFirst ? 'Back to Indicators' : `Back: ${shortName(entities[idx - 1].label)}`;
          const nextLabel = isLast ? 'Next: Consolidated View' : `Next: ${shortName(entities[idx + 1].label)}`;

          return (
            <TabsContent key={e.key} value={`assess_${e.key}`} className="mt-4">
              {/* Relations in this case: pick whose assessment to work on */}
              <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Relations">
                {entities.map((r) => {
                  const pr = progressOf(r);
                  const active = r.key === e.key;
                  const done = pr.total > 0 && pr.scored === pr.total;
                  return (
                    <button key={r.key} type="button" role="tab" aria-selected={active} onClick={() => setActiveTab(`assess_${r.key}`)} title={r.label}
                      className={cn('flex min-w-0 max-w-xs items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                        active ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50')}>
                      <span className={cn('flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full', r.type?.startsWith('ORG') ? 'bg-blue-100 text-blue-600' : 'bg-violet-100 text-violet-600')}>
                        {r.type?.startsWith('ORG') ? <Building2 className="h-3 w-3" /> : <User className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">{r.label}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{r.role}</span>
                      </span>
                      <span className={cn('ml-1 flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', done ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground')}>
                        {done && <CheckCircle className="h-3 w-3" />}{pr.scored}/{pr.total} scored
                      </span>
                    </button>
                  );
                })}
              </div>
              {!selectionConfirmed ? (
                <div className="text-center py-12 text-muted-foreground text-sm bg-card border border-border rounded-xl">
                  Complete the indicator selection in Step 1 first.
                </div>
              ) : (
                <>
                  <IndicatorAssessment
                    entityKey={e.key}
                    entityLabel={e.label}
                    entityType={e.type}
                    client={client}
                    selectedIndicatorIds={selectedIds}
                    kycCase={kycCase}
                    currentUser={currentUser}
                    tmSignalLines={tmSignals?.lines}
                    scores={getEntityScores(e.key)}
                    onScoresChange={scores => handleScoresChange(e.key, scores)}
                    persistedData={{
                      narrativeAccepted:  narrativeAccepted[e.key] || {},
                      overallNarrative:   overallNarratives[e.key] || '',
                      narratives:         buildNarrativesFromScores(allScores[e.key]),
                      evidenceLinks:      buildEvidenceFromScores(allScores[e.key]),
                    }}
                    onPersistedDataChange={(patch) => {
                      if (patch.narrativeAccepted !== undefined) {
                        updateNarrativeAccepted({ ...narrativeAccepted, [e.key]: patch.narrativeAccepted });
                      }
                      if (patch.overallNarrative !== undefined) {
                        updateOverallNarratives({ ...overallNarratives, [e.key]: patch.overallNarrative });
                      }
                      if (patch.narratives !== undefined) {
                        Object.entries(patch.narratives).forEach(([indicatorId, text]) => {
                          const existing = allScores[e.key]?.[indicatorId] || {};
                          updateAllScores(e.key, indicatorId, { ...existing, ai_narrative: text });
                        });
                      }
                      if (patch.evidenceLinks !== undefined) {
                        Object.entries(patch.evidenceLinks).forEach(([indicatorId, docs]) => {
                          const existing = allScores[e.key]?.[indicatorId] || {};
                          updateAllScores(e.key, indicatorId, {
                            ...existing,
                            evidence_document_ids: (docs || []).map(d => d.id),
                          });
                        });
                      }
                    }}
                  />

                  {/* Navigation footer */}
                  <div className="mt-4 pt-4 border-t border-border flex items-start justify-between gap-3">
                    {/* Back */}
                    <Button
                      size="sm" variant="outline"
                      className="text-xs gap-1.5"
                      onClick={() => setActiveTab(prevTab)}
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      {backLabel}
                    </Button>

                    {/* Skip + Next */}
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm" variant="ghost"
                          className="text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setActiveTab('consolidated')}
                        >
                          Skip to Consolidated View
                        </Button>
                        <Button
                          size="sm"
                          className="text-xs gap-1.5"
                          disabled={!allScored}
                          onClick={() => setActiveTab(nextTab)}
                        >
                          {nextLabel}
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      {!allScored && totalCount > 0 && (
                        <span className="text-xs text-muted-foreground">
                          Score all indicators to proceed ({scoredCount}/{totalCount} done)
                        </span>
                      )}
                    </div>
                  </div>
                </>
              )}
            </TabsContent>
          );
        })}

        {/* S-092 — Consolidated Risk */}
        <TabsContent value="consolidated" className="mt-4">
          {!selectionConfirmed ? (
            <div className="text-center py-12 text-muted-foreground text-sm bg-card border border-border rounded-xl">
              Complete indicator selection and scoring first.
            </div>
          ) : (
            <ConsolidatedRiskView
              entities={entities}
              allScores={buildAllScoresWithOverrides(allScores, entityOverrides)}
              kycCase={kycCase}
              client={client}
              currentUser={currentUser}
              onProceed={handleProceed}
              persistedOverride={consolidatedOverride}
              onOverrideChange={updateConsolidatedOverride}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// "Evert David Christiaan Zwarts" -> "Evert Zwarts"; company names are kept (shortened when very long).
function shortName(label) {
  const s = String(label || '').trim();
  const parts = s.split(/\s+/);
  if (/\b(b\.?v\.?|n\.?v\.?|ltd|llc|inc|gmbh|holding|group|management)\b/i.test(s) || parts.length < 3) return s.length > 28 ? `${s.slice(0, 27)}…` : s;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

// Helpers to reconstruct component state from persisted allScores
function buildNarrativesFromScores(entityScores) {
  const result = {};
  Object.entries(entityScores || {}).forEach(([indicatorId, data]) => {
    if (data?.ai_narrative) result[indicatorId] = data.ai_narrative;
  });
  return result;
}

function buildEvidenceFromScores(entityScores) {
  // Returns { indicatorId: [{ id: docId }] } — minimal shape for IndicatorAssessment
  const result = {};
  Object.entries(entityScores || {}).forEach(([indicatorId, data]) => {
    if (data?.evidence_document_ids?.length) {
      result[indicatorId] = data.evidence_document_ids.map(id => ({ id }));
    }
  });
  return result;
}

function buildAllScoresWithOverrides(allScores, entityOverrides) {
  const result = {};
  Object.keys(allScores).forEach(key => {
    result[key] = { ...allScores[key] };
    if (entityOverrides[key]) result[key].__override = entityOverrides[key];
  });
  return result;
}