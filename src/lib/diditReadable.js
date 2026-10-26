// Turns stored Didit data (transaction decisions, rule runs, AML hits, audit changes) into labelled, formatted rows
// for the UI. Raw JSON is never shown to users; anything not recognised becomes "Label: value" rows.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

const LABELS = {
  uuid: 'Didit ID', txn_id: 'Our transaction ID', transaction_number: 'Didit number', transaction_type: 'Type', action_type: 'Action',
  status: 'Status', source: 'Source', direction: 'Direction', amount: 'Amount', currency: 'Currency', currency_type: 'Currency type',
  preferred_currency_amount: 'Amount (reporting)', preferred_currency_code: 'Reporting currency', payment_details: 'Payment details',
  txn_date: 'Transaction date', created_at: 'Received by Didit', updated_at: 'Last updated', score: 'Risk score', risk_score: 'Risk score',
  severity: 'Severity', risk_level: 'Risk level', decision_reason_code: 'Decision reason code', decision_reason_label: 'Decision reason',
  tags: 'Tags', subject_name: 'Customer', subject_vendor_data: 'Customer reference', subject_type: 'Customer type', subject_uuid: 'Didit customer ID',
  subject_country: 'Customer country', counterparty_name: 'Counterparty', counterparty_vendor_data: 'Counterparty reference',
  counterparty_country: 'Counterparty country', assigned_to_name: 'Assigned to (Didit)', travel_rule_status: 'Travel rule',
  application_name: 'Didit application', organization_name: 'Didit organisation', action_required: 'Action required',
  match_score: 'Match', datasets: 'Lists', review_status: 'Review status', caption: 'Name on list', schema: 'Entity type',
  birth_date: 'Date of birth', nationality: 'Nationality', country: 'Country', position: 'Position', topics: 'Topics',
  rule_id: 'Rule ID', name: 'Name', outcome: 'Outcome', message: 'Message', reason: 'Reason', threshold: 'Threshold', value: 'Actual value',
};
// Technical identifiers users never need to read.
const HIDDEN = new Set(['application_id', 'organization_id', 'subject_uuid', 'uuid', 'didit_hit_id', 'id', 'node_id', 'last_event_id']);

const STATUS_TONE = { APPROVED: 'ok', ACCEPTED: 'ok', DECLINED: 'bad', REJECTED: 'bad', BLOCKED: 'bad', IN_REVIEW: 'warn', REVIEW: 'warn', PENDING: 'warn', AWAITING: 'warn' };
export const statusTone = (s) => STATUS_TONE[String(s || '').toUpperCase().replace(/\s+/g, '_')] || 'neutral';

export const humanise = (key) => LABELS[key] || String(key).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bId\b/g, 'ID');
const titleCase = (s) => String(s).toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const regionNames = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
export function countryName(code) {
  if (!code) return '';
  const c = String(code).trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(c)) { try { return regionNames?.of(c) || c; } catch { return c; } }
  return String(code);
}

export function formatAmount(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount == null ? '' : String(amount);
  try { return new Intl.NumberFormat('en', { style: currency ? 'currency' : 'decimal', currency: currency || undefined, maximumFractionDigits: 2 }).format(n); }
  catch { return `${n.toLocaleString('en', { maximumFractionDigits: 2 })} ${currency || ''}`.trim(); }
}

export function formatDate(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return String(v).length <= 10 ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** One value as display text. Arrays of scalars join; objects become a short "a: x · b: y" summary. */
export function formatValue(key, v) {
  if (isEmpty(v)) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? summarise(x) : formatValue(key, x))).filter(Boolean).join(', ');
  if (typeof v === 'object') return summarise(v);
  const s = String(v);
  if (/country/i.test(key)) return countryName(s);
  if (/(^|_)(date|at)$/.test(key) || ISO_DATE.test(s)) return ISO_DATE.test(s) ? formatDate(s) : s;
  if (/match_score|percent|_pct$/.test(key)) { const n = Number(s); return Number.isFinite(n) ? `${Math.round(n <= 1 ? n * 100 : n)}%` : s; }
  if (/^(status|direction|source|transaction_type|action_type|currency_type|subject_type|severity|risk_level|review_status|outcome)$/.test(key)) return titleCase(s.replace(/([a-z])([A-Z])/g, '$1 $2'));
  return s;
}

function summarise(obj) {
  return Object.entries(obj).filter(([k, v]) => !HIDDEN.has(k) && !isEmpty(v) && typeof v !== 'object').slice(0, 6)
    .map(([k, v]) => `${humanise(k)}: ${formatValue(k, v)}`).join(' · ');
}

