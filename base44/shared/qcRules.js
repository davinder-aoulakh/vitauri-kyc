// qcRules — the deterministic Case Check of "Draft Report & QC" (build spec §6.2). Pure: no I/O, runs in Deno and node.
// runCaseCheck(data, strictness) -> findings[]. Each finding:
//   { code, fingerprint, step, severity: blocker|major|minor, kind: auto|human, text, rule_ref, datapoint_ref, owner, human? }
// "human" findings are judgements only a person can make (spec: QC pauses, the human-action card asks for a decision).
// QC never decides a screening hit or a risk score itself; it points to the step that owns it.
import { outreachAnswers, isPepYes } from './riskSignals.js';

export const QC_RULESET_VERSION = 'qc-1';
export const QC_MAX_ROUNDS = 3;

export const STEP_LABEL = {
  1: 'Outreach & Documents', 2: 'Identity / Entity Verification', 3: 'Screening', 4: 'Client / Entity Profile',
  5: 'Source of Funds/Wealth', 6: 'Risk Assessment', 7: 'Control Measures', 10: 'Draft Report & QC',
};
const OWNER = {
  1: 'Outreach agent', 2: 'Verification (Didit)', 3: 'Screening agent', 4: 'Profile agent', 5: 'SoF/SoW agent',
  6: 'Risk agent', 7: 'Analyst', 10: 'Report agent',
};
const CORE_STEPS = [1, 2, 3, 4, 5, 6, 7];
const NOT_REQ = [2, 5, 7];
const RANK = { Low: 1, Medium: 2, High: 3, Unacceptable: 4 };
const OPEN_HIT = new Set(['New', 'Under_Review', 'Escalated']);
const KEY_ROLE = /ubo|beneficial|director|bestuurder|shareholder|aandeelhouder|signator/i;

const parseJson = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const money = (n, cur = 'EUR') => (Number.isFinite(n) ? `${cur === 'EUR' ? '€' : `${cur} `}${Math.round(n).toLocaleString('en-GB')}` : '—');

export const stepDone = (kc, id) => (NOT_REQ.includes(id) && kc[`step_${id}_not_required`] === true) || kc[`step_${id}_status`] === 'complete';

/** Numbers in an income/turnover answer like "€70.000 - €100.000", "100k+", "€100.000 and above" -> { low, high } (annual). */
export function parseAmountRange(text) {
  const s = String(text || '').toLowerCase();
  const nums = [...s.matchAll(/(\d[\d.,\s]*)(\s*(k|m|mln|million|thousand|duizend))?/g)].map((m) => {
    let digits = m[1].replace(/\s/g, '');
    // European thousands separators ("70.000") and plain decimals ("1,5m") — drop separators when they group by 3.
    if (/^\d{1,3}([.,]\d{3})+$/.test(digits)) digits = digits.replace(/[.,]/g, '');
    else digits = digits.replace(',', '.');
    let n = parseFloat(digits);
    const u = m[3];
    if (u === 'k' || u === 'thousand' || u === 'duizend') n *= 1e3;
    if (u === 'm' || u === 'mln' || u === 'million') n *= 1e6;
    return n;
  }).filter((n) => Number.isFinite(n) && n >= 100);
  if (!nums.length) return null;
  const open = /above|more than|over|\+|en hoger|meer dan/.test(s);
  const below = /below|less than|under|minder dan|tot\b/.test(s) && nums.length === 1;
  if (nums.length === 1) return below ? { low: 0, high: nums[0] } : open ? { low: nums[0], high: null } : { low: nums[0], high: nums[0] };
  return { low: Math.min(...nums), high: Math.max(...nums) };
}

/** Declared SoF / income / turnover facts from outreach and the SoF step. */
function declared(data) {
  const { answers } = outreachAnswers(data.outreach || []);
  const find = (re) => answers.find((a) => re.test(a.label));
  const income = find(/income range|annual income|inkomen|annual (turnover|revenue)|expected (turnover|revenue)|turnover|omzet/i);
  const pep = find(/politically exposed|\bpep\b|politiek prominent/i);
  const employment = find(/employment status|dienstverband|werksituatie/i);
  const sof = parseJson(data.kycCase?.sof_narrative) || {};
  return { income, pep, employment, sof, answers };
}

