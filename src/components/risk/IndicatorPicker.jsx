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
import InlineError from '@/components/shared/InlineError';
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

export default function IndicatorPicker({ client, relatedParties, selections, onChange, onConfirm, allScores, caseId }) {
  const { tenant } = useTenant();
  const { indicators, byCategory, loading, error, reload } = useRiskIndicators(tenant?.id);
  const [signalsUsed, setSignalsUsed] = useState(null);

  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState('All');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState(null);
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
  const filteredCount = CATEGORIES.reduce((sum, cat) => sum + (filteredByCategory[cat]?.length || 0), 0);
  const isFiltering = search.trim().length > 0 || scopeFilter !== 'All';

  // Active entity for AI suggest label
  const activeEntity = entities.find(e => e.key === resolvedActiveKey) || entities[0];

  async function suggestIndicators() {
    setSuggesting(true);
    setSuggestError(null);
    setAiBadges({});

    try {
      if (!caseId) throw new Error('Case not loaded yet — please try again.');
      // The tenant's active indicators, keyed by the canonical id the picker uses
      const indicatorList = [...new Map((indicators?.length ? indicators : ALL_INDICATORS.map(i => ({ ...i, indicator_id: i.id })))
        .map(i => [i.indicator_id, { id: i.indicator_id, name: i.name, description: i.description || '', applies: i.applies || [] }])).values()];

      // Reads outreach answers, screening, stored Didit AML, SoF and OSINT server-side, applies fixed rules, then AI
      const res = await Promise.race([
        base44.functions.invoke('suggestRiskIndicators', { case_id: caseId, indicators: indicatorList }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI Suggest timed out — please try again.')), 90000)),
      ]);
      const result = res?.data;
      if (!result?.ok) throw new Error(result?.error || 'AI Suggest failed — please try again.');
      setSignalsUsed({ ...(result.signals_used || {}), ai_failed: !!result.ai_failed, count: result.suggestions?.length || 0 });
      if (!result.suggestions?.length) return;

      const newBadges = {};
      const newSelections = { ...selections };

      result.suggestions.forEach(s => {
        const matchedEntity = entities.find(e => e.key === s.entity_key);
        if (!matchedEntity || !s.indicator_id) return;

        if (!newBadges[s.indicator_id]) newBadges[s.indicator_id] = {};
        newBadges[s.indicator_id][matchedEntity.key] = { reason: s.reason, evidence: s.evidence, origin: s.origin, dismissed: false };

        const current = newSelections[matchedEntity.key] || [];
        if (!current.includes(s.indicator_id)) {
          newSelections[matchedEntity.key] = [...current, s.indicator_id];
        }
      });

      setAiBadges(newBadges);
      onChange(newSelections);
    } catch (err) {
      console.error('suggestIndicators error:', err);
      setSuggestError(err?.response?.data?.error || err?.message || 'AI Suggest failed — please try again.');
    } finally {
      setSuggesting(false);
    }
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

        {isFiltering && (
          <div className="text-xs text-muted-foreground px-1">
            Showing <span className="font-semibold text-foreground">{filteredCount}</span> of {ALL_INDICATORS.length} indicators
          </div>
        )}

        {suggestError && (
          <InlineError message={suggestError} onRetry={suggestIndicators} />
        )}

        {signalsUsed && !suggesting && (
          <div className="text-xs text-muted-foreground px-1">
            {signalsUsed.count > 0 ? `${signalsUsed.count} suggestion(s). ` : 'No indicators are supported by the case data. '}
            Considered: {signalsUsed.outreach_answers || 0} outreach answer(s) · {signalsUsed.screening_hits || 0} screening hit(s)
            {signalsUsed.didit_aml ? ' · Didit AML' : ''}{signalsUsed.sof ? ' · SoF/SoW' : ''}{signalsUsed.osint ? ' · OSINT' : ''}
            {signalsUsed.ai_failed && <span className="text-amber-600"> · AI unavailable, fixed rules only</span>}
          </div>
        )}
      </div>

      {/* Main two-column layout */}
      <div className="grid grid-cols-3 gap-4 items-start">
        {/* Left: category groups */}
        <div className="col-span-2 space-y-3">
          {error ? (
            <InlineError message={error} onRetry={reload} />
          ) : loading ? (
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