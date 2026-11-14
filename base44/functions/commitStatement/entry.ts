// commitStatement — commit a reviewed statement: batch -> normaliseTransactions -> statement gaps as CoverageDay.
// Auth: user with tmManageAccounts. Tenant scope comes from the authenticated user.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { writeAudit } from '../../shared/tmAudit.js';
import {
  authenticate, errorResponse, httpError, invokeNext, loadTenant, chunk, asList, ACCOUNT_ROLES,
} from '../../shared/tmAuth.js';
import { applyOverrides, buildItems, chunkBySig } from '../../shared/tmStatementRows.js';
import { coveredEmptyDays } from '../../shared/tmStatementChecks.js';
import { nowFor } from '../../shared/tmNow.js';
import { historicalWindowDays, resolveHistorical } from '../../shared/tmHistorical.js';

const acctNorm = (v) => String(v ?? '').toUpperCase().replace(/[\s-]/g, '');
const MAX_CALL_ITEMS = 200;
const MAX_GAP_DAYS = 366;
const dayAdd = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function expandGaps(gaps) {
  const days = [];
  for (const g of gaps || []) {
    for (let d = g.from; d <= g.to && days.length < MAX_GAP_DAYS; d = dayAdd(d, 1)) days.push(d);
  }
  return [...new Set(days)];
}

