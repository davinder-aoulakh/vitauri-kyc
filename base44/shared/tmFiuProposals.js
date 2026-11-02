// Automatic FIU report proposals (pure detection). Drafts only: a person reviews every proposal and four-eyes approval applies.
// CTR: cash per client per day >= thresholds.ctr_cash. TTR: all transactions per client per day >= thresholds.ttr.
// IFT: cross-border transfers (not cash) each >= thresholds.ift, grouped per client per day.
// CBR: cross-border cash / bearer instruments each >= thresholds.cbr, grouped per client per day.
// TFR: confirmed / escalated sanctions screening hits with a terrorism signal, or open alerts from a TF scenario.
// Amounts are in the tenant reporting currency; transactions without a known reporting amount are left out (and counted).
import { amountInReporting, countableTxns } from './tmActuals.js';
import { isCash, isCrossBorder, TF_PATTERN } from './fiuTypes.js';

const day = (iso) => String(iso || '').slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;
const fmt = (n, cur) => `${round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const thr = (v) => (Number(v) > 0 ? Number(v) : null);

function narrativeFor(type, { client, date, rows, total, threshold, cur }) {
  const n = rows.length;
  const what = {
    CTR: `${n} cash transaction${n === 1 ? '' : 's'}`,
    TTR: `${n} transaction${n === 1 ? '' : 's'}`,
    IFT: `${n} international funds transfer${n === 1 ? '' : 's'}`,
    CBR: `${n} cross-border cash / bearer-instrument transaction${n === 1 ? '' : 's'}`,
  }[type];
  const countries = [...new Set(rows.map((t) => t.counterparty_country).filter(Boolean))];
  return [
    `On ${date} ${client?.full_name || 'the client'} carried out ${what} totalling ${fmt(total, cur)}.`,
    `This is at or above the ${type} reporting threshold of ${fmt(threshold, cur)} set in the FIU profile.`,
    countries.length ? `Counterparty countries: ${countries.join(', ')}.` : '',
    'This report was proposed automatically from the threshold rule; it is not a suspicion assessment.',
  ].filter(Boolean).join(' ');
}

/**
 * txns: the transactions of ONE client in the scan window. fiu: that client's FIU profile.
 * reported: Set of proposal keys already used. Returns { proposals, unknownAmount }.
 */
export function detectThresholdProposals({ client, fiu, txns, cur, reported = new Set() }) {
  const t = fiu?.thresholds || {};
  const limits = { CTR: thr(t.ctr_cash), TTR: thr(t.ttr), IFT: thr(t.ift), CBR: thr(t.cbr) };
  const enabled = new Set((fiu?.enabled_report_types || []).length ? fiu.enabled_report_types : ['CTR', 'TTR', 'IFT', 'CBR']);
  const rows = countableTxns(txns).map((x) => ({ x, amt: amountInReporting(x, cur) }));
  const unknownAmount = rows.filter((r) => r.amt == null).length;
  const byDay = new Map();
  for (const r of rows) {
    if (r.amt == null || !r.x.executed_at) continue;
    const d = day(r.x.executed_at);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(r);
  }
  const proposals = [];
  const push = (type, date, picked) => {
    const key = `${type}:${client.id}:${date}`;
    if (!picked.length || reported.has(key) || !enabled.has(type) || !limits[type]) return;
    const total = picked.reduce((s, r) => s + r.amt, 0);
    const txs = picked.map((r) => r.x);
    proposals.push({
      key, type, client_id: client.id, date, transaction_ids: txs.map((x) => x.id), total: round2(total), threshold: limits[type], currency: cur,
      rule: { CTR: 'cash per client per day', TTR: 'all transactions per client per day', IFT: 'each cross-border transfer', CBR: 'each cross-border cash / bearer instrument' }[type],
      narrative: narrativeFor(type, { client, date, rows: txs, total, threshold: limits[type], cur }),
    });
  };
  for (const [date, list] of [...byDay.entries()].sort()) {
    const cash = list.filter((r) => isCash(r.x));
    if (limits.CTR && cash.reduce((s, r) => s + r.amt, 0) >= limits.CTR) push('CTR', date, cash);
    if (limits.TTR && list.reduce((s, r) => s + r.amt, 0) >= limits.TTR) push('TTR', date, list);
    if (limits.IFT) push('IFT', date, list.filter((r) => !isCash(r.x) && isCrossBorder(r.x, fiu) && r.amt >= limits.IFT));
    if (limits.CBR) push('CBR', date, list.filter((r) => isCash(r.x) && isCrossBorder(r.x, fiu) && r.amt >= limits.CBR));
  }
  return { proposals, unknownAmount };
}

const hitText = (h) => {
  let details = '';
  try { details = typeof h.hit_details === 'string' ? h.hit_details : JSON.stringify(h.hit_details || {}); } catch { details = ''; }
  return `${h.hit_name || ''} ${h.entity_name || ''} ${details}`;
};

/** One TFR proposal per client with unreported TF signals. reported: Set of signal keys already in a report. */
export function detectTfProposals({ hits = [], alerts = [], scenarios = [], reported = new Set() }) {
  const tfScenario = new Set(scenarios.filter((s) => TF_PATTERN.test(`${s.code || ''} ${s.name || ''} ${s.risk_id || ''} ${s.description || ''}`)).map((s) => s.id));
  const signals = [];
  for (const h of hits) {
    if (!h.client_id || !['Confirmed_Match', 'Escalated'].includes(h.status)) continue;
    if (!/^Sanctions_/.test(h.source || '') && h.source !== 'Internal_Flag') continue;
    if (!TF_PATTERN.test(hitText(h))) continue;
    signals.push({ key: `TFR:hit:${h.id}`, client_id: h.client_id, kind: 'screening', text: `${h.status === 'Confirmed_Match' ? 'Confirmed' : 'Escalated'} ${String(h.source).replace('_', ' ')} screening hit "${h.hit_name}"${h.related_party_id ? ' on a related party' : ''}` });
  }
  for (const a of alerts) {
    if (!a.client_id || !tfScenario.has(a.scenario_id)) continue;
    signals.push({ key: `TFR:alert:${a.id}`, client_id: a.client_id, alert_id: a.id, kind: 'alert', text: `Alert ${a.ref || a.id} "${a.title || ''}" from a terrorist-financing scenario`, transaction_ids: a.transaction_ids || [] });
  }
  const byClient = new Map();
  for (const s of signals) {
    if (reported.has(s.key)) continue;
    if (!byClient.has(s.client_id)) byClient.set(s.client_id, []);
    byClient.get(s.client_id).push(s);
  }
  return [...byClient.entries()].map(([clientId, list]) => ({
    key: list[0].key, signal_keys: list.map((s) => s.key), type: 'TFR', client_id: clientId,
    alert_ids: list.map((s) => s.alert_id).filter(Boolean), transaction_ids: [...new Set(list.flatMap((s) => s.transaction_ids || []))],
    rule: 'terrorist-financing signal',
    narrative: [
      'Terrorist-financing indicators were identified for this customer:',
      ...list.map((s) => `- ${s.text}.`),
      'This report must be filed without delay. Assess an asset freeze under the applicable sanctions regulation; Vitauri does not freeze assets automatically. Do not inform the customer (no tipping-off).',
    ].join('\n'),
  }));
}

/** Every proposal / signal key already used by an earlier automatic report. */
export function reportedKeys(reports) {
  const keys = new Set();
  for (const r of reports) {
    if (r.proposal?.key) keys.add(r.proposal.key);
    for (const k of r.proposal?.signal_keys || []) keys.add(k);
  }
  return keys;
}
