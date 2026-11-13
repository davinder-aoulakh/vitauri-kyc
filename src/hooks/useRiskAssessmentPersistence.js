/**
 * useRiskAssessmentPersistence
 *
 * Load + autosave for the Risk Assessment step.
 *
 * On mount: reads the case's risk_assessment_meta FROM THE DATABASE (the workspace's in-memory case can be stale) and the
 * RiskAssessment records of the case, and rebuilds the full state. Indicators that have a saved score are always part of
 * the selection (self-repair).
 *
 * On change (debounced ~500 ms, flushed when the step or the page is left):
 *   - RiskAssessment records (upsert/delete) for per-indicator data — one queue entry per indicator, written in order;
 *   - KycCase.risk_assessment_meta for everything else; the saved meta is handed back to the workspace (onCaseUpdate).
 *
 * Entity key mapping:
 *   'client'    → entity_id = client_id,  entity_type = 'Client'
 *   'rp_<id>'  → entity_id = <id>,        entity_type = 'Related_Party'
 */
import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from '@/components/ui/use-toast';
import { createWriteQueue, repairSelections } from '@/lib/riskAutosave';

function entityKeyToId(key, clientId) {
  if (key === 'client') return { entity_id: clientId, entity_type: 'Client' };
  const rpId = key.replace(/^rp_/, '');
  return { entity_id: rpId, entity_type: 'Related_Party' };
}

const META_KEY = '__meta__';

