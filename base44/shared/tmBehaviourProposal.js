// Behaviour-score proposal threshold (phase 10). Pure: no I/O.
// Tenant setting tm_settings.behaviour_proposal_threshold (1-100; empty = off). When the behaviour component of the
// dynamic customer risk reaches it, a change-of-circumstances event proposes a risk review. Nothing changes the
// official risk class automatically.

function settingsOf(tenant) {
  const s = tenant?.tm_settings;
  if (!s) return {};
  if (typeof s === 'string') { try { return JSON.parse(s) || {}; } catch { return {}; } }
  return typeof s === 'object' ? s : {};
}

/** The threshold as a number between 1 and 100, or null when the setting is off or not usable. */
export function behaviourThreshold(tenant) {
  const raw = settingsOf(tenant).behaviour_proposal_threshold;
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : null;
}

export const reachesThreshold = (behaviourScore, threshold) => threshold !== null && Number.isFinite(Number(behaviourScore)) && Number(behaviourScore) >= threshold;

/** One proposal per customer per calendar month. */
export const behaviourDedupeKey = (clientId, at = new Date()) => `${clientId}:behaviour_score:${at.toISOString().slice(0, 7)}`;

export function behaviourFinding({ score, threshold, reasons, riskScoreId }) {
  return {
    before: {}, after: {
      behaviour_score: score, threshold, risk_score_id: riskScoreId || null,
      summary: `Behaviour score ${score} reached the tenant threshold of ${threshold}. ${(reasons || []).slice(0, 2).join(' ')}`.trim(),
    },
  };
}
