/**
 * S-090: Risk Indicator Picker — mockup-aligned
 * Category-grouped cards, per-entity toggle switches, entity-scope filter, live right rail.
 *
 * Props contract UNCHANGED: { client, relatedParties, selections, onChange, onConfirm, allScores }
 * ALL_INDICATORS export PRESERVED (backward-compat for IndicatorAssessment import).
 */
import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Sparkles, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRiskIndicators } from '@/hooks/useRiskIndicators';
import IndicatorCategoryGroup from '@/components/risk/IndicatorCategoryGroup';
import SelectionSummaryRail from '@/components/risk/SelectionSummaryRail';
import { useTenant } from '@/lib/tenantContext';

// ─── Re-export for backward compat (IndicatorAssessment imports ALL_INDICATORS from here) ───
export { ALL_INDICATORS } from '@/lib/riskIndicatorLibrary';
import { ALL_INDICATORS } from '@/lib/riskIndicatorLibrary';

const CATEGORIES = [
  'Geography & Sector',
  'PEP & Sanctions',
  'Ownership & Structure',
  'Transaction & Financial Behaviour',
  'Relationship & Onboarding',
];

const SCOPE_FILTERS = [
  { key: 'All', label: 'All' },
  { key: 'NP_Client', label: 'NP Client' },
  { key: 'ORG_Client', label: 'ORG Client' },
  { key: 'NP_Related_Party', label: 'NP Related Party' },
  { key: 'ORG_Related_Party', label: 'ORG Related Party' },
];