/** Generic readable rows for any object: [{ label, value }] — nested objects become their own labelled rows. */
export function readableFields(obj, { skip = [], prefix = '' } = {}) {
  if (!obj || typeof obj !== 'object') return [];
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (skip.includes(k) || HIDDEN.has(k) || isEmpty(v)) continue;
    if (typeof v === 'object' && !Array.isArray(v)) { out.push(...readableFields(v, { prefix: `${prefix}${humanise(k)} › ` })); continue; }
    if (typeof v === 'string' && UUID.test(v)) continue;
    const value = formatValue(k, v);
    if (value) out.push({ label: `${prefix}${humanise(k)}`, value });
  }
  return out;
}

const pick = (o, ...keys) => { for (const k of keys) if (!isEmpty(o?.[k])) return o[k]; return null; };

/**
 * A Didit transaction decision as sections: [{ title, rows: [{ label, value, tone? }] }] plus a header summary.
 * txn: the Vitauri Transaction (fallbacks for amount, parties, risk).
 */
export function transactionDecision(raw, txn = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const status = pick(r, 'status') || txn.status;
  const score = pick(r, 'risk_score', 'score') ?? txn.risk_score;
  const level = pick(r, 'risk_level', 'severity') || txn.risk_level;
  const row = (label, value, tone) => (isEmpty(value) ? null : { label, value: String(value), tone });

  const decision = [
    row('Status', formatValue('status', status), statusTone(status)),
    row('Risk score', score != null ? String(score) : null),
    row('Risk level', formatValue('risk_level', level)),
    row('Decision reason', pick(r, 'decision_reason_label') || pick(r?.decision || {}, 'reason')),
    row('Action required', formatValue('action_required', pick(r, 'action_required'))),
    row('Tags', formatValue('tags', pick(r, 'tags'))),
    row('Assigned to (Didit)', pick(r, 'assigned_to_name')),
  ].filter(Boolean);

  const amount = pick(r, 'amount') ?? txn.amount;
  const currency = pick(r, 'currency') || txn.currency;
  const reporting = pick(r, 'preferred_currency_amount');
  const details = [
    row('Type', formatValue('transaction_type', pick(r, 'transaction_type', 'action_type') || txn.transaction_category)),
    row('Direction', formatValue('direction', pick(r, 'direction') || txn.direction)),
    row('Amount', formatAmount(amount, currency)),
    reporting != null ? row('Amount (reporting)', formatAmount(reporting, pick(r, 'preferred_currency_code'))) : null,
    row('Source', formatValue('source', pick(r, 'source'))),
    row('Our reference', pick(r, 'txn_id') || txn.our_transaction_id),
    row('Didit number', pick(r, 'transaction_number')),
  ].filter(Boolean);

  const parties = [
    row('Customer', pick(r, 'subject_name') || txn.subject_full_name),
    row('Customer country', countryName(pick(r, 'subject_country'))),
    row('Counterparty', pick(r, 'counterparty_name') || txn.counterparty_name),
    row('Counterparty country', countryName(pick(r, 'counterparty_country') || txn.counterparty_country)),
    row('Account / wallet', txn.counterparty_account_id),
    row('Method', formatValue('method', txn.counterparty_method_type)),
    row('Travel rule', formatValue('status', pick(r, 'travel_rule_status'))),
  ].filter(Boolean);

  const timeline = [
    row('Transaction date', pick(r, 'txn_date') ? formatDate(r.txn_date) : (txn.executed_at ? formatDate(txn.executed_at) : null)),
    row('Received by Didit', pick(r, 'created_at') ? formatDate(r.created_at) : null),
    row('Last updated', pick(r, 'updated_at') ? formatDate(r.updated_at) : null),
  ].filter(Boolean);

  const known = new Set(['status', 'risk_score', 'score', 'risk_level', 'severity', 'decision_reason_label', 'decision_reason_code', 'action_required', 'tags',
    'assigned_to_name', 'transaction_type', 'action_type', 'direction', 'amount', 'currency', 'preferred_currency_amount', 'preferred_currency_code',
    'source', 'txn_id', 'transaction_number', 'subject_name', 'subject_country', 'counterparty_name', 'counterparty_country', 'travel_rule_status',
    'txn_date', 'created_at', 'updated_at', 'rule_runs', 'rules_triggered', 'triggered_rules', 'rules', 'decision', 'subject_vendor_data',
    'subject_type', 'counterparty_vendor_data', 'application_name', 'organization_name', 'currency_type', 'payment_details']);
  const more = readableFields(r, { skip: [...known] });
  if (r.payment_details && typeof r.payment_details === 'object') more.unshift(...readableFields(r.payment_details, { prefix: 'Payment › ' }));

  return {
    status: formatValue('status', status), statusTone: statusTone(status), score, level: formatValue('risk_level', level),
    sections: [
      { title: 'Decision', rows: decision },
      { title: 'Transaction', rows: details },
      { title: 'Parties', rows: parties },
      { title: 'Timeline', rows: timeline },
      { title: 'Other details from Didit', rows: more },
    ].filter((s) => s.rows.length),
  };
}

