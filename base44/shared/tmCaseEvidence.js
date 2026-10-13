// AI evidence collection for a TM case: alerts, transactions, KYC file, screening, counterparties and coverage gaps.
import { asList, chunk } from './tmAuth.js';
import { runTmAgent } from './tmAi.js';

const DAY_MS = 86400000;
const MAX_TXNS = 100;

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          kind: { type: 'string', enum: ['risk', 'ok', 'unclear', 'gap'] },
          source_refs: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    insufficient_evidence: { type: 'boolean' },
    missing: { type: 'array', items: { type: 'string' } },
  },
};

const SYSTEM_PROMPT = `You are an investigation assistant for a transaction monitoring case. Review the bundled alerts, transactions, the client's KYC file (profile, occupation, purpose of relationship, expected behaviour), screening results and counterparties.
Rules: every finding must be a fact supported by the input and cite source_refs from the valid list. Use kind "risk" for facts that increase concern, "ok" for facts that explain or reduce concern, "unclear" where evidence is ambiguous, "gap" where information is missing. Never speculate about intent, never recommend filing or not filing a report, never mix identity verification with source of funds.`;

const ranges = (dates) => {
  const out = [];
  const sorted = [...new Set(dates)].sort();
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && new Date(`${d}T00:00:00Z`).getTime() - new Date(`${last.to}T00:00:00Z`).getTime() === DAY_MS) last.to = d;
    else out.push({ from: d, to: d });
  }
  return out;
};

const days = (r) => Math.round((new Date(`${r.to}T00:00:00Z`) - new Date(`${r.from}T00:00:00Z`)) / DAY_MS) + 1;

async function byIds(fn, ids, cap) {
  const out = [];
  for (const part of chunk(ids.slice(0, cap), 100)) out.push(...asList(await fn(part)));
  return out;
}

