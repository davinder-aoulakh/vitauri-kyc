/**
 * S-090: Risk Indicator Picker
 * Left: master indicator library | Right: per-entity selection
 */
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import { Sparkles, Loader2, Check, X, ChevronRight, User, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export const ALL_INDICATORS = [
  { id: 'geo',         name: 'High-Risk Geography',               description: 'Operating in a high-risk or non-cooperative jurisdiction (FATF grey/blacklist)',  applies: ['NP_Client','ORG_Client','NP_Related_Party','ORG_Related_Party'] },
  { id: 'pep',         name: 'PEP Status',                        description: 'Client or related party is a Politically Exposed Person',                          applies: ['NP_Client','NP_Related_Party'] },
  { id: 'sanctions',   name: 'Sanctions / Adverse Media',         description: 'Confirmed or possible match on sanctions, PEP or adverse media lists',             applies: ['NP_Client','ORG_Client','NP_Related_Party','ORG_Related_Party'] },
  { id: 'ownership',   name: 'Complex Ownership Structure',       description: 'Multi-layered, opaque, or nominee-based ownership arrangements',                   applies: ['ORG_Client','ORG_Related_Party'] },
  { id: 'sector',      name: 'High-Risk Sector / Industry',       description: 'Operating in a high-risk sector (e.g. crypto, gambling, arms, adult)',             applies: ['NP_Client','ORG_Client','NP_Related_Party','ORG_Related_Party'] },
  { id: 'cash',        name: 'Cash-Intensive Business',           description: 'Primary operations involve large cash volumes or cash-equivalent transactions',     applies: ['ORG_Client'] },
  { id: 'nftf',        name: 'Non-Face-to-Face Relationship',     description: 'Client relationship established without in-person verification',                   applies: ['NP_Client','ORG_Client','NP_Related_Party','ORG_Related_Party'] },
  { id: 'txn',         name: 'Unusual Transaction Pattern',       description: 'Transactions inconsistent with stated purpose, profile, or expected behaviour',    applies: ['NP_Client','ORG_Client','NP_Related_Party','ORG_Related_Party'] },
  { id: 'sof',         name: 'Inconsistent SoF/SoW',              description: 'Source of funds or wealth cannot be adequately explained or documented',           applies: ['NP_Client','ORG_Client','NP_Related_Party','ORG_Related_Party'] },
  { id: 'pep_rp',      name: 'Politically Exposed Related Party', description: 'A UBO, director, or key related party is a PEP',                                   applies: ['NP_Client','ORG_Client','NP_Related_Party','ORG_Related_Party'] },
  { id: 'opaque',      name: 'Opaque Ownership / Nominee',        description: 'Use of nominee shareholders, bearer shares, or trusts obscuring beneficial ownership', applies: ['ORG_Client','ORG_Related_Party'] },
  { id: 'introducer',  name: 'Third-Party Introducer',            description: 'Client was introduced by a third party whose identity or integrity is uncertain',   applies: ['NP_Client','ORG_Client','NP_Related_Party','ORG_Related_Party'] },
];

const ENTITY_TYPE_FILTER = [
  { label: 'All',           value: 'all' },
  { label: 'NP Client',     value: 'NP_Client' },
  { label: 'ORG Client',    value: 'ORG_Client' },
  { label: 'NP Related Party', value: 'NP_Related_Party' },
  { label: 'ORG Related Party', value: 'ORG_Related_Party' },
];

export default function IndicatorPicker({ client, relatedParties, selections, onChange, onConfirm }) {
  const [filter, setFilter] = useState('all');
  const [suggesting, setSuggesting] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState(null);
  const [activeEntity, setActiveEntity] = useState('client');

  const entities = [
    { key: 'client', label: client?.full_name || 'Client', type: client?.client_type === 'ORG' ? 'ORG_Client' : 'NP_Client', data: client },
    ...(relatedParties || []).map((rp, i) => ({
      key: `rp_${rp.id}`,
      label: rp.full_name,
      type: rp.party_type === 'ORG' ? 'ORG_Related_Party' : 'NP_Related_Party',
      data: rp,
    })),
  ];

  const activeEntityObj = entities.find(e => e.key === activeEntity);

  const filteredIndicators = ALL_INDICATORS.filter(ind =>
    filter === 'all' || ind.applies.includes(filter)
  );

  function isSelected(entityKey, indicatorId) {
    return (selections[entityKey] || []).includes(indicatorId);
  }

  function toggle(entityKey, indicatorId) {
    const current = selections[entityKey] || [];
    const updated = current.includes(indicatorId)
      ? current.filter(id => id !== indicatorId)
      : [...current, indicatorId];
    onChange({ ...selections, [entityKey]: updated });
  }

  async function suggestIndicators() {
    setSuggesting(true);
    setAiSuggestions(null);

    const entitySummaries = entities.map(e => {
      const d = e.data;
      const base = `${e.label} (${e.type}): ${d?.sector || d?.nationality || ''} ${d?.country_of_residence || d?.registered_country || ''}`.trim();
      return base;
    }).join('\n');

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a KYC compliance expert. Based on the following client and related party data, recommend which risk indicators apply and briefly explain why.

ENTITIES:
${entitySummaries}

AVAILABLE INDICATORS:
${ALL_INDICATORS.map(i => `${i.id}: ${i.name} — ${i.description}`).join('\n')}

For each entity, return the indicator IDs that apply with a one-sentence reason. Return JSON only.`,
      response_json_schema: {
        type: 'object',
        properties: {
          suggestions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                entity_key: { type: 'string' },
                indicator_id: { type: 'string' },
                reason: { type: 'string' },
              }
            }
          }
        }
      }
    });

    setAiSuggestions(result?.suggestions || []);

    // Auto-apply suggestions
    const newSelections = { ...selections };
    (result?.suggestions || []).forEach(s => {
      // Map entity_key from AI (it uses entity index or name) to our keys
      const matchedEntity = entities.find(e =>
        e.label.toLowerCase().includes((s.entity_key || '').toLowerCase()) ||
        s.entity_key === e.key ||
        s.entity_key === String(entities.indexOf(e))
      ) || entities[0];

      if (matchedEntity) {
        const current = newSelections[matchedEntity.key] || [];
        if (!current.includes(s.indicator_id)) {
          newSelections[matchedEntity.key] = [...current, s.indicator_id];
        }
      }
    });
    onChange(newSelections);
    setSuggesting(false);
  }

  const totalSelected = Object.values(selections).flat().length;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-sm text-foreground">Risk Indicator Selection</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Select applicable indicators for each entity, or use AI to suggest</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs text-purple-600 border-purple-200 hover:bg-purple-50"
            onClick={suggestIndicators}
            disabled={suggesting}
          >
            {suggesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {suggesting ? 'Analysing…' : 'AI Suggest Indicators'}
          </Button>
          <Button
            size="sm"
            disabled={totalSelected === 0}
            onClick={onConfirm}
            className="gap-1.5 text-xs"
          >
            <Check className="w-3.5 h-3.5" /> Confirm Selection ({totalSelected})
          </Button>
        </div>
      </div>

      {/* AI suggestion reasoning panel */}
      {aiSuggestions && aiSuggestions.length > 0 && (
        <div className="bg-purple-50/60 border border-purple-200 rounded-xl p-3 space-y-1.5">
          <div className="text-xs font-semibold text-purple-700 mb-1">AI Suggestions Applied — review and adjust below</div>
          {aiSuggestions.slice(0, 6).map((s, i) => (
            <div key={i} className="text-xs text-purple-900 flex gap-2">
              <Sparkles className="w-3 h-3 text-purple-400 mt-0.5 flex-shrink-0" />
              <span><strong>{ALL_INDICATORS.find(ind => ind.id === s.indicator_id)?.name || s.indicator_id}</strong>: {s.reason}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-5 gap-4">
        {/* Left: Indicator Library */}
        <div className="col-span-3 space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {ENTITY_TYPE_FILTER.map(f => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={cn('text-xs px-2.5 py-1 rounded-full border transition-colors',
                  filter === f.value ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-primary/40'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
            {filteredIndicators.map(ind => {
              const selectedForActive = isSelected(activeEntity, ind.id);
              const applicable = !activeEntityObj || ind.applies.includes(activeEntityObj.type);
              return (
                <div
                  key={ind.id}
                  className={cn('flex items-start gap-3 px-4 py-3 transition-colors', applicable ? 'hover:bg-muted/20' : 'opacity-40')}
                >
                  <input
                    type="checkbox"
                    checked={selectedForActive}
                    disabled={!applicable}
                    onChange={() => applicable && toggle(activeEntity, ind.id)}
                    className="mt-0.5 rounded border-border accent-primary"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground">{ind.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{ind.description}</div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {ind.applies.map(a => (
                        <span key={a} className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{a.replace('_', ' ')}</span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Per-Entity Selection */}
        <div className="col-span-2 space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Editing indicators for:</div>
          <div className="space-y-1.5">
            {entities.map(e => (
              <button
                key={e.key}
                onClick={() => setActiveEntity(e.key)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left text-xs transition-colors',
                  activeEntity === e.key
                    ? 'bg-primary/10 border-primary/30 text-primary font-semibold'
                    : 'border-border hover:bg-muted/30'
                )}
              >
                {e.type.startsWith('ORG') ? <Building2 className="w-3.5 h-3.5 flex-shrink-0" /> : <User className="w-3.5 h-3.5 flex-shrink-0" />}
                <span className="truncate">{e.label}</span>
                <span className="ml-auto bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full flex-shrink-0">
                  {(selections[e.key] || []).length}
                </span>
                {activeEntity === e.key && <ChevronRight className="w-3 h-3 flex-shrink-0" />}
              </button>
            ))}
          </div>

          {/* Selected indicators for active entity */}
          <div className="bg-muted/30 border border-border rounded-xl p-3 space-y-1.5">
            <div className="text-xs font-semibold text-muted-foreground mb-1">Selected for {activeEntityObj?.label}</div>
            {(selections[activeEntity] || []).length === 0 ? (
              <div className="text-xs text-muted-foreground italic">None selected — check indicators on the left</div>
            ) : (
              (selections[activeEntity] || []).map(id => {
                const ind = ALL_INDICATORS.find(i => i.id === id);
                return ind ? (
                  <div key={id} className="flex items-center justify-between gap-2 bg-primary/5 rounded-lg px-2.5 py-1.5">
                    <span className="text-xs font-medium text-foreground">{ind.name}</span>
                    <button onClick={() => toggle(activeEntity, id)} className="text-muted-foreground hover:text-destructive">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : null;
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}