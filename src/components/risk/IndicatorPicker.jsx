/**
 * S-090: Risk Indicator Picker — redesigned
 * Category-grouped cards with inline entity toggles, live summary rail, AI badges.
 *
 * Props contract UNCHANGED: { client, relatedParties, selections, onChange, onConfirm, allScores }
 * ALL_INDICATORS export PRESERVED (backward-compat for IndicatorAssessment import).
 */
import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import { Sparkles, Loader2, Check, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRiskIndicators } from '@/hooks/useRiskIndicators';
import IndicatorCategoryGroup from '@/components/risk/IndicatorCategoryGroup';
import SelectionSummaryRail from '@/components/risk/SelectionSummaryRail';
import { useTenant } from '@/lib/tenantContext';

// ─── Static default library (PRESERVED — imported by IndicatorAssessment.jsx) ───
export const ALL_INDICATORS = [
  { id: 'geo',        name: 'High-Risk Geography',               description: 'Operating in a high-risk or non-cooperative jurisdiction (FATF grey/blacklist)',      applies: ['NP_Client','ORG_Client','NP_Related_Party','ORG_Related_Party'], category: 'Geography & Sector',                sort_order: 0  },
  { id: 'sector',     name: 'High-Risk Sector / Industry',       description: 'Operating in a high-risk sector (e.g. crypto, gambling, arms, adult)',                 applies: ['NP_Client','ORG_Client','NP_Related_Party','ORG_Related_Party'], category: 'Geography & Sector',                sort_order: 1  },
  { id: 'cash',       name: 'Cash-Intensive Business',           description: 'Primary operations involve large cash volumes or cash-equivalent transactions',         applies: ['ORG_Client'],                                                    category: 'Geography & Sector',                sort_order: 2  },
  { id: 'pep',        name: 'PEP Status',                        description: 'Client or related party is a Politically Exposed Person',                              applies: ['NP_Client','NP_Related_Party'],                                   category: 'PEP & Sanctions',                   sort_order: 3  },
  { id: 'sanctions',  name: 'Sanctions / Adverse Media',         description: 'Confirmed or possible match on sanctions, PEP or adverse media lists',                 applies: ['NP_Client','ORG_Client','NP_Related_Party','ORG_Related_Party'], category: 'PEP & Sanctions',                   sort_order: 4  },
  { id: 'pep_rp',     name: 'Politically Exposed Related Party', description: 'A UBO, director, or key related party is a PEP',                                       applies: ['NP_Client','ORG_Client','NP_Related_Party','ORG_Related_Party'], category: 'PEP & Sanctions',                   sort_order: 5  },
  { id: 'ownership',  name: 'Complex Ownership Structure',       description: 'Multi-layered, opaque, or nominee-based ownership arrangements',                       applies: ['ORG_Client','ORG_Related_Party'],                                 category: 'Ownership & Structure',             sort_order: 6  },
  { id: 'opaque',     name: 'Opaque Ownership / Nominee',        description: 'Use of nominee shareholders, bearer shares, or trusts obscuring beneficial ownership', applies: ['ORG_Client','ORG_Related_Party'],                                 category: 'Ownership & Structure',             sort_order: 7  },
  { id: 'txn',        name: 'Unusual Transaction Pattern',       description: 'Transactions inconsistent with stated purpose, profile, or expected behaviour',        applies: ['NP_Client','ORG_Client','NP_Related_Party','ORG_Related_Party'], category: 'Transaction & Financial Behaviour', sort_order: 8  },
  { id: 'sof',        name: 'Inconsistent SoF/SoW',              description: 'Source of funds or wealth cannot be adequately explained or documented',               applies: ['NP_Client','ORG_Client','NP_Related_Party','ORG_Related_Party'], category: 'Transaction & Financial Behaviour', sort_order: 9  },
  { id: 'nftf',       name: 'Non-Face-to-Face Relationship',     description: 'Client relationship established without in-person verification',                       applies: ['NP_Client','ORG_Client','NP_Related_Party','ORG_Related_Party'], category: 'Relationship & Onboarding',         sort_order: 10 },
  { id: 'introducer', name: 'Third-Party Introducer',            description: 'Client was introduced by a third party whose identity or integrity is uncertain',       applies: ['NP_Client','ORG_Client','NP_Related_Party','ORG_Related_Party'], category: 'Relationship & Onboarding',         sort_order: 11 },
];

const CATEGORIES = [
  'Geography & Sector',
  'PEP & Sanctions',
  'Ownership & Structure',
  'Transaction & Financial Behaviour',
  'Relationship & Onboarding',
];

export default function IndicatorPicker({ client, relatedParties, selections, onChange, onConfirm, allScores }) {
  const { tenant } = useTenant();
  const { byCategory, loading } = useRiskIndicators(tenant?.id);

  const [search, setSearch] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  // aiBadges: { [indicator_id]: { [entityKey]: { reason, dismissed } } }
  const [aiBadges, setAiBadges] = useState({});
  // Track which indicators have been reviewed (toggled at least once this session)
  const [reviewed, setReviewed] = useState(new Set());

  const entities = [
    { key: 'client', label: client?.full_name || 'Client', type: client?.client_type === 'ORG' ? 'ORG_Client' : 'NP_Client', data: client },
    ...(relatedParties || []).map(rp => ({
      key: `rp_${rp.id}`,
      label: rp.full_name,
      type: rp.party_type === 'ORG' ? 'ORG_Related_Party' : 'NP_Related_Party',
      data: rp,
    })),
  ];

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

  // Compute reviewed count: indicators with saved selections OR toggled this session
  const allIndicatorIds = ALL_INDICATORS.map(i => i.id);
  const reviewedCount = allIndicatorIds.filter(id => {
    const hasSaved = entities.some(e => (selections[e.key] || []).includes(id));
    return hasSaved || reviewed.has(id);
  }).length;

  const totalSelected = Object.values(selections).flat().length;

  // Filter indicators by search text
  const filteredByCategory = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return byCategory;
    const result = {};
    CATEGORIES.forEach(cat => {
      result[cat] = (byCategory[cat] || []).filter(ind =>
        ind.name.toLowerCase().includes(q) || ind.description.toLowerCase().includes(q)
      );
    });
    return result;
  }, [search, byCategory]);

  const hasSearchResults = CATEGORIES.some(cat => (filteredByCategory[cat] || []).length > 0);

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

      // Store badge
      if (!newBadges[s.indicator_id]) newBadges[s.indicator_id] = {};
      newBadges[s.indicator_id][matchedEntity.key] = { reason: s.reason, dismissed: false };

      // Auto-apply selection
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
      {/* Top bar */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-sm text-foreground">Risk Indicator Selection</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Toggle applicable indicators for each entity — grouped by risk category
          </p>
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
            {suggesting ? 'Analysing…' : 'AI Suggest'}
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

      {/* Search bar */}
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
          />
        </div>
      </div>
    </div>
  );
}