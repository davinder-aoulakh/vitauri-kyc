/**
 * useRiskIndicators — loads RiskIndicator records for a tenant, grouped by category.
 * Uses canonical ALL_INDICATORS as source of truth for indicator_id and category.
 * Seeds any missing canonical indicators if the full 12 aren't present.
 */
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { ALL_INDICATORS } from '@/lib/riskIndicatorLibrary';

const CATEGORIES = [
  'Geography & Sector',
  'PEP & Sanctions',
  'Ownership & Structure',
  'Transaction & Financial Behaviour',
  'Relationship & Onboarding',
];

// Normalise name for robust matching: lowercase, strip non-alphanumeric except spaces
function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// Build lookup: normalised name → canonical indicator
const NORM_LOOKUP = {};
ALL_INDICATORS.forEach(ind => { NORM_LOOKUP[norm(ind.name)] = ind; });

function matchCanonical(dbRecord) {
  const n = norm(dbRecord.name);
  // Exact normalised match
  if (NORM_LOOKUP[n]) return NORM_LOOKUP[n];
  // Partial: first + last word match
  const words = n.split(' ');
  const first = words[0];
  const last = words[words.length - 1];
  return Object.values(NORM_LOOKUP).find(ind => {
    const indN = norm(ind.name);
    return indN.includes(first) && indN.includes(last);
  }) || null;
}

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

    // Seed ALL missing canonical indicators (not just when empty)
    const existingNormNames = new Set((records || []).map(r => norm(r.name)));
    const missing = ALL_INDICATORS.filter(ind => {
      if (existingNormNames.has(norm(ind.name))) return false;
      // Also check partial match
      const words = norm(ind.name).split(' ');
      return !Array.from(existingNormNames).some(en =>
        en.includes(words[0]) && en.includes(words[words.length - 1])
      );
    });

    if (missing.length > 0) {
      await base44.entities.RiskIndicator.bulkCreate(
        missing.map((ind, i) => ({
          tenant_id: tenantId,
          name: ind.name,
          description: ind.description,
          applies_to: ind.applies,
          category: ind.category,
          sort_order: (records?.length || 0) + i,
          is_active: true,
          default_weight: 1.0,
        }))
      );
      records = await base44.entities.RiskIndicator.filter(
        { tenant_id: tenantId, is_active: true },
        'sort_order'
      );
    }

    // Normalise each DB record to canonical indicator_id and category
    const normalised = (records || []).map(r => {
      const canonical = matchCanonical(r);
      return {
        ...r,
        indicator_id: canonical ? canonical.id : r.id,
        applies: canonical ? canonical.applies : (r.applies_to || []),
        category: canonical ? canonical.category : (r.category || 'Geography & Sector'),
      };
    });

    // Group by category in CATEGORIES order
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