/**
 * useRiskIndicators — loads RiskIndicator records for a tenant, grouped by category.
 * Lazily seeds the 12 default indicators if none exist yet.
 */
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { ALL_INDICATORS } from '@/components/risk/IndicatorPicker';

const CATEGORIES = [
  'Geography & Sector',
  'PEP & Sanctions',
  'Ownership & Structure',
  'Transaction & Financial Behaviour',
  'Relationship & Onboarding',
];

export function useRiskIndicators(tenantId) {
  const [indicators, setIndicators] = useState([]);
  const [byCategory, setByCategory] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    load();
  }, [tenantId]);

  async function load() {
    setLoading(true);
    let records = await base44.entities.RiskIndicator.filter(
      { tenant_id: tenantId, is_active: true },
      'sort_order'
    );

    // Lazy seed: if no records yet, create defaults for this tenant
    if (!records || records.length === 0) {
      const seeds = ALL_INDICATORS.map((ind, i) => ({
        tenant_id: tenantId,
        name: ind.name,
        description: ind.description,
        applies_to: ind.applies,
        category: ind.category,
        sort_order: i,
        is_active: true,
        default_weight: 1.0,
        // Store the canonical id in the name lookup — use id as a stable identifier
        // We embed the indicator id as a prefix so IndicatorAssessment lookups still work
        _indicator_id: ind.id,
      }));
      // bulkCreate doesn't support custom id field so we store indicator_id in sort_order area;
      // instead, match by name in the hook output normalisation below
      await base44.entities.RiskIndicator.bulkCreate(seeds);
      records = await base44.entities.RiskIndicator.filter(
        { tenant_id: tenantId, is_active: true },
        'sort_order'
      );
    }

    // Normalise: map each DB record back to the canonical indicator id by matching name
    const nameToId = {};
    ALL_INDICATORS.forEach(ind => { nameToId[ind.name] = ind.id; });

    const normalised = (records || []).map(r => ({
      ...r,
      // id used for toggle state must be the canonical indicator id (geo, pep, etc.)
      indicator_id: nameToId[r.name] || r.id,
      applies: r.applies_to || [],
      category: r.category || 'Geography & Sector',
    }));

    // Group by category maintaining CATEGORIES order
    const grouped = {};
    CATEGORIES.forEach(cat => { grouped[cat] = []; });
    normalised.forEach(ind => {
      const cat = ind.category;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(ind);
    });

    setIndicators(normalised);
    setByCategory(grouped);
    setLoading(false);
  }

  return { indicators, byCategory, loading };
}