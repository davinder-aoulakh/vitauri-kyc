/**
 * Risk Assessment Step — orchestrates S-090, S-091, S-092
 * State is persisted via useRiskAssessmentPersistence (RiskAssessment entity + KycCase.risk_assessment_meta)
 */
import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, User, Building2, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import IndicatorPicker from '@/components/risk/IndicatorPicker';
import IndicatorAssessment from '@/components/risk/IndicatorAssessment';
import ConsolidatedRiskView from '@/components/risk/ConsolidatedRiskView';
import { useRiskAssessmentPersistence } from '@/hooks/useRiskAssessmentPersistence';

export default function RiskAssessmentStep({ kycCase, client, currentUser, onCaseUpdate }) {
  const [relatedParties, setRelatedParties] = useState([]);
  const [rpLoading, setRpLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('picker');

  const {
    loading,
    selections, selectionConfirmed,
    allScores,
    narrativeAccepted, overallNarratives, entityOverrides, consolidatedOverride,
    updateSelections, updateSelectionConfirmed,
    updateAllScores, setAllScoresFull,
    updateNarrativeAccepted, updateOverallNarratives,
    updateEntityOverrides, updateConsolidatedOverride,
    cleanupOrphanedRecords,
  } = useRiskAssessmentPersistence({ kycCase, client });

  useEffect(() => { loadRelatedParties(); }, [kycCase?.client_id]);

  async function loadRelatedParties() {
    if (!kycCase?.client_id) { setRpLoading(false); return; }
    const links = await base44.entities.ClientRelatedPartyLink.filter({ client_id: kycCase.client_id });
    if (links?.length > 0) {
      const rps = await Promise.all(links.map(l => base44.entities.RelatedParty.filter({ id: l.related_party_id })));
      setRelatedParties(rps.flat().filter(Boolean));
    }
    setRpLoading(false);
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

  // When selections change, clean up orphaned RiskAssessment records for each entity
  async function handleSelectionsChange(next) {
    updateSelections(next);
    for (const entityKey of Object.keys(next)) {
      await cleanupOrphanedRecords(entityKey, next[entityKey] || []);
    }
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
      updateAllScores(entityKey, indicatorId, data?.score ? data : null);
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

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-muted/50 border border-border h-auto p-1 flex-wrap gap-1">
          <TabsTrigger value="picker" className="text-xs px-3 py-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" />
            1. Select Indicators
            {selectionConfirmed && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 ml-0.5" />}
          </TabsTrigger>
          {entities.map((e, i) => (
            <TabsTrigger
              key={e.key}
              value={`assess_${e.key}`}
              className="text-xs px-3 py-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm gap-1.5"
            >
              {e.type?.startsWith('ORG') ? <Building2 className="w-3 h-3" /> : <User className="w-3 h-3" />}
              {i + 2}. {e.label.split(' ')[0]}
            </TabsTrigger>
          ))}
          <TabsTrigger value="consolidated" className="text-xs px-3 py-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm">
            {entities.length + 2}. Consolidated View
          </TabsTrigger>
        </TabsList>

        {/* S-090 — Indicator Picker */}
        <TabsContent value="picker" className="mt-4">
          <IndicatorPicker
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
        {entities.map(e => (
          <TabsContent key={e.key} value={`assess_${e.key}`} className="mt-4">
            {!selectionConfirmed ? (
              <div className="text-center py-12 text-muted-foreground text-sm bg-card border border-border rounded-xl">
                Complete the indicator selection in Step 1 first.
              </div>
            ) : (
              <IndicatorAssessment
                entityKey={e.key}
                entityLabel={e.label}
                entityType={e.type}
                client={client}
                selectedIndicatorIds={selections[e.key] || []}
                kycCase={kycCase}
                currentUser={currentUser}
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
                    // Narratives are stored per-indicator inside allScores as ai_narrative
                    Object.entries(patch.narratives).forEach(([indicatorId, text]) => {
                      const existing = allScores[e.key]?.[indicatorId] || {};
                      updateAllScores(e.key, indicatorId, { ...existing, ai_narrative: text });
                    });
                  }
                  if (patch.evidenceLinks !== undefined) {
                    // Evidence is stored per-indicator inside allScores as evidence_document_ids
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
            )}
          </TabsContent>
        ))}

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