export async function collectEvidence(ctx, tmCase) {
  const { E, tenantId, tenant, base44 } = ctx;
  const clientIds = tmCase.client_ids?.length ? tmCase.client_ids : [tmCase.primary_client_id];
  const since = new Date(Date.now() - 90 * DAY_MS).toISOString().slice(0, 10);
  const alerts = asList(await E.TmAlert.filter({ tenant_id: tenantId, id: { $in: tmCase.alert_ids || [] } }, undefined, 100));
  const txnIds = [...new Set(alerts.flatMap((a) => a.transaction_ids || []))];
  const [txns, clients, kyc, profile, hits, accounts, missingDays] = await Promise.all([
    byIds((p) => E.Transaction.filter({ tenant_id: tenantId, id: { $in: p } }, undefined, 100), txnIds, MAX_TXNS),
    E.Client.filter({ tenant_id: tenantId, id: { $in: clientIds } }, undefined, 50).then(asList),
    E.KycCase.filter({ tenant_id: tenantId, client_id: tmCase.primary_client_id }, '-created_date', 1).then((r) => asList(r)[0] || null),
    E.ExpectedProfile.filter({ tenant_id: tenantId, client_id: tmCase.primary_client_id, status: 'approved' }, '-version', 1).then((r) => asList(r)[0] || null),
    E.ScreeningHit.filter({ tenant_id: tenantId, client_id: { $in: clientIds } }, '-created_date', 50).then(asList),
    E.BankAccount.filter({ tenant_id: tenantId, client_id: { $in: clientIds }, status: 'active' }, undefined, 100).then(asList),
    E.CoverageDay.filter({ tenant_id: tenantId, client_id: { $in: clientIds }, state: 'missing', expected: true, date: { $gte: since } }, undefined, 1000).then(asList),
  ]);
  const cpIds = [...new Set(txns.map((t) => t.counterparty_id).filter(Boolean))];
  const counterparties = await byIds((p) => E.Counterparty.filter({ tenant_id: tenantId, id: { $in: p } }, undefined, 100), cpIds, 50);

  // Deterministic gaps (always present, independent of the model).
  const gaps = [];
  const byAccount = new Map();
  for (const d of missingDays) byAccount.set(d.bank_account_id, [...(byAccount.get(d.bank_account_id) || []), d.date]);
  for (const [accId, dates] of byAccount) {
    const acc = accounts.find((a) => a.id === accId);
    for (const r of ranges(dates).slice(0, 5)) {
      gaps.push({ text: `No transaction data received for account ${acc?.iban_or_number || accId} from ${r.from} to ${r.to} (${days(r)} day${days(r) > 1 ? 's' : ''}).`, source_refs: [`coverage:${accId}`] });
    }
  }
  if (!profile) gaps.push({ text: 'There is no approved expected profile for the primary client.', source_refs: [`client:${tmCase.primary_client_id}`] });
  if (!kyc) gaps.push({ text: 'No KYC case with purpose or expected behaviour is on file for the primary client.', source_refs: [`client:${tmCase.primary_client_id}`] });

  const sources = [
    ...alerts.map((a) => `alert:${a.id}`), ...txns.map((t) => `txn:${t.id}`), ...clients.map((c) => `client:${c.id}`),
    ...(kyc ? [`kyc:${kyc.id}`] : []), ...(profile ? [`profile:${profile.id}`] : []), ...hits.map((h) => `screening:${h.id}`),
    ...counterparties.map((c) => `counterparty:${c.id}`), ...accounts.map((a) => `coverage:${a.id}`),
  ];
  const input = {
    case: { ref: tmCase.case_ref, title: tmCase.title },
    alerts: alerts.map((a) => ({ ref: `alert:${a.id}`, title: a.title, score: a.score, indicator_type: a.indicator_type, status: a.status, reasons: a.ai_reasons })),
    transactions: txns.map((t) => ({ ref: `txn:${t.id}`, date: t.executed_at, direction: t.direction, amount: t.amount, currency: t.currency, category: t.category, country: t.counterparty_country, counterparty: t.counterparty_name, counterparty_ref: t.counterparty_id ? `counterparty:${t.counterparty_id}` : null })),
    clients: clients.map((c) => ({ ref: `client:${c.id}`, name: c.full_name, type: c.client_type, nationality: c.nationality, country_of_residence: c.country_of_residence, risk_classification: c.risk_classification, status: c.status })),
    kyc_file: kyc ? { ref: `kyc:${kyc.id}`, purpose_nature: kyc.purpose_nature_text, expected_behaviour: kyc.expected_transaction_behavior, source_of_funds: kyc.sof_narrative, risk_classification: kyc.risk_classification } : null,
    expected_profile: profile ? { ref: `profile:${profile.id}`, inbound_max_month: profile.inbound_max_month, outbound_foreign_max_month: profile.outbound_foreign_max_month, cash_max_month: profile.cash_max_month, allowed_countries: profile.allowed_countries } : null,
    screening: hits.map((h) => ({ ref: `screening:${h.id}`, source: h.source, name: h.hit_name, status: h.status, confidence: h.confidence_score })),
    counterparties: counterparties.map((c) => ({ ref: `counterparty:${c.id}`, name: c.display_name, country: c.country, kind: c.entity_kind, screening_status: c.screening_status })),
    data_gaps: gaps.map((g) => g.text),
  };

  const { output, dropped_claims, ai_run_id } = await runTmAgent(base44, {
    tenantId, agent: 'TmEvidence', tmCaseId: tmCase.id, input, sources, schema: SCHEMA, systemPrompt: SYSTEM_PROMPT,
  });

  const mk = (kind, text, source_refs) => ({ id: crypto.randomUUID(), kind, text, source_refs, by: 'ai', accepted: false });
  const items = [
    ...(output.findings || []).map((f) => mk(f.kind || 'unclear', f.text, f.source_refs)),
    ...gaps.map((g) => mk('gap', g.text, g.source_refs)),
    ...(output.missing || []).slice(0, 10).map((m) => mk('gap', String(m), [`client:${tmCase.primary_client_id}`])),
  ];
  const seen = new Set();
  const unique = items.filter((i) => { const k = `${i.kind}:${i.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { items: unique, dropped_claims, ai_run_id, tenant };
}