/**
 * Didit rule runs as table rows, each resolved to the Vitauri rule that Didit ran (by didit_rule_id).
 * rulesByDiditId: Map(didit_rule_id -> TmRule), scenariosById: Map(id -> TmScenario).
 */
export function ruleRuns(runs, rulesByDiditId = new Map(), scenariosById = new Map()) {
  return (Array.isArray(runs) ? runs : []).filter((x) => x && typeof x === 'object').map((run, i) => {
    const diditId = run.rule_id || run.id || run.rule?.id || null;
    const rule = diditId ? rulesByDiditId.get(diditId) : null;
    const scenario = rule?.scenario_id ? scenariosById.get(rule.scenario_id) : null;
    const triggered = run.triggered ?? run.hit ?? run.matched ?? (run.outcome ? !/pass|no.?hit|not/i.test(String(run.outcome)) : true);
    const detailRows = readableFields(run, { skip: ['rule_id', 'id', 'rule', 'name', 'rule_name', 'score', 'risk_score', 'outcome', 'triggered', 'hit', 'matched', 'message', 'reason', 'txn'] });
    return {
      key: `${diditId || 'run'}-${i}`,
      diditName: run.name || run.rule_name || run.rule?.name || 'Didit rule',
      rule, scenario,
      managed: !!rule && rule.mode !== 'unmanaged',
      score: run.score ?? run.risk_score ?? null,
      outcome: run.outcome ? formatValue('outcome', run.outcome) : (triggered ? 'Triggered' : 'Not triggered'),
      triggered: !!triggered,
      message: run.message || run.reason || run.description || '',
      details: detailRows,
      txn: run.txn || null,
    };
  });
}

/** A Didit AML hit (ScreeningHit.hit_details) as readable sections. */
export function amlHit(details = {}) {
  const d = details && typeof details === 'object' ? details : {};
  const props = d.properties && typeof d.properties === 'object' ? d.properties : {};
  const first = (v) => (Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []);
  const row = (label, value) => (isEmpty(value) ? null : { label, value: String(value) });
  const match = [
    row('Provider', d.provider),
    row('Match', d.match_score != null ? formatValue('match_score', d.match_score) : null),
    row('Risk score', d.risk_score != null ? String(d.risk_score) : null),
    row('Didit review status', d.review_status ? formatValue('review_status', d.review_status) : null),
    row('Lists', first(d.datasets).map((x) => titleCase(String(x).replace(/[-_]/g, ' '))).join(', ')),
  ].filter(Boolean);
  const person = [
    row('Names', first(props.name).concat(first(props.alias)).slice(0, 6).join(' · ')),
    row('Date of birth', first(props.birthDate).map(formatDate).join(', ')),
    row('Nationality', first(props.nationality).map(countryName).join(', ')),
    row('Country', first(props.country).map(countryName).join(', ')),
    row('Position', first(props.position).slice(0, 4).join(' · ')),
    row('Topics', first(props.topics).map((t) => titleCase(String(t).replace(/[.-]/g, ' '))).join(', ')),
  ].filter(Boolean);
  const sources = first(d.sources).map((s) => (typeof s === 'object' ? { label: s.name || s.title || s.url || 'Source', url: s.url || s.link || null } : { label: String(s), url: /^https?:/.test(String(s)) ? String(s) : null }));
  const knownProps = new Set(['name', 'alias', 'birthDate', 'nationality', 'country', 'position', 'topics']);
  const otherProps = readableFields(Object.fromEntries(Object.entries(props).filter(([k]) => !knownProps.has(k))));
  const other = readableFields(d, { skip: ['provider', 'match_score', 'risk_score', 'review_status', 'datasets', 'properties', 'sources', 'didit_session_id', 'didit_hit_id'] });
  return {
    sections: [
      { title: 'Match', rows: match },
      { title: 'Listed person or entity', rows: person },
      { title: 'More details', rows: [...otherProps, ...other] },
    ].filter((s) => s.rows.length),
    sources,
  };
}

/** Audit before/after as field-level change rows: [{ label, before, after, changed }]. */
export function auditChange(before, after) {
  const flat = (o, prefix = '') => {
    const out = {};
    if (!o || typeof o !== 'object') return out;
    for (const [k, v] of Object.entries(o)) {
      if (HIDDEN.has(k)) continue;
      const label = `${prefix}${humanise(k)}`;
      if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flat(v, `${label} › `));
      else out[label] = { key: k, v };
    }
    return out;
  };
  const b = flat(before);
  const a = flat(after);
  const labels = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return labels.map((label) => {
    const bv = b[label] ? formatValue(b[label].key, b[label].v) : '';
    const av = a[label] ? formatValue(a[label].key, a[label].v) : '';
    return { label, before: bv, after: av, changed: bv !== av };
  }).filter((r) => r.before || r.after);
}