/** Canonical text of the inputs QC depends on; the function hashes it (a changed case invalidates a passed QC). */
export function qcInputString(data) {
  const kc = data.kycCase || {};
  const pick = {
    cls: kc.risk_classification || null,
    steps: CORE_STEPS.map((s) => `${s}:${kc[`step_${s}_status`] || ''}:${kc[`step_${s}_not_required`] ? 'nr' : ''}`),
    sof: clean(kc.sof_narrative).slice(0, 4000), purpose: clean(kc.purpose_nature_text).slice(0, 2000),
    sel: kc.risk_assessment_meta?.selections || null,
    hits: (data.hits || []).map((h) => `${h.id}:${h.status}`).sort(),
    cms: (data.controlMeasures || []).map((m) => `${m.id}:${m.status}`).sort(),
    ras: (data.riskAssessments || []).map((r) => `${r.id}:${r.score}:${clean(r.analyst_narrative || r.ai_narrative).length}`).sort(),
    docs: (data.documents || []).map((d) => `${d.id}:${d.review_status}:${d.ai_check?.verdict || ''}`).sort(),
    rps: (data.relatedParties || []).map((p) => `${p.id}:${p.verification_status}`).sort(),
    kyb: data.kyb ? `${data.kyb.status}:${data.kyb.vitauri_review?.decision || ''}` : null,
    txn: data.txnAnalysis ? `${data.txnAnalysis.id}:${data.txnAnalysis.updated_date || ''}` : null,
    report: data.report ? `${data.report.id}:${data.report.version_number}` : null,
  };
  return JSON.stringify(pick);
}

function f(code, step, severity, text, extra = {}) {
  return { code, fingerprint: `${code}:${extra.key || ''}`, step, step_label: STEP_LABEL[step], severity, kind: extra.human ? 'human' : 'auto',
    text, rule_ref: `${QC_RULESET_VERSION}/${code}`, datapoint_ref: extra.ref || null, owner: extra.human ? 'Analyst (human)' : OWNER[step], human: extra.human || null };
}

/**
 * data: { kycCase, client, hits, outreach, documents, kyb, relatedParties, links, txnAnalysis, controlMeasures, riskAssessments, report }
 * strictness: 'light' | 'strict'
 */