export default async function (req) {
  let upload = null;
  let E = null;
  let batchId = null;
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: ACCOUNT_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    E = base44.asServiceRole.entities;

    if (!body.statement_upload_id) throw httpError(400, 'statement_upload_id is required');
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');

    upload = asList(await E.StatementUpload.filter({ tenant_id: tenantId, id: body.statement_upload_id }))[0];
    if (!upload) throw httpError(404, 'Statement upload not found');
    if (upload.status !== 'review') throw httpError(409, `Statement is ${upload.status}; only statements in review can be committed`);
    const mismatch = (upload.blocking || []).find((b) => b?.code === 'iban_mismatch');
    if (mismatch) throw httpError(409, `The statement is for account ${mismatch.file_iban}, not ${mismatch.account_iban}. Choose the right account or add this IBAN as an account first.`);
    if ((upload.blocking || []).length) throw httpError(409, 'This statement has a blocking check and cannot be processed');
    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: upload.client_id }))[0];
    if (!client) throw httpError(404, 'Client not found');

    const rows = applyOverrides(upload.parsed_rows || [], body.row_overrides);
    const built = buildItems({
      clientId: client.id, accountId: upload.bank_account_id, accountRef: upload.account_ref, currency: upload.currency, rows,
    });
    if (!built.length) {
      // Every row is already in the ledger (the same statement uploaded again): a clean result, not an error.
      const dup = rows.filter((r) => r.duplicate && !r.excluded).length;
      if (!dup) throw httpError(422, 'No rows left to commit (all rows are excluded)');
      await E.StatementUpload.update(upload.id, { status: 'committed', committed_by_user_id: auth.actorUserId, committed_at: new Date().toISOString(), error: '' });
      await writeAudit(base44, auth, {
        tenantId, clientId: client.id, eventType: 'tm_statement_committed',
        before: { status: 'review' }, after: { status: 'committed', statement_upload_id: upload.id, accepted: 0, duplicates: dup, rejected: 0, gap_days: 0 },
        notes: `Committed ${upload.file_name}: 0 transaction(s) created, ${dup} duplicate(s) skipped (already in the ledger).`,
      });
      return Response.json({
        statement_upload_id: upload.id, status: 'committed', batch_id: null, accepted: 0, duplicates: dup, rejected: [],
        gap_days: 0, covered_days: 0, historical: 0, recent: 0, counterparties: 0,
      });
    }

    // Expected split of the rows being added (normaliseTransactions applies the same rule and stores the flag).
    const now = nowFor(tenant, body, auth);
    const windowDays = historicalWindowDays(tenant);
    const expectHistorical = built.filter((b) => resolveHistorical({ lifecycle: b.item.lifecycle, executedAt: b.item.executed_at }, now, windowDays)).length;
    const counterparties = new Set(built.map((b) => b.item.counterparty_account_id || b.item.counterparty_name).filter(Boolean)).size;

    await E.StatementUpload.update(upload.id, { status: 'committing', error: '' });

    const batch = await E.TransactionIngestBatch.create({
      tenant_id: tenantId, channel: 'upload', source_ref: upload.id, received_count: 0, accepted_count: 0,
      duplicate_count: 0, rejected: [], started_at: new Date().toISOString(), status: 'running',
    });
    batchId = batch.id;

    const channel = `upload_${upload.format === 'camt053' ? 'camt' : upload.format}`;
    const totals = { received: 0, accepted: 0, duplicates: 0, historical: 0, rejected: [] };
    for (const items of chunkBySig(built, MAX_CALL_ITEMS)) {
      const out = await invokeNext(base44, auth, 'normaliseTransactions', { batch_id: batchId, channel, source_file_id: upload.id, items, ...(body.as_of ? { as_of: body.as_of } : {}) });
      if (out?.error) throw httpError(502, out.error);
      totals.received += out.received || 0;
      totals.accepted += out.accepted || 0;
      totals.duplicates += out.duplicates || 0;
      totals.historical += out.historical || 0;
      totals.rejected.push(...(out.rejected || []));
    }
    if (totals.accepted === 0 && totals.duplicates === 0 && totals.rejected.length) {
      throw httpError(422, `No rows could be committed: ${totals.rejected.slice(0, 3).map((r) => r.reason).join('; ')}`);
    }

    // ── Statement gaps -> CoverageDay 'missing' ──
    let bankAccountId = upload.bank_account_id;
    if (!bankAccountId && upload.account_ref) {
      const accts = asList(await E.BankAccount.filter({ tenant_id: tenantId, client_id: client.id }, undefined, 1000));
      bankAccountId = accts.find((a) => acctNorm(a.iban_or_number) === acctNorm(upload.account_ref))?.id;
    }
    let gapDays = 0;
    const days = expandGaps(upload.gaps);
    if (bankAccountId && days.length) {
      const existing = new Set();
      for (const c of chunk(days, 100)) {
        for (const cd of asList(await E.CoverageDay.filter({ tenant_id: tenantId, bank_account_id: bankAccountId, date: { $in: c } }, undefined, 500))) existing.add(cd.date);
      }
      const fresh = days.filter((d) => !existing.has(d));
      for (const c of chunk(fresh, 100)) {
        await E.CoverageDay.bulkCreate(c.map((date) => ({
          tenant_id: tenantId, bank_account_id: bankAccountId, client_id: client.id, date, expected: true,
          state: 'missing', txn_count: 0, source_type: channel, gap_reason: 'statement gap',
        })));
      }
      gapDays = fresh.length;
    }

    // ── A reconciling statement covers its whole period: empty days are recorded as processed (no data missing) ──
    let coveredDays = 0;
    const covered = coveredEmptyDays({
      rows: upload.parsed_rows || [], periodFrom: upload.period_from, periodTo: upload.period_to, gaps: upload.gaps || [],
      reconciles: upload.reconciles, max: Math.max(0, MAX_GAP_DAYS - days.length),
    });
    if (bankAccountId && covered.length) {
      const existing = new Set();
      for (const c of chunk(covered, 100)) {
        for (const cd of asList(await E.CoverageDay.filter({ tenant_id: tenantId, bank_account_id: bankAccountId, date: { $in: c } }, undefined, 500))) existing.add(cd.date);
      }
      const fresh = covered.filter((d) => !existing.has(d));
      for (const c of chunk(fresh, 100)) {
        await E.CoverageDay.bulkCreate(c.map((date) => ({
          tenant_id: tenantId, bank_account_id: bankAccountId, client_id: client.id, date, expected: true,
          state: 'processed', txn_count: 0, source_type: channel,
        })));
      }
      coveredDays = fresh.length;
    }

    await E.StatementUpload.update(upload.id, {
      status: 'committed', committed_by_user_id: auth.actorUserId, committed_at: new Date().toISOString(),
      batch_id: batchId, ...(bankAccountId ? { bank_account_id: bankAccountId } : {}), error: '',
    });
    await writeAudit(base44, auth, {
      tenantId, clientId: client.id, eventType: 'tm_statement_committed',
      before: { status: 'review' },
      after: { status: 'committed', statement_upload_id: upload.id, batch_id: batchId, accepted: totals.accepted, duplicates: totals.duplicates, rejected: totals.rejected.length, gap_days: gapDays, covered_days: coveredDays, historical: totals.historical },
      notes: `Committed ${upload.file_name}: ${totals.accepted} transaction(s) created, ${totals.duplicates} duplicate(s) skipped, ${gapDays} gap day(s) recorded.`,
    });

    return Response.json({
      statement_upload_id: upload.id, status: 'committed', batch_id: batchId,
      accepted: totals.accepted, duplicates: totals.duplicates, rejected: totals.rejected, gap_days: gapDays,
      covered_days: coveredDays, historical: totals.historical, recent: Math.max(0, totals.accepted - totals.historical),
      expected_historical: expectHistorical, historical_window_days: windowDays, counterparties,
    });
  } catch (error) {
    if (upload && E && upload.status === 'review') {
      try {
        const cur = asList(await E.StatementUpload.filter({ tenant_id: upload.tenant_id, id: upload.id }))[0];
        if (cur && cur.status === 'committing') await E.StatementUpload.update(upload.id, { status: 'review', error: String(error?.message || error).slice(0, 500) });
        if (batchId) await E.TransactionIngestBatch.update(batchId, { status: 'failed', finished_at: new Date().toISOString() });
      } catch { /* keep original error */ }
    }
    return errorResponse(error);
  }
}