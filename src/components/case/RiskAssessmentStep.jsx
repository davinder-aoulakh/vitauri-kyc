/**
 * Risk Assessment Step — orchestrates S-090, S-091, S-092
 */
import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, User, Building2, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import IndicatorPicker from '@/components/risk/IndicatorPicker';
import IndicatorAssessment from '@/components/risk/IndicatorAssessment';
import ConsolidatedRiskView from '@/components/risk/ConsolidatedRiskView';

export default function RiskAssessmentStep({ kycCase, client, currentUser, onCaseUpdate }) {
  const [relatedParties, setRelatedParties] = useState([]);
  const [loading, setLoading] = useState(true);

  // S-090: per-entity indicator selections { entityKey: [indicatorId, ...] }
  const [selections, setSelections] = useState({});
  const [selectionConfirmed, setSelectionConfirmed] = useState(false);

  // S-091: per-entity scores { entityKey: { indicatorId: { score, notes }, __override: { score } } }
  const [allScores, setAllScores] = useState({});

  const [activeTab, setActiveTab] = useState('picker');

  useEffect(() => { loadRelatedParties(); }, [kycCase?.client_id]);

  async function loadRelatedParties() {
    if (!kycCase?.client_id) { setLoading(false); return; }
    const links = await base44.entities.ClientRelatedPartyLink.filter({ client_id: kycCase.client_id });
    if (links?.length > 0) {
      const rps = await Promise.all(links.map(l => base44.entities.RelatedParty.filter({ id: l.related_party_id })));
      setRelatedParties(rps.flat().filter(Boolean));
    }
    setLoading(false);
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

  function handleScoresChange(entityKey, scores) {
    setAllScores(prev => ({ ...prev, [entityKey]: scores }));
  }

  function handleProceed(finalRisk) {
    onCaseUpdate?.(prev => ({ ...prev, risk_classification: finalRisk, step_6_status: 'complete' }));
    // Already saved inside ConsolidatedRiskView
  }

  if (loading) {
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
            onChange={setSelections}
            allScores={allScores}
            onConfirm={() => {
              setSelectionConfirmed(true);
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
                scores={allScores[e.key] || {}}
                onScoresChange={scores => handleScoresChange(e.key, scores)}
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
              allScores={allScores}
              kycCase={kycCase}
              client={client}
              currentUser={currentUser}
              onProceed={handleProceed}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}