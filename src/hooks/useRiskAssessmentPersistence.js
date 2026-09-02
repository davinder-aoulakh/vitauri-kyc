/**
 * useRiskAssessmentPersistence
 *
 * Handles load + debounced auto-save for the Risk Assessment step.
 *
 * On mount: reads kycCase.risk_assessment_meta + queries RiskAssessment records
 * by case_id, reconstructing the full state.
 *
 * On change: debounce-saves (~800ms):
 *   - RiskAssessment records (upsert/delete) for per-indicator data
 *   - kycCase.risk_assessment_meta for everything else
 *
 * Entity key mapping:
 *   'client'    → entity_id = client_id,  entity_type = 'Client'
 *   'rp_<id>'  → entity_id = <id>,        entity_type = 'Related_Party'
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

function entityKeyToId(key, clientId) {
  if (key === 'client') return { entity_id: clientId, entity_type: 'Client' };
  const rpId = key.replace(/^rp_/, '');
  return { entity_id: rpId, entity_type: 'Related_Party' };
}

export function useRiskAssessmentPersistence({ kycCase, client }) {
  const caseId    = kycCase?.id;
  const tenantId  = kycCase?.tenant_id;
  const clientId  = client?.id;

  // ── Hydrated state ──────────────────────────────────────────────────
  const [selections, setSelections]               = useState({});
  const [selectionConfirmed, setSelectionConfirmed] = useState(false);
  const [allScores, setAllScores]                 = useState({});
  // meta extras
  const [narrativeAccepted, setNarrativeAccepted] = useState({});
  const [overallNarratives, setOverallNarratives] = useState({});
  const [entityOverrides, setEntityOverrides]     = useState({});
  const [consolidatedOverride, setConsolidatedOverride] = useState(null);

  const [loading, setLoading] = useState(true);

  // internal: track existing RiskAssessment record ids for upsert
  // shape: { entityKey: { indicatorId: recordId } }
  const recordIdsRef = useRef({});

  // ── Load on mount ────────────────────────────────────────────────────
  useEffect(() => {
    if (!caseId || !clientId) { setLoading(false); return; }
    load();
  }, [caseId, clientId]);

  async function load() {
    setLoading(true);
    try {
      // 1. Load meta from kycCase
      const meta = kycCase?.risk_assessment_meta || {};
      if (meta.selections)          setSelections(meta.selections);
      if (meta.selectionConfirmed)  setSelectionConfirmed(!!meta.selectionConfirmed);
      if (meta.narrativeAccepted)   setNarrativeAccepted(meta.narrativeAccepted);
      if (meta.overallNarratives)   setOverallNarratives(meta.overallNarratives);
      if (meta.entityOverrides)     setEntityOverrides(meta.entityOverrides);
      if (meta.consolidatedOverride) setConsolidatedOverride(meta.consolidatedOverride);

      // 2. Load RiskAssessment records
      const records = await base44.entities.RiskAssessment.filter({ case_id: caseId });
      const scores  = {};
      const ids     = {};

      (records || []).forEach(r => {
        // map entity_id + entity_type back to entityKey
        const entityKey = r.entity_type === 'Client' ? 'client' : `rp_${r.entity_id}`;
        if (!scores[entityKey]) scores[entityKey] = {};
        if (!ids[entityKey])    ids[entityKey]    = {};
        scores[entityKey][r.indicator_id] = {
          score:               r.score,
          notes:               r.analyst_narrative || '',
          ai_narrative:        r.ai_narrative || '',
          evidence_document_ids: r.evidence_document_ids || [],
        };
        ids[entityKey][r.indicator_id] = r.id;
      });

      if (Object.keys(scores).length > 0) setAllScores(scores);
      recordIdsRef.current = ids;
    } finally {
      setLoading(false);
    }
  }

  // ── Debounce helpers ─────────────────────────────────────────────────
  const metaTimerRef      = useRef(null);
  const indicatorTimerRef = useRef(null);

  const saveMeta = useCallback((meta) => {
    if (!caseId) return;
    clearTimeout(metaTimerRef.current);
    metaTimerRef.current = setTimeout(async () => {
      await base44.entities.KycCase.update(caseId, { risk_assessment_meta: meta });
    }, 800);
  }, [caseId]);

  // ── Public setters that also trigger saves ───────────────────────────

  function updateSelections(next) {
    setSelections(next);
    saveMeta(buildMeta({ selections: next }));
  }

  function updateSelectionConfirmed(next) {
    setSelectionConfirmed(next);
    saveMeta(buildMeta({ selectionConfirmed: next }));
  }

  function updateNarrativeAccepted(next) {
    setNarrativeAccepted(next);
    saveMeta(buildMeta({ narrativeAccepted: next }));
  }

  function updateOverallNarratives(next) {
    setOverallNarratives(next);
    saveMeta(buildMeta({ overallNarratives: next }));
  }

  function updateEntityOverrides(next) {
    setEntityOverrides(next);
    saveMeta(buildMeta({ entityOverrides: next }));
  }

  function updateConsolidatedOverride(next) {
    setConsolidatedOverride(next);
    saveMeta(buildMeta({ consolidatedOverride: next }));
  }

  // Build meta snapshot using latest state + any override field
  // We use a ref-based snapshot approach to avoid stale closure issues
  const latestRef = useRef({});
  useEffect(() => {
    latestRef.current = {
      selections, selectionConfirmed, narrativeAccepted,
      overallNarratives, entityOverrides, consolidatedOverride,
    };
  });

  function buildMeta(overrides = {}) {
    return { ...latestRef.current, ...overrides };
  }

  // ── Per-indicator score update + upsert ──────────────────────────────
  function updateAllScores(entityKey, indicatorId, patch) {
    // patch = { score, notes, ai_narrative, evidence_document_ids }
    // patch = null means delete this indicator record
    setAllScores(prev => {
      const entityScores = { ...(prev[entityKey] || {}) };
      if (patch === null) {
        delete entityScores[indicatorId];
      } else {
        entityScores[indicatorId] = { ...(entityScores[indicatorId] || {}), ...patch };
      }
      return { ...prev, [entityKey]: entityScores };
    });

    clearTimeout(indicatorTimerRef.current);
    indicatorTimerRef.current = setTimeout(() => {
      upsertIndicatorRecord(entityKey, indicatorId, patch);
    }, 800);
  }

  async function upsertIndicatorRecord(entityKey, indicatorId, patch) {
    if (!caseId || !tenantId || !clientId) return;
    const { entity_id, entity_type } = entityKeyToId(entityKey, clientId);
    const existingId = recordIdsRef.current[entityKey]?.[indicatorId];

    if (patch === null || !patch?.score) {
      // Delete record if it exists
      if (existingId) {
        await base44.entities.RiskAssessment.delete(existingId);
        const ids = { ...recordIdsRef.current };
        if (ids[entityKey]) { delete ids[entityKey][indicatorId]; }
        recordIdsRef.current = ids;
      }
      return;
    }

    const data = {
      tenant_id:             tenantId,
      case_id:               caseId,
      entity_id,
      entity_type,
      entity_name:           entityKey === 'client' ? client?.full_name : entity_id,
      indicator_id:          indicatorId,
      score:                 patch.score,
      analyst_narrative:     patch.notes || '',
      ai_narrative:          patch.ai_narrative || '',
      evidence_document_ids: patch.evidence_document_ids || [],
    };

    if (existingId) {
      await base44.entities.RiskAssessment.update(existingId, data);
    } else {
      const created = await base44.entities.RiskAssessment.create(data);
      recordIdsRef.current = {
        ...recordIdsRef.current,
        [entityKey]: { ...(recordIdsRef.current[entityKey] || {}), [indicatorId]: created.id },
      };
    }
  }

  // ── Override allScores setter (used by RiskAssessmentStep for bulk changes) ──
  function setAllScoresFull(entityKey, scores) {
    setAllScores(prev => ({ ...prev, [entityKey]: scores }));
    // Upsert/delete each indicator
    clearTimeout(indicatorTimerRef.current);
    indicatorTimerRef.current = setTimeout(async () => {
      const indicatorIds = Object.keys(scores).filter(k => k !== '__override');
      for (const indicatorId of indicatorIds) {
        const patch = scores[indicatorId];
        await upsertIndicatorRecord(entityKey, indicatorId, patch?.score ? patch : null);
      }
      // Handle __override separately (not a RiskAssessment record)
      if (scores.__override) {
        const next = { ...latestRef.current.entityOverrides, [entityKey]: scores.__override };
        setEntityOverrides(next);
        saveMeta(buildMeta({ entityOverrides: next }));
      }
    }, 800);
  }

  // Delete orphaned RiskAssessment records when selections change
  async function cleanupOrphanedRecords(entityKey, selectedIndicatorIds) {
    const existing = recordIdsRef.current[entityKey] || {};
    const orphaned = Object.keys(existing).filter(id => !selectedIndicatorIds.includes(id));
    for (const indicatorId of orphaned) {
      await upsertIndicatorRecord(entityKey, indicatorId, null);
    }
  }

  return {
    loading,
    // State
    selections, selectionConfirmed,
    allScores,
    narrativeAccepted, overallNarratives, entityOverrides, consolidatedOverride,
    // Setters
    updateSelections, updateSelectionConfirmed,
    updateAllScores, setAllScoresFull,
    updateNarrativeAccepted, updateOverallNarratives,
    updateEntityOverrides, updateConsolidatedOverride,
    cleanupOrphanedRecords,
  };
}