// Risk Assessment autosave — pure parts (used by src/hooks/useRiskAssessmentPersistence.js; node-testable).
//  - createWriteQueue: pending writes keyed per item (a later patch for the same key wins, different keys are all kept),
//    written one after another, with flush() for the moment the step or the page is left and a retry after a failure;
//  - repairSelections: indicators that have a saved score are always part of the selection;
//  - deselectedIds:    what the user actually removed in one change (only those records may be cleaned up).

/**
 * deps: { write(key, value) -> Promise, delay, onState({ pending, saving, error }) }
 * value may be anything, including null (the caller decides what null means, e.g. "delete").
 */
export function createWriteQueue({ write, delay = 500, onState, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const pending = new Map();
  let timer = null;
  let chain = Promise.resolve();
  let saving = 0;
  let error = null;
  const report = () => onState?.({ pending: pending.size, saving, error });

  function run() {
    clearTimer(timer);
    timer = null;
    chain = chain.then(async () => {
      // Take a snapshot; changes made while writing are queued for the next run.
      const batch = [...pending.entries()];
      pending.clear();
      if (!batch.length) return;
      saving += batch.length;
      report();
      for (const [key, value] of batch) {
        try {
          await write(key, value);
          error = null;
        } catch (e) {
          error = e?.message || 'save failed';
          // Keep it for the next attempt unless a newer value for the same key arrived meanwhile.
          if (!pending.has(key)) pending.set(key, value);
        } finally {
          saving -= 1;
          report();
        }
      }
    });
    return chain;
  }

  return {
    schedule(key, value) {
      pending.set(key, value);
      report();
      clearTimer(timer);
      timer = setTimer(run, delay);
    },
    flush: () => run(),
    idle: () => pending.size === 0 && saving === 0,
    cancelTimer() { clearTimer(timer); timer = null; },
  };
}

/**
 * selections: { entityKey: [indicatorId] }, scores: { entityKey: { indicatorId: { score } } }.
 * Adds every scored indicator that is missing from the selection. Returns { selections, changed }.
 */
export function repairSelections(selections, scores) {
  const out = { ...(selections || {}) };
  let changed = false;
  for (const [entityKey, byIndicator] of Object.entries(scores || {})) {
    const have = new Set(out[entityKey] || []);
    for (const [indicatorId, data] of Object.entries(byIndicator || {})) {
      if (indicatorId === '__override' || !data?.score || have.has(indicatorId)) continue;
      have.add(indicatorId);
      changed = true;
    }
    if (changed || out[entityKey]) out[entityKey] = [...have];
  }
  return { selections: out, changed };
}

/** { entityKey: [indicatorId] } removed going from prev to next. */
export function deselectedIds(prev, next) {
  const out = {};
  for (const [entityKey, ids] of Object.entries(prev || {})) {
    const now = new Set(next?.[entityKey] || []);
    const gone = (ids || []).filter((id) => !now.has(id));
    if (gone.length) out[entityKey] = gone;
  }
  return out;
}