export default function IndicatorPicker({ client, relatedParties, selections, onChange, onConfirm, allScores }) {
  const { tenant } = useTenant();
  const { byCategory, loading } = useRiskIndicators(tenant?.id);

  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState('All');
  const [suggesting, setSuggesting] = useState(false);
  const [aiBadges, setAiBadges] = useState({});
  const [reviewed, setReviewed] = useState(new Set());
  const [activeEntityKey, setActiveEntityKey] = useState(null);

  const entities = [
    { key: 'client', label: client?.full_name || 'Client', type: client?.client_type === 'ORG' ? 'ORG_Client' : 'NP_Client', data: client },
    ...(relatedParties || []).map(rp => ({
      key: `rp_${rp.id}`,
      label: rp.full_name,
      type: rp.party_type === 'ORG' ? 'ORG_Related_Party' : 'NP_Related_Party',
      data: rp,
    })),
  ];

  // Default active entity key to first entity
  const resolvedActiveKey = activeEntityKey || entities[0]?.key;

  function toggle(entityKey, indicatorId) {
    const current = selections[entityKey] || [];
    const updated = current.includes(indicatorId)
      ? current.filter(id => id !== indicatorId)
      : [...current, indicatorId];
    onChange({ ...selections, [entityKey]: updated });
    setReviewed(r => new Set([...r, indicatorId]));
  }

  function dismissAiBadge(entityKey, indicatorId) {
    setAiBadges(prev => ({
      ...prev,
      [indicatorId]: {
        ...(prev[indicatorId] || {}),
        [entityKey]: { ...(prev[indicatorId]?.[entityKey] || {}), dismissed: true },
      },
    }));
  }

  const allIndicatorIds = ALL_INDICATORS.map(i => i.id);
  const reviewedCount = allIndicatorIds.filter(id => {
    const hasSaved = entities.some(e => (selections[e.key] || []).includes(id));
    return hasSaved || reviewed.has(id);
  }).length;

  const totalSelected = Object.values(selections).flat().length;

  // Filter by search + scope
  const filteredByCategory = useMemo(() => {
    const q = search.toLowerCase().trim();
    const result = {};
    CATEGORIES.forEach(cat => {
      let inds = byCategory[cat] || [];
      if (q) inds = inds.filter(ind => ind.name.toLowerCase().includes(q) || ind.description.toLowerCase().includes(q));
      if (scopeFilter !== 'All') inds = inds.filter(ind => (ind.applies || []).includes(scopeFilter));
      result[cat] = inds;
    });
    return result;
  }, [search, scopeFilter, byCategory]);

  const hasSearchResults = CATEGORIES.some(cat => (filteredByCategory[cat] || []).length > 0);

  // Active entity for AI suggest label
  const activeEntity = entities.find(e => e.key === resolvedActiveKey) || entities[0];

  async function suggestIndicators() {
    setSuggesting(true);
    setAiBadges({});

    const entitySummaries = entities.map(e => {
      const d = e.data;
      return `${e.key}|${e.label} (${e.type}): ${d?.sector || d?.nationality || ''} ${d?.country_of_residence || d?.registered_country || ''}`.trim();
    }).join('\n');

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a KYC compliance expert. Based on the following client and related party data, recommend which risk indicators apply and briefly explain why.

ENTITIES (format: key|name type: details):
${entitySummaries}

AVAILABLE INDICATORS:
${ALL_INDICATORS.map(i => `${i.id}: ${i.name} — ${i.description}`).join('\n')}

For each entity, return the indicator IDs that apply with a one-sentence reason.
Use the exact entity key (before the | separator) in entity_key.
Return JSON only.`,
      response_json_schema: {
        type: 'object',
        properties: {
          suggestions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                entity_key:   { type: 'string' },
                indicator_id: { type: 'string' },
                reason:       { type: 'string' },
              }
            }
          }
        }
      }
    });

    const newBadges = {};
    const newSelections = { ...selections };

    (result?.suggestions || []).forEach(s => {
      const matchedEntity = entities.find(e =>
        e.key === s.entity_key ||
        e.label.toLowerCase().includes((s.entity_key || '').toLowerCase())
      ) || entities[0];

      if (!matchedEntity || !s.indicator_id) return;

      if (!newBadges[s.indicator_id]) newBadges[s.indicator_id] = {};
      newBadges[s.indicator_id][matchedEntity.key] = { reason: s.reason, dismissed: false };

      const current = newSelections[matchedEntity.key] || [];
      if (!current.includes(s.indicator_id)) {
        newSelections[matchedEntity.key] = [...current, s.indicator_id];
      }
    });

    setAiBadges(newBadges);
    onChange(newSelections);
    setSuggesting(false);
  }

  return (
    <div className="space-y-4">
      {/* Top bar: title */}
      <div>
        <h3 className="font-semibold text-sm text-foreground">Risk Indicator Selection</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Select applicable indicators per entity, grouped by risk category. Use AI Suggest for a starting point, then review and confirm.
        </p>
      </div>

      {/* Search + scope filters + AI Suggest */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search indicators…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-input rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Scope filter pills + AI Suggest */}
        <div className="flex items-center gap-2 flex-wrap">
          {SCOPE_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setScopeFilter(f.key)}
              className={cn(
                'text-xs px-3 py-1 rounded-full border font-medium transition-colors',
                scopeFilter === f.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground bg-background'
              )}
            >
              {f.label}
            </button>
          ))}

          <button
            onClick={suggestIndicators}
            disabled={suggesting}
            className="ml-auto inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border border-purple-200 text-purple-600 bg-purple-50 hover:bg-purple-100 font-medium transition-colors disabled:opacity-50"
          >
            {suggesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {suggesting ? 'Analysing…' : `AI Suggest${activeEntity ? ` for ${activeEntity.label}` : ''}`}
          </button>
        </div>
      </div>

      {/* Main two-column layout */}
      <div className="grid grid-cols-3 gap-4 items-start">
        {/* Left: category groups */}
        <div className="col-span-2 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-12 bg-card border border-border rounded-xl">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : !hasSearchResults ? (
            <div className="py-12 text-center text-sm text-muted-foreground bg-card border border-border rounded-xl">
              No indicators match your search.
            </div>
          ) : (
            CATEGORIES.map(cat => {
              const catIndicators = filteredByCategory[cat] || [];
              if (catIndicators.length === 0) return null;
              return (
                <IndicatorCategoryGroup
                  key={cat}
                  category={cat}
                  indicators={catIndicators}
                  entities={entities}
                  selections={selections}
                  onToggle={toggle}
                  aiBadges={aiBadges}
                  onDismissAiBadge={dismissAiBadge}
                />
              );
            })
          )}
        </div>

        {/* Right: summary rail */}
        <div className="col-span-1">
          <SelectionSummaryRail
            entities={entities}
            selections={selections}
            totalIndicators={ALL_INDICATORS.length}
            reviewedCount={reviewedCount}
            allScores={allScores || {}}
            activeEntityKey={resolvedActiveKey}
            onActiveEntityChange={setActiveEntityKey}
            onConfirm={onConfirm}
          />
        </div>
      </div>
    </div>
  );
}