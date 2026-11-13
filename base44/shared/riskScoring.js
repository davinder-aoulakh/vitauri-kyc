// riskScoring — fixed minimum scores and clean-up of AI score proposals for the Risk Assessment. Pure; runs in Deno and node.
// The AI proposes, the analyst decides. Hard facts set a MINIMUM here so an obvious risk never depends on the model.
export const SCORES = ['Low', 'Medium', 'High', 'Unacceptable'];
const RANK = { Low: 1, Medium: 2, High: 3, Unacceptable: 4 };
export const higherScore = (a, b) => (!a ? b || null : !b ? a : RANK[a] >= RANK[b] ? a : b);

// What an indicator is about, from its canonical id or (tenant-defined indicators) its name.
const TOPIC = [
  ['sanctions', /^sanctions$|sanction|adverse|screening hit/i],
  ['pep', /^pep(_rp)?$|\bpep\b|politically exposed/i],
  ['sof', /^sof$|source of (funds|wealth)|herkomst/i],
  ['cash', /^cash$|\bcash\b|contant/i],
  ['sector', /^sector$|sector|industry|business activit|high-risk activit/i],
];
export function topicOf(indicator) {
  const id = String(indicator?.id || '');
  const hay = `${id} ${indicator?.name || ''}`;
  return (TOPIC.find(([t, re]) => id === t || re.test(hay)) || [null])[0];
}

const SECTOR_TERMS = /crypto|bitcoin|virtual asset|digital asset|cryptovaluta|gambl|casino|betting|kansspel|gokken|porn|adult entertainment|adult content|weapon|arms|firearm|wapen/i;
const NOT_ADEQUATE = /not adequate|inadequate|niet (toereikend|adequaat)/i;

/**
 * Minimum score per indicator for ONE entity. entity: { key, facts: [{ kind, text, source, ... }] } from collectSignals.
 * Returns { [indicatorId]: { score, reason, evidence } }.
 */
export function scoreFloors(entity, indicators) {
  const out = {};
  const facts = entity?.facts || [];
  const raise = (ind, score, reason, f) => {
    const cur = out[ind.id];
    if (!cur || RANK[score] > RANK[cur.score]) out[ind.id] = { score, reason, evidence: f ? `${f.source} — ${f.text}` : '' };
  };
  for (const ind of indicators || []) {
    const topic = topicOf(ind);
    if (!topic) continue;
    for (const f of facts) {
      if (topic === 'sanctions') {
        if (f.kind === 'screening_sanctions' && f.confirmed) raise(ind, 'Unacceptable', 'Confirmed sanctions match.', f);
        else if (f.kind === 'screening_adverse' && f.confirmed) raise(ind, 'High', 'Confirmed adverse media match.', f);
        else if (['screening_sanctions', 'screening_adverse'].includes(f.kind)) raise(ind, 'Medium', 'Open screening hit: decide it in Screening first.', f);
        else if (f.kind === 'didit_aml' && f.aml_hits > 0 && (f.confirmed || (f.aml_status && !/approved/i.test(f.aml_status)))) raise(ind, 'Medium', 'Didit AML reported possible matches that are not cleared.', f);
        else if (f.kind === 'osint_adverse' && f.confirmed) raise(ind, 'High', 'Confirmed adverse information from OSINT.', f);
      }
      if (topic === 'pep') {
        if (f.kind === 'screening_pep' && f.confirmed) raise(ind, 'High', 'Confirmed PEP match.', f);
        else if (f.kind === 'pep_declared' && f.pep_yes) raise(ind, 'High', 'PEP status declared by the client.', f);
        else if (f.kind === 'screening_pep') raise(ind, 'Medium', 'Open PEP hit: decide it in Screening first.', f);
      }
      if (topic === 'sof' && f.kind === 'sof_assessment' && NOT_ADEQUATE.test(f.adequacy || '')) raise(ind, 'High', 'Source of funds / wealth assessed as not adequate.', f);
      if (topic === 'sector' && f.kind === 'activities' && SECTOR_TERMS.test(f.text)) raise(ind, 'Medium', 'Declared high-risk activity.', f);
      if (topic === 'cash' && f.kind === 'txn_analysis' && Number(f.cash_share) >= 0.3) raise(ind, 'Medium', 'Cash is 30% or more of inbound funds.', f);
    }
    // No SoF assessment at all on the client: the indicator cannot be Low.
    if (topic === 'sof' && entity?.key === 'client' && !facts.some((f) => f.kind === 'sof_assessment' || f.kind === 'sof')) {
      raise(ind, 'Medium', 'No source of funds information on file.', null);
    }
  }
  return out;
}

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * AI proposals (raw) + floors -> clean proposals, one per requested indicator.
 * A proposal without evidence gets no score ("no basis in the file"); a floor is always applied.
 */
export function buildProposals(indicators, raw, floors, meta = {}) {
  const byId = new Map((raw || []).filter((p) => p && p.indicator_id).map((p) => [String(p.indicator_id), p]));
  return (indicators || []).map((ind) => {
    const p = byId.get(ind.id) || {};
    const floor = floors?.[ind.id] || null;
    const evidence = (Array.isArray(p.evidence) ? p.evidence : p.evidence ? [p.evidence] : []).map((e) => clip(e, 260)).filter(Boolean).slice(0, 5);
    let score = SCORES.includes(p.score) && evidence.length ? p.score : null;
    let raised = false;
    if (floor) {
      const merged = higherScore(score, floor.score);
      raised = merged !== score;
      score = merged;
      if (floor.evidence && !evidence.includes(floor.evidence)) evidence.unshift(clip(floor.evidence, 260));
    }
    const rationale = clip(p.rationale, 600);
    return {
      indicator_id: ind.id,
      score,
      rationale: score
        ? (raised ? `${floor.reason}${rationale ? ` ${rationale}` : ''}` : rationale || floor?.reason || '')
        : 'No basis in the file for this indicator — the analyst assesses it.',
      evidence,
      confidence: !score ? 'low' : raised && !SCORES.includes(p.score) ? 'high' : ['low', 'medium', 'high'].includes(p.confidence) ? p.confidence : 'medium',
      missing: (Array.isArray(p.missing) ? p.missing : []).map((m) => clip(m, 160)).filter(Boolean).slice(0, 4),
      raised_by_rule: raised,
      rule_minimum: floor?.score || null,
      model: meta.model || null,
      at: meta.at || new Date().toISOString(),
      decision: 'pending',
    };
  });
}