export function useRiskAssessmentPersistence({ kycCase, client, tmSignalRefs = null, onCaseUpdate = null }) {
  // null/undefined = TM signals not in use → tm_signal_refs is not written at all
  const tmRefsRef = useRef(tmSignalRefs);
  tmRefsRef.current = tmSignalRefs;
  const [savedTmSignalRefs, setSavedTmSignalRefs] = useState([]);
  const caseId    = kycCase?.id;
  const tenantId  = kycCase?.tenant_id;
  const clientId  = client?.id;
  const ctxRef = useRef({});
  ctxRef.current = { caseId, tenantId, clientId, clientName: client?.full_name, onCaseUpdate };

  // ── Hydrated state ──────────────────────────────────────────────────
  const [selections, setSelections]               = useState({});
  const [selectionConfirmed, setSelectionConfirmed] = useState(false);
  const [allScores, setAllScores]                 = useState({});
  // meta extras
  const [narrativeAccepted, setNarrativeAccepted] = useState({});
  const [overallNarratives, setOverallNarratives] = useState({});
  const [entityOverrides, setEntityOverrides]     = useState({});
  const [consolidatedOverride, setConsolidatedOverride] = useState(null);
  // AI score proposals and what the analyst did with them: { entityKey: { indicatorId: proposal } }
  const [scoreProposals, setScoreProposals] = useState({});

  const [loading, setLoading] = useState(true);
  // Save status for the UI: 'saved' | 'saving' | 'error'
  const [saveState, setSaveState] = useState('saved');
  const [lastSavedAt, setLastSavedAt] = useState(null);

  // internal: track existing RiskAssessment record ids for upsert
  // shape: { entityKey: { indicatorId: recordId } }
  const recordIdsRef = useRef({});

  // Latest meta, updated synchronously by every setter (a render-time copy would lose two changes made in one tick).
  const latestRef = useRef({
    selections: {}, selectionConfirmed: false, narrativeAccepted: {}, overallNarratives: {}, entityOverrides: {}, consolidatedOverride: null, scoreProposals: {},
  });
  // Latest scores per entity/indicator, so a patch can be merged without waiting for a render.
  const scoresRef = useRef({});

  // ── One write queue for meta and indicator records ───────────────────
  const errorShownRef = useRef(false);
  const queueRef = useRef(null);
  if (!queueRef.current) {
    queueRef.current = createWriteQueue({
      delay: 500,
      write: async (key, value) => {
        if (key === META_KEY) {
          const { caseId: id, onCaseUpdate: notify } = ctxRef.current;
          if (!id) return;
          await base44.entities.KycCase.update(id, { risk_assessment_meta: value });
          notify?.(prev => (prev ? { ...prev, risk_assessment_meta: value } : prev));
          return;
        }
        const [entityKey, indicatorId] = key.split('|');
        await upsertIndicatorRecord(entityKey, indicatorId, value);
      },
      onState: ({ pending, saving, error }) => {
        if (error) {
          setSaveState('error');
          if (!errorShownRef.current) {
            errorShownRef.current = true;
            toast({ variant: 'destructive', title: 'Risk assessment not saved', description: 'Your changes are kept on this screen and will be saved again on your next change.' });
          }
        } else if (pending || saving) {
          setSaveState('saving');
        } else {
          errorShownRef.current = false;
          setSaveState('saved');
          setLastSavedAt(new Date());
        }
      },
    });
  }

  // ── Load on mount ────────────────────────────────────────────────────
  useEffect(() => {
    if (!caseId || !clientId) { setLoading(false); return; }
    load();
  }, [caseId, clientId]);

  // ── Flush when the step is left, the tab is hidden or the page closes ──
  useEffect(() => {
    const flush = () => { queueRef.current?.flush(); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  async function load() {
    setLoading(true);
    try {
      // 1. Meta: fresh from the database; the prop is only the fallback when that read fails.
      let meta = kycCase?.risk_assessment_meta || {};
      try {
        const fresh = await base44.entities.KycCase.filter({ id: caseId });
        if (fresh?.[0]) meta = fresh[0].risk_assessment_meta || {};
      } catch { /* keep the prop */ }

      // 2. RiskAssessment records
      const records = await base44.entities.RiskAssessment.filter({ case_id: caseId });
      const scores  = {};
      const ids     = {};

      setSavedTmSignalRefs([...new Set((records || []).flatMap(r => r.tm_signal_refs || []))]);

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

      // 3. Self-repair: an indicator with a saved score is selected; scored work means the selection was confirmed.
      const repaired = repairSelections(meta.selections || {}, scores);
      const hasScores = Object.values(scores).some(s => Object.keys(s).length > 0);
      const confirmed = !!meta.selectionConfirmed || hasScores;
      const next = {
        selections: repaired.selections,
        selectionConfirmed: confirmed,
        narrativeAccepted: meta.narrativeAccepted || {},
        overallNarratives: meta.overallNarratives || {},
        entityOverrides: meta.entityOverrides || {},
        consolidatedOverride: meta.consolidatedOverride || null,
        scoreProposals: meta.scoreProposals || {},
      };
      latestRef.current = next;
      scoresRef.current = scores;
      recordIdsRef.current = ids;

      setSelections(next.selections);
      setSelectionConfirmed(next.selectionConfirmed);
      setNarrativeAccepted(next.narrativeAccepted);
      setOverallNarratives(next.overallNarratives);
      setEntityOverrides(next.entityOverrides);
      setConsolidatedOverride(next.consolidatedOverride);
      setScoreProposals(next.scoreProposals);
      setAllScores(scores);

      if (repaired.changed || confirmed !== !!meta.selectionConfirmed) queueRef.current.schedule(META_KEY, { ...next });
      else ctxRef.current.onCaseUpdate?.(prev => (prev ? { ...prev, risk_assessment_meta: { ...next } } : prev));
    } finally {
      setLoading(false);
    }
  }

  // ── Meta: public setters that also save ──────────────────────────────
  function setMeta(patch) {
    latestRef.current = { ...latestRef.current, ...patch };
    queueRef.current.schedule(META_KEY, { ...latestRef.current });
  }

  function updateSelections(next) { setSelections(next); setMeta({ selections: next }); }
  function updateSelectionConfirmed(next) { setSelectionConfirmed(next); setMeta({ selectionConfirmed: next }); }
  function updateNarrativeAccepted(next) { setNarrativeAccepted(next); setMeta({ narrativeAccepted: next }); }
  function updateOverallNarratives(next) { setOverallNarratives(next); setMeta({ overallNarratives: next }); }
  function updateEntityOverrides(next) { setEntityOverrides(next); setMeta({ entityOverrides: next }); }
  function updateConsolidatedOverride(next) { setConsolidatedOverride(next); setMeta({ consolidatedOverride: next }); }
  /** next: full map, or an updater (prev) => map. Uses the latest saved value, so quick successive decisions all count. */
  function updateScoreProposals(next) {
    const value = typeof next === 'function' ? next(latestRef.current.scoreProposals || {}) : next;
    setScoreProposals(value);
    setMeta({ scoreProposals: value });
  }

  // ── Per-indicator score update + upsert ──────────────────────────────
  function updateAllScores(entityKey, indicatorId, patch) {
    // patch = { score, notes, ai_narrative, evidence_document_ids }
    // patch = null means delete this indicator record
    const entityScores = { ...(scoresRef.current[entityKey] || {}) };
    // Nothing to do: callers pass every indicator of the entity on each change; only the changed ones are written.
    const before = entityScores[indicatorId];
    if (patch === null && !before && !recordIdsRef.current[entityKey]?.[indicatorId]) return;
    if (patch !== null && before && JSON.stringify({ ...before, ...patch }) === JSON.stringify(before)) return;
    if (patch === null) delete entityScores[indicatorId];
    else entityScores[indicatorId] = { ...(entityScores[indicatorId] || {}), ...patch };
    scoresRef.current = { ...scoresRef.current, [entityKey]: entityScores };
    setAllScores(scoresRef.current);
    // One queue entry per indicator: indicators never cancel each other's save.
    queueRef.current.schedule(`${entityKey}|${indicatorId}`, patch === null ? null : entityScores[indicatorId]);
  }

  async function upsertIndicatorRecord(entityKey, indicatorId, patch) {
    const { caseId: cId, tenantId: tId, clientId: clId, clientName } = ctxRef.current;
    if (!cId || !tId || !clId) return;
    const { entity_id, entity_type } = entityKeyToId(entityKey, clId);
    const existingId = recordIdsRef.current[entityKey]?.[indicatorId];

    if (patch === null || !patch?.score) {
      // Delete record if it exists
      if (existingId) {
        await base44.entities.RiskAssessment.delete(existingId);
        const ids = { ...recordIdsRef.current };
        if (ids[entityKey]) { ids[entityKey] = { ...ids[entityKey] }; delete ids[entityKey][indicatorId]; }
        recordIdsRef.current = ids;
      }
      return;
    }

    const data = {
      tenant_id:             tId,
      case_id:               cId,
      entity_id,
      entity_type,
      entity_name:           entityKey === 'client' ? clientName : entity_id,
      indicator_id:          indicatorId,
      score:                 patch.score,
      analyst_narrative:     patch.notes || '',
      ai_narrative:          patch.ai_narrative || '',
      evidence_document_ids: patch.evidence_document_ids || [],
      ...(Array.isArray(tmRefsRef.current) ? { tm_signal_refs: tmRefsRef.current } : {}),
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
    const { __override, ...indicatorScores } = scores || {};
    scoresRef.current = { ...scoresRef.current, [entityKey]: indicatorScores };
    setAllScores(prev => ({ ...prev, [entityKey]: scores }));
    for (const [indicatorId, patch] of Object.entries(indicatorScores)) {
      queueRef.current.schedule(`${entityKey}|${indicatorId}`, patch?.score ? patch : null);
    }
    // __override is not a RiskAssessment record: it lives in the meta
    if (__override) {
      const next = { ...latestRef.current.entityOverrides, [entityKey]: __override };
      setEntityOverrides(next);
      setMeta({ entityOverrides: next });
    }
  }

  // Delete the records of indicators that are no longer selected for an entity
  async function cleanupOrphanedRecords(entityKey, selectedIndicatorIds) {
    const existing = recordIdsRef.current[entityKey] || {};
    const orphaned = Object.keys(existing).filter(id => !selectedIndicatorIds.includes(id));
    for (const indicatorId of orphaned) updateAllScores(entityKey, indicatorId, null);
  }

  /** Remove the records of exactly these indicators (the ones the user just de-selected). */
  function removeIndicatorRecords(entityKey, indicatorIds) {
    for (const indicatorId of indicatorIds || []) {
      if (scoresRef.current[entityKey]?.[indicatorId] || recordIdsRef.current[entityKey]?.[indicatorId]) updateAllScores(entityKey, indicatorId, null);
    }
  }

  return {
    loading,
    savedTmSignalRefs,
    saveState, lastSavedAt,
    flushSaves: () => queueRef.current.flush(),
    // State
    selections, selectionConfirmed,
    allScores,
    narrativeAccepted, overallNarratives, entityOverrides, consolidatedOverride, scoreProposals,
    // Setters
    updateSelections, updateSelectionConfirmed,
    updateAllScores, setAllScoresFull,
    updateNarrativeAccepted, updateOverallNarratives,
    updateEntityOverrides, updateConsolidatedOverride, updateScoreProposals,
    cleanupOrphanedRecords, removeIndicatorRecords,
  };
}
