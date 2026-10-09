// normaliseTransactions — canonical transaction pipeline, step 1.
// Auth: verified tenant API key (scope ingest:write) OR user with tmManageIngest. Tenant scope is never taken from the payload.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { toCanonical, normaliseDescription } from '../../shared/tmCanonical.js';
import { getRate } from '../../shared/tmFx.js';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { writeAudit } from '../../shared/tmAudit.js';
import {
  authenticate, errorResponse, httpError, invokeNext, loadTenant, chunk, asList, mapLimit, INGEST_ROLES,
} from '../../shared/tmAuth.js';

const MAX_ITEMS = 200;
const ENRICH_GROUP = 50;
const DAY_MS = 86400000;
const acctNorm = (v) => String(v ?? '').toUpperCase().replace(/[\s-]/g, '');

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: INGEST_ROLES, scope: 'ingest:write' });
    const tenantId = auth.tenantId;
    const E = base44.asServiceRole.entities;

    const { batch_id, channel, items, source_file_id } = body;
    if (!channel) throw httpError(400, 'channel is required');
    if (!Array.isArray(items) || items.length === 0) throw httpError(400, 'items must be a non-empty array');
    if (items.length > MAX_ITEMS) throw httpError(413, `Max ${MAX_ITEMS} items per call`);

    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    if (auth.mode === 'api_key' && !isTmEnabled(tenant, 'tm_ingest_api')) throw httpError(403, 'Feature tm_ingest_api is not enabled');

    // ── Batch record (tenant-scoped) ──
    const batchChannel = ['api', 'upload', 'psd2', 'manual'].includes(channel) ? channel : (String(channel).startsWith('upload') || ['csv', 'xlsx', 'mt940', 'camt', 'camt053', 'pdf'].includes(channel) ? 'upload' : 'api');
    const canonChannel = channel === 'upload' ? 'csv' : channel;
    let batch = null;
    if (batch_id) batch = asList(await E.TransactionIngestBatch.filter({ tenant_id: tenantId, id: batch_id }))[0] || null;
    if (!batch) {
      batch = await E.TransactionIngestBatch.create({
        tenant_id: tenantId, channel: batchChannel, source_ref: source_file_id || undefined,
        received_count: 0, accepted_count: 0, duplicate_count: 0, rejected: [],
        started_at: new Date().toISOString(), status: 'running', api_key_id: auth.apiKeyId,
      });
    }
    const batchRef = batch.id;

    // ── Clients: must belong to this tenant ──
    const clientIds = [...new Set(items.map((i) => i?.client_id).filter(Boolean))];
    const clients = new Map();
    for (const c of chunk(clientIds, 100)) {
      for (const cl of asList(await E.Client.filter({ tenant_id: tenantId, id: { $in: c } }))) clients.set(cl.id, cl);
    }

    // ── Bank accounts: preload + resolve/create by (client_id, iban_or_number) ──
    const accountsByClient = new Map(); // client_id -> BankAccount[]
    for (const c of chunk([...clients.keys()], 100)) {
      for (const a of asList(await E.BankAccount.filter({ tenant_id: tenantId, client_id: { $in: c } }, undefined, 1000))) {
        if (!accountsByClient.has(a.client_id)) accountsByClient.set(a.client_id, []);
        accountsByClient.get(a.client_id).push(a);
      }
    }
    const accountSource = batchChannel === 'upload' ? 'upload' : batchChannel;
    const resolveAccount = async (clientId, raw) => {
      const num = raw.iban_or_number || raw.account_iban || raw.iban || raw.account_number;
      const list = accountsByClient.get(clientId) || [];
      if (num) {
        const n = acctNorm(num);
        let acc = list.find((a) => acctNorm(a.iban_or_number) === n);
        if (!acc) {
          acc = await E.BankAccount.create({
            tenant_id: tenantId, client_id: clientId, iban_or_number: String(num).trim(),
            institution: raw.institution, bic: raw.bic, currency: raw.account_currency || raw.currency,
            holder_name: raw.holder_name, source_type: accountSource, is_customer_owned: true, status: 'active',
          });
          list.push(acc);
          accountsByClient.set(clientId, list);
        }
        return acc;
      }
      if (raw.bank_account_id) return list.find((a) => a.id === raw.bank_account_id) || null;
      return null;
    };

    // ── Canonicalise (seq = index among same-day identical items in this batch) ──
    const rejected = [];
    const seqCounter = new Map();
    const canon = []; // { index, record, raw }
    for (let index = 0; index < items.length; index++) {
      const raw = items[index] || {};
      const clientId = raw.client_id;
      if (!clientId || !clients.has(clientId)) { rejected.push({ index, reason: 'client_id missing or not in this tenant' }); continue; }
      const acc = await resolveAccount(clientId, raw);
      const day = raw.executed_at ? new Date(raw.executed_at).toISOString().slice(0, 10) : 'invalid';
      const sig = [clientId, acc?.id ?? '', day, Math.abs(Number(raw.amount)).toFixed(2), String(raw.currency || '').toUpperCase(), normaliseDescription(raw.description_raw ?? raw.description)].join('|');
      const seq = raw.external_id ? 0 : (seqCounter.get(sig) ?? 0);
      if (!raw.external_id) seqCounter.set(sig, seq + 1);
      let r;
      try {
        r = await toCanonical({ ...raw, bank_account_id: acc?.id ?? raw.bank_account_id }, canonChannel, {
          tenant, tenant_id: tenantId, client_id: clientId, bank_account_id: acc?.id, seq,
          source_file_id, ingest_batch_id: batchRef,
        });
      } catch (e) { r = { record: null, errors: [e.message] }; }
      if (!r.record) { rejected.push({ index, reason: r.errors.join('; ') }); continue; }
      canon.push({ index, record: r.record });
    }

    // ── Duplicates (tenant_id + dedupe_key), including repeats inside this batch ──
    const keys = canon.map((c) => c.record.dedupe_key);
    const existing = new Set();
    for (const c of chunk(keys, 100)) {
      for (const t of asList(await E.Transaction.filter({ tenant_id: tenantId, dedupe_key: { $in: c } }, undefined, 500))) existing.add(t.dedupe_key);
    }
    let duplicates = 0;
    const seen = new Set();
    const fresh = [];
    for (const c of canon) {
      const k = c.record.dedupe_key;
      if (existing.has(k) || seen.has(k)) { duplicates++; continue; }
      seen.add(k);
      fresh.push(c);
    }

    // ── Reversal / correction links, own transfers, FX ──
    const fxCache = new Map();
    const reportingCcy = String(tenant.tm_reporting_currency || 'USD').toUpperCase();
    let linked = 0, ownTransfers = 0, fxMissing = 0;
    for (const c of fresh) {
      const r = c.record;
      if (r.lifecycle === 'reversed' || r.lifecycle === 'corrected') {
        const t0 = new Date(r.executed_at).getTime();
        const cands = asList(await E.Transaction.filter({
          tenant_id: tenantId, client_id: r.client_id, amount: r.amount, currency: r.currency, lifecycle: 'booked',
          executed_at: { $gte: new Date(t0 - 30 * DAY_MS).toISOString(), $lte: new Date(t0 + 30 * DAY_MS).toISOString() },
        }, undefined, 50));
        const nd = normaliseDescription(r.description_raw);
        const match = cands
          .filter((o) => {
            const od = normaliseDescription(o.description_raw);
            return od === nd || (!!nd && !!od && (od.includes(nd) || nd.includes(od)));
          })
          .sort((a, b) => Math.abs(new Date(a.executed_at).getTime() - t0) - Math.abs(new Date(b.executed_at).getTime() - t0))[0];
        if (match) { r.related_to = match.id; linked++; }
      }
      if (r.counterparty_account_id) {
        const own = (accountsByClient.get(r.client_id) || []).some((a) => a.id !== r.bank_account_id && acctNorm(a.iban_or_number) === acctNorm(r.counterparty_account_id));
        if (own) { r.own_transfer = true; r.category = 'own_transfer'; ownTransfers++; }
      }
      const cl = clients.get(r.client_id);
      r.transaction_category = 'finance';
      r.counterparty_method_type = r.counterparty_account_id ? 'bank_account' : undefined;
      r.subject_entity_type = cl.client_type === 'ORG' ? 'company' : 'person';
      r.subject_full_name = cl.full_name;
      r.didit_submission_status = 'not_submitted';
      if (r.currency_kind === 'fiat') {
        const ck = `${r.executed_at.slice(0, 10)}|${r.currency}`;
        if (!fxCache.has(ck)) fxCache.set(ck, await getRate(base44, tenantId, r.executed_at, r.currency, reportingCcy));
        const fx = fxCache.get(ck);
        if (fx) r.fx = { rate: fx.rate, rate_date: fx.rate_date, reporting_currency: reportingCcy, amount_reporting: Math.round(r.amount * fx.rate * 100) / 100 };
        else fxMissing++;
      }
      for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
    }

    // ── Create Transactions ──
    const createdIds = [];
    const createdRows = [];
    for (const group of chunk(fresh, 100)) {
      const made = await E.Transaction.bulkCreate(group.map((g) => g.record));
      for (const m of (Array.isArray(made) ? made : made?.items || [])) { createdIds.push(m.id); createdRows.push(m); }
    }

    // ── CoverageDay upsert (state 'received', txn_count + n) ──
    const groups = new Map();
    for (const r of createdRows) {
      if (!r.bank_account_id || !r.coverage_date) continue;
      const k = `${r.bank_account_id}|${r.coverage_date}`;
      const g = groups.get(k) || { bank_account_id: r.bank_account_id, client_id: r.client_id, date: r.coverage_date, source_type: r.source_type, n: 0 };
      g.n++;
      groups.set(k, g);
    }
    const covList = [...groups.values()];
    if (covList.length) {
      const existingCov = new Map();
      const accIds = [...new Set(covList.map((g) => g.bank_account_id))];
      const dates = [...new Set(covList.map((g) => g.date))];
      for (const a of chunk(accIds, 50)) {
        for (const cd of asList(await E.CoverageDay.filter({ tenant_id: tenantId, bank_account_id: { $in: a }, date: { $in: dates } }, undefined, 1000))) {
          existingCov.set(`${cd.bank_account_id}|${cd.date}`, cd);
        }
      }
      await mapLimit(covList, 6, (g) => {
        const cur = existingCov.get(`${g.bank_account_id}|${g.date}`);
        return cur
          ? E.CoverageDay.update(cur.id, { state: 'received', txn_count: (cur.txn_count || 0) + g.n, source_type: g.source_type })
          : E.CoverageDay.create({ tenant_id: tenantId, bank_account_id: g.bank_account_id, client_id: g.client_id, date: g.date, expected: true, state: 'received', txn_count: g.n, source_type: g.source_type });
      });
    }

    // ── Batch counters + audit ──
    const accepted = createdIds.length;
    const batchPatch = {
      received_count: (batch.received_count || 0) + items.length,
      accepted_count: (batch.accepted_count || 0) + accepted,
      duplicate_count: (batch.duplicate_count || 0) + duplicates,
      rejected: [...(batch.rejected || []), ...rejected],
      finished_at: new Date().toISOString(),
      status: accepted === 0 && duplicates === 0 && rejected.length > 0 ? 'failed' : 'completed',
      started_at: batch.started_at || new Date().toISOString(),
    };
    await E.TransactionIngestBatch.update(batchRef, batchPatch);
    const oneClient = clientIds.length === 1 ? clientIds[0] : undefined;
    await writeAudit(base44, auth, {
      tenantId, clientId: oneClient, eventType: 'tm_ingest_batch_normalised',
      before: { received_count: batch.received_count || 0, accepted_count: batch.accepted_count || 0 },
      after: { batch_id: batchRef, received: items.length, accepted, duplicates, rejected: rejected.length, linked_reversals: linked, own_transfers: ownTransfers, fx_missing: fxMissing },
      notes: `Normalised ${items.length} item(s) via ${channel}: ${accepted} accepted, ${duplicates} duplicate, ${rejected.length} rejected.`,
    });

    // ── Enrichment in groups of 50 ──
    const enrichment = { groups: 0, failed_groups: 0, errors: [] };
    for (const ids of chunk(createdIds, ENRICH_GROUP)) {
      enrichment.groups++;
      try {
        const out = await invokeNext(base44, auth, 'enrichTransactions', { tenant_id: tenantId, transaction_ids: ids, batch_id: batchRef });
        if (out?.error) throw new Error(out.error);
      } catch (e) {
        enrichment.failed_groups++;
        enrichment.errors.push(String(e?.message || e).slice(0, 200));
      }
    }

    return Response.json({
      batch_id: batchRef, received: items.length, accepted, duplicates, rejected,
      linked_reversals: linked, own_transfers: ownTransfers, fx_missing: fxMissing,
      transaction_ids: createdIds, enrichment,
    });
  } catch (error) {
    return errorResponse(error);
  }
}