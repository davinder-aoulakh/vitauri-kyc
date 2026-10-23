import React from 'react';

// Human-readable rendering of a Didit rule definition (conditions + aggregations + actions).
const OP = { eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', in: 'in', not_in: 'not in', regex: 'matches', fuzzy_match: 'resembles' };
const FIELD = {
  direction: 'Direction', amount: 'Amount', currency: 'Currency', transaction_category: 'Category',
  counterparty_vendor_data: 'counterparty', subject_vendor_data: 'customer', counterparty_country: 'Counterparty country',
  subject_country: 'Customer country', payment_method: 'Payment method', ip_country: 'IP country',
};
const METRIC = { count: 'transactions', sum: 'total amount', min: 'smallest amount', max: 'largest amount', avg: 'average amount', distinct_count: 'distinct' };

const fieldName = (f) => FIELD[f] || String(f || '').replace(/^custom_values\./, '').replace(/_/g, ' ');
const val = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'number' ? v.toLocaleString() : String(v ?? ''));
const windowText = (w) => {
  const m = /^(\d+)\s*([mhd])$/.exec(String(w || ''));
  return m ? `${m[1]} ${{ m: 'min', h: 'h', d: 'd' }[m[2]]}` : String(w || '');
};

export function ruleSentenceParts(def) {
  const d = def || {};
  const join = d.evaluation_mode === 'ANY' ? ' or ' : ' and ';
  const conds = (d.conditions || []).map((c) => `${fieldName(c.field)} ${OP[c.op] || c.op} ${val(c.value)}`);
  const aggs = (Array.isArray(d.aggregation) ? d.aggregation : d.aggregation ? [d.aggregation] : []).map((a) => {
    const what = a.metric === 'distinct_count' ? `distinct ${fieldName(a.field)}s` : METRIC[a.metric] || a.metric;
    const scope = a.filters?.subject_vendor_data === '__current__' ? ' for this customer' : '';
    return `${OP[a.op] || a.op} ${val(a.value)} ${what} in ${windowText(a.window)}${scope}`;
  });
  const acts = (d.actions || []).map((x) => {
    if (x.type === 'add_score') return `+${x.value} score`;
    if (x.type === 'add_tags') return `tag ${x.tag_name || val(x.value)}`;
    return String(x.type || '').replace(/_/g, ' ');
  });
  return { when: conds.join(join), aggs: aggs.join(' and '), then: acts.join(', ') };
}

export default function RuleSentence({ definition, className }) {
  const p = ruleSentenceParts(definition);
  if (!p.when && !p.aggs && !p.then) return <p className={className}>No conditions defined yet.</p>;
  return (
    <p className={className}>
      {p.when && <><span className="font-semibold">When</span> {p.when}</>}
      {p.aggs && <>{p.when ? ' · ' : ''}<span className="font-semibold">and</span> {p.aggs}</>}
      {p.then && <> <span className="font-semibold">→</span> {p.then}</>}
    </p>
  );
}
