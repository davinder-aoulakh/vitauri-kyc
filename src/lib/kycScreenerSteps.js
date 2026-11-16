// KYC Screener run control. A run is done in short steps, each its own function call, because one long background job
// is ended by the platform without a trace. Pure: no I/O, runs in Deno and node.
//   steps: doc_reader -> screening (one call per party) -> rules -> export
//   run.progress = { step, party_index, parties[], screening_raw[], attempts, active, started_at, last_error, usage }
//   run.heartbeat_at is refreshed every 20 s while a step works; a step without a heartbeat for STEP_STALE_MS is dead.

export const STEPS = ['doc_reader', 'screening', 'rules', 'export'];
export const STEP_LABEL = { doc_reader: 'Reading documents', screening: 'Screening parties', rules: 'Applying the rules grid', export: 'Building Excel and PDF' };
export const HEARTBEAT_MS = 20 * 1000;
export const STEP_STALE_MS = 90 * 1000;
export const RUN_DEAD_MS = 20 * 60 * 1000;
export const MAX_STEP_ATTEMPTS = 2;
export const STEP_CALL_TIMEOUT_MS = 90 * 1000;
export const SCREEN_MAX_SEARCHES = 5;

const ms = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : 0; };

/** Last sign of life of a run. */
export function lastActivity(run) {
  return Math.max(ms(run?.heartbeat_at), ms(run?.progress?.started_at), ms(run?.updated_date), ms(run?.created_date), ms(run?.ran_at));
}

/** A step is marked active but its process gave no heartbeat for too long: it was ended by the platform. */
export function isStepStale(run, now = Date.now()) {
  const p = run?.progress;
  if (!p?.active) return false;
  return now - Math.max(ms(run.heartbeat_at), ms(p.started_at)) >= STEP_STALE_MS;
}

/** A running run nobody moved for a long time (panel closed, or a run from before the step runner). */
export function isRunDead(run, now = Date.now()) {
  return !!run && run.status === 'running' && now - lastActivity(run) >= RUN_DEAD_MS;
}

/**
 * What the next "advance" call must do.
 *   { action: 'none' }                       run is not running
 *   { action: 'wait', step }                 a step is working
 *   { action: 'run', step, attempt }         start (or retry) the step
 *   { action: 'skip_party', step, reason }   screening of one party failed twice: record it as not completed, go on
 *   { action: 'fail', step, reason }         give up with a clear reason
 */
export function planAdvance(run, now = Date.now()) {
  if (!run || run.status !== 'running') return { action: 'none' };
  const p = run.progress || {};
  const step = STEPS.includes(p.step) ? p.step : 'doc_reader';
  const attempts = Number(p.attempts) || 0;
  let died = '';
  if (p.active) {
    if (!isStepStale(run, now)) return { action: 'wait', step };
    const lived = Math.max(0, Math.round((Math.max(ms(run.heartbeat_at), ms(p.started_at)) - ms(p.started_at)) / 1000));
    died = `stopped without a result after about ${lived} s`;
  }
  if (attempts >= MAX_STEP_ATTEMPTS) {
    const why = died || p.last_error || 'no result';
    if (step === 'screening') return { action: 'skip_party', step, reason: why };
    return { action: 'fail', step, reason: `The step "${STEP_LABEL[step]}" did not finish (${why}; tried ${attempts} times). Run again.` };
  }
  return { action: 'run', step, attempt: attempts + 1 };
}

/** Progress after the screening of the current party ended (entry = Claude's result, or { failed: true } when it could not be completed). */
export function afterParty(progress, entry) {
  const list = progress.parties || [];
  const i = Number(progress.party_index) || 0;
  const party = list[i] || {};
  const raws = [...(progress.screening_raw || []).filter((x) => x.party_key !== party.key), { ...entry, party_key: party.key }];
  const last = i + 1 >= list.length;
  return { ...progress, screening_raw: raws, party_index: i + 1, step: last ? 'rules' : 'screening', attempts: 0, active: false, last_error: null };
}

/** Marks parties whose screening could not be completed. Never "no match": the result is inconclusive and says why. */
export function markIncomplete(screening, raws = []) {
  const failed = new Map(raws.filter((x) => x?.failed).map((x) => [x.party_key, x.error || 'not completed']));
  if (!failed.size) return screening;
  const check = (reason) => ({ result: 'inconclusive', matches: [], incomplete: true, note: `Screening could not be completed (${String(reason).slice(0, 160)}).` });
  return {
    ...screening,
    parties: (screening.parties || []).map((p) => (failed.has(p.party_key)
      ? { ...p, incomplete: true, checks: { sanctions: check(failed.get(p.party_key)), pep: check(failed.get(p.party_key)), adverse_media: check(failed.get(p.party_key)) } }
      : p)),
  };
}

/** Short text for the panel: where the run is. */
export function progressText(run) {
  const p = run?.progress || {};
  const step = STEPS.includes(p.step) ? p.step : (STEPS.includes(run?.stage) ? run.stage : 'doc_reader');
  if (step !== 'screening') return STEP_LABEL[step];
  const list = p.parties || [];
  const i = Math.min((Number(p.party_index) || 0) + 1, Math.max(list.length, 1));
  return list.length ? `Screening ${i} of ${list.length}: ${list[i - 1]?.name || ''}`.trim() : STEP_LABEL.screening;
}