export function runCaseCheck(data, strictness = 'light') {
  const kc = data.kycCase || {};
  const client = data.client || {};
  const isOrg = client.client_type === 'ORG';
  const strict = strictness === 'strict';
  const out = [];
  const cls = kc.risk_classification || null;

  // C1 — every earlier step complete or not required.
  for (const s of CORE_STEPS) if (!stepDone(kc, s)) out.push(f('C1', s, 'blocker', `${STEP_LABEL[s]} is not complete.`, { key: s, ref: `step_${s}_status` }));

  // C2 — screening hits decided (never decided by QC).
  for (const h of (data.hits || []).filter((x) => OPEN_HIT.has(x.status))) {
    out.push(f('C2', 3, 'blocker', `Screening hit "${clean(h.hit_name || h.entity_name).slice(0, 80)}" (${String(h.source || '').replace(/_/g, ' ')}) is not decided. Decide it in Screening.`, { key: h.id, ref: `ScreeningHit/${h.id}` }));
  }

  // C3 — identity / entity verification.
  if (!kc.step_2_not_required) {
    if (isOrg) {
      const k = data.kyb;
      const ok = k && (k.status === 'Approved' || (k.status === 'In Review' && k.vitauri_review?.decision === 'accepted'));
      if (!ok) out.push(f('C3', 2, 'blocker', `Business verification is ${k ? `"${k.status}"` : 'missing'}; it must be approved (or accepted in Vitauri).`, { key: 'kyb', ref: k ? `KybVerification/${k.id}` : null }));
      const keyIds = new Set((data.links || []).filter((l) => KEY_ROLE.test([l.role, ...(l.roles || [])].join(' '))).map((l) => l.related_party_id));
      for (const p of (data.relatedParties || []).filter((x) => keyIds.has(x.id) && x.verification_status !== 'Verified')) {
        out.push(f('C3', 2, strict ? 'blocker' : 'major', `Key person ${p.full_name} is ${String(p.verification_status || 'Unverified').replace(/_/g, ' ')}.`, { key: p.id, ref: `RelatedParty/${p.id}` }));
      }
    } else {
      const idv = (data.outreach || []).flatMap((r) => r.items || []).filter((i) => i.field_type === 'id_verification');
      if (idv.length && !idv.some((i) => i.idv_status === 'Pass')) out.push(f('C3', 2, 'blocker', 'No identity verification passed (Didit ID&V).', { key: 'idv' }));
      if (idv.some((i) => i.idv_status === 'Fail') && !idv.some((i) => i.idv_status === 'Pass')) out.push(f('C3', 2, 'blocker', 'An identity verification failed and none passed.', { key: 'idv_fail' }));
    }
  }

  // C4 — risk classification and rationale per selected indicator.
  if (!cls) out.push(f('C4', 6, 'blocker', 'No risk classification. Finish the Consolidated View and press Proceed.', { key: 'cls', ref: 'risk_classification' }));
  for (const ra of (data.riskAssessments || []).filter((r) => RANK[r.score] >= 3 && !clean(r.analyst_narrative || r.ai_narrative))) {
    out.push(f('C4', 6, strict ? 'major' : 'minor', `Indicator "${ra.indicator_name}" (${ra.score}) for ${ra.entity_name || 'the client'} has no rationale.`, { key: ra.id, ref: `RiskAssessment/${ra.id}` }));
  }

  // C5 — SoF documented.
  const d = declared(data);
  if (!kc.step_5_not_required) {
    const sof = d.sof?.sof || {};
    if (!clean(sof.explanation) && !(sof.sources || []).length) out.push(f('C5', 5, 'blocker', 'Source of Funds has no sources and no explanation.', { key: 'sof', ref: 'sof_narrative.sof' }));
    else if (!sof.adequacy) out.push(f('C5', 5, 'major', 'Source of Funds adequacy is not assessed.', { key: 'adequacy', ref: 'sof_narrative.sof.adequacy' }));
    if (/not adequate|inadequate/i.test(sof.adequacy || '')) out.push(f('C5', 5, 'major', 'Source of Funds is assessed as not adequate; add evidence or reflect it in the risk and measures.', { key: 'inadequate' }));
    if (!(d.sof?.evidence || []).length) out.push(f('C5', 5, strict ? 'major' : 'minor', 'No evidence document is linked to the Source of Funds.', { key: 'evidence', ref: 'sof_narrative.evidence' }));
  }

  // C6 — control measures for High and above.
  if (RANK[cls] >= 3 && !(data.controlMeasures || []).length) out.push(f('C6', 7, 'blocker', `The case is ${cls} but has no control measures.`, { key: 'cm' }));

  // C7 — purpose and nature.
  if (!clean(kc.purpose_nature_text)) out.push(f('C7', 4, 'major', 'Purpose & nature of the relationship is empty.', { key: 'purpose', ref: 'purpose_nature_text' }));

  // C8 — documents the AI checker flagged high risk and nobody reviewed.
  for (const doc of (data.documents || []).filter((x) => x.ai_check?.verdict === 'high_risk' && x.review_status === 'Pending_Review' && !x.is_deleted)) {
    out.push(f('C8', 1, 'blocker', `Document "${clean(doc.file_name).slice(0, 60)}" was flagged high risk by the AI Document Checker and is not reviewed.`, { key: doc.id, ref: `Document/${doc.id}` }));
  }

  // C10 (human) — declared income / turnover vs observed transactions.
  const ta = data.txnAnalysis;
  if (ta) {
    const observedYear = (Number(ta.avg_inbound_month) || 0) * 12;
    const range = parseAmountRange(d.income?.text);
    const cur = ta.currency || 'EUR';
    const tooHigh = range && range.high && observedYear > range.high * 2;
    const tooLow = range && range.low && observedYear > 0 && observedYear < range.low / 3;
    const inconsistent = ta.consistency_with_occupation === 'inconsistent';
    const cashHigh = Number(ta.cash_share) >= 0.3;
    if (tooHigh || tooLow || inconsistent || (strict && cashHigh)) {
      const comparison = [
        { datapoint: isOrg ? 'Expected turnover (declared)' : 'Income (declared)', declared: d.income?.text || '—', observed: `${money(observedYear, cur)} / year inbound`, fit: tooHigh || tooLow ? 'no' : 'unclear' },
        { datapoint: 'Source of Funds', declared: clean(d.sof?.sof?.explanation).slice(0, 200) || (d.sof?.sof?.sources || []).join(', ') || '—', observed: Object.keys(ta.income_by_category || {}).slice(0, 5).join(', ') || '—', fit: inconsistent ? 'no' : 'unclear' },
        ...(d.employment ? [{ datapoint: 'Employment', declared: d.employment.text, observed: ta.consistency_with_occupation || '—', fit: inconsistent ? 'no' : 'unclear' }] : []),
        ...(ta.cash_share != null ? [{ datapoint: 'Cash share', declared: '—', observed: `${Math.round(Number(ta.cash_share) * 100)}%`, fit: cashHigh ? 'no' : 'yes' }] : []),
      ];
      const why = tooHigh ? `observed inbound (${money(observedYear, cur)}/year) is more than twice the declared ${d.income?.text}` : tooLow ? `observed inbound (${money(observedYear, cur)}/year) is far below the declared ${d.income?.text}` : inconsistent ? 'the transaction analysis rates the flows inconsistent with the declared occupation/business' : `cash is ${Math.round(Number(ta.cash_share) * 100)}% of inbound funds`;
      out.push(f('C10', 5, 'major', `Source of Funds does not clearly fit the transactions: ${why}.`, {
        key: 'sof_txn', ref: `KycTransactionAnalysis/${ta.id}`,
        human: {
          kind: 'sof_vs_transactions', question: 'Is the declared Source of Funds plausible given the observed transactions?', comparison,
          evidence_items: ['I reviewed the bank statements / transaction analysis', 'I compared them with the declared income or turnover', 'I checked the supporting SoF documents'],
          outreach_question: 'Please explain the difference between your declared income/turnover and the funds received on your account, and provide supporting documents (e.g. payslips, annual accounts, sale agreement).',
        },
      }));
    }
  }

  // C11 (human) — PEP declared or confirmed but not reflected in the risk.
  const selections = kc.risk_assessment_meta?.selections || {};
  const pepSelected = Object.values(selections).some((arr) => (arr || []).some((id) => /pep/i.test(String(id))))
    || (data.riskAssessments || []).some((r) => /pep|politically/i.test(r.indicator_name || r.indicator_id || ''));
  const pepHit = (data.hits || []).some((h) => h.source === 'PEP_List' && h.status === 'Confirmed_Match');
  if ((isPepYes(d.pep?.text) || pepHit) && (!pepSelected || RANK[cls] < 3)) {
    out.push(f('C11', 6, 'major', `${pepHit ? 'A confirmed PEP match' : 'A PEP declaration in outreach'} is not reflected in the risk assessment (${pepSelected ? `class ${cls || '—'}` : 'no PEP indicator selected'}).`, {
      key: 'pep',
      human: {
        kind: 'pep_not_reflected', question: 'Is the current risk classification justified despite the PEP exposure?',
        comparison: [
          { datapoint: 'PEP', declared: d.pep?.text || '—', observed: pepHit ? 'Confirmed PEP match in screening' : 'No confirmed match', fit: 'unclear' },
          { datapoint: 'Risk classification', declared: '—', observed: cls || '—', fit: RANK[cls] >= 3 ? 'yes' : 'no' },
        ],
        evidence_items: ['I reviewed the PEP declaration / match', 'I checked the PEP role, its age and the jurisdiction', 'The risk rationale explains why the class is justified'],
        outreach_question: 'Please describe your (former) public function or your relation to a politically exposed person, including the period and the country.',
      },
    }));
  }

  // C12 — draft report generated after the last change to the case data.
  const rep = data.report;
  if (!rep) out.push(f('C12', 10, 'blocker', 'No draft report has been generated.', { key: 'report' }));
  else {
    const repAt = String(rep.generated_at || rep.created_date || '');
    const later = [...(data.riskAssessments || []), ...(data.controlMeasures || []), ...(data.hits || [])].some((x) => String(x.updated_date || '') > repAt)
      || (rep.report_data_snapshot?.case?.risk_classification && rep.report_data_snapshot.case.risk_classification !== cls);
    if (later) out.push(f('C12', 10, strict ? 'major' : 'minor', `Draft report v${rep.version_number} is older than the latest case changes; regenerate it.`, { key: 'stale', ref: `KycReport/${rep.id}` }));
  }
  return out;
}

/**
 * Outcome of a round from its findings (status open / needs_human / resolved / dismissed).
 * failed: an open blocker or major; paused: only human findings waiting; passed: nothing open but minors.
 */
export function qcOutcome(findings) {
  const open = findings.filter((x) => x.status === 'open' || x.status === 'returned');
  if (open.some((x) => x.severity === 'blocker' || x.severity === 'major')) return 'failed';
  if (findings.some((x) => x.status === 'needs_human')) return 'paused';
  return 'passed';
}

/** Validation of a human decision (spec: strict = every evidence box + reason ≥ 30 characters). */
export function validateHumanAction({ choice, reasons, evidence_confirmed = [], evidence_items = [] }, strictness) {
  if (!['Plausible', 'Not plausible', 'Cannot decide yet'].includes(choice)) return 'Choose one of the options.';
  const min = strictness === 'strict' ? 30 : 10;
  if (clean(reasons).length < min) return `Give your reasons (at least ${min} characters).`;
  if (strictness === 'strict' && choice !== 'Cannot decide yet' && evidence_items.length && !evidence_items.every((_, i) => evidence_confirmed[i] === true)) {
    return 'Confirm every evidence item before deciding.';
  }
  return null;
}
