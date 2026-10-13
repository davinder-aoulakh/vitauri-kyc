// commitStatement — commit a reviewed statement: batch -> normaliseTransactions -> statement gaps as CoverageDay.
// Auth: user with tmWorkCase. Tenant scope comes from the authenticated user.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { writeAudit } from '../../shared/tmAudit.js';
import {
  authenticate, errorResponse, httpError, invokeNext, loadTenant, chunk, asList, WORK_ROLES,
} from '../../shared/tmAuth.js';
import { applyOverrides, buildItems, chunkBySig } from '../../shared/tmStatementRows.js';

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
    const auth = await authenticate(base44, req, body, { roles: WORK_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    E = base44.asServiceRole.entities;

    if (!body.statement_upload_id) throw httpError(400, 'statement_upload_id is required');
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');

    upload = asList(await E.StatementUpload.filter({ tenant_id: tenantId, id: body.statement_upload_id }))[0];
    if (!upload) throw httpError(404, 'Statement upload not found');
    if (upload.status !== 'review') throw httpError(409, `Statement is ${upload.status}; only statements in review can be committed`);
    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: upload.client_id }))[0];
    if (!client) throw httpError(404, 'Client not found');

    const rows = applyOverrides(upload.parsed_rows || [], body.row_overrides);
    const built = buildItems({
      clientId: client.id, accountId: upload.bank_account_id, accountRef: upload.account_ref, currency: upload.currency, rows,
    });
    if (!built.length) throw httpError(422, 'No rows left to commit (all rows are duplicates or excluded)');

    await E.StatementUpload.update(upload.id, { status: 'committing', error: '' });

    const batch = await E.TransactionIngestBatch.create({
      tenant_id: tenantId, channel: 'upload', source_ref: upload.id, received_count: 0, accepted_count: 0,
      duplicate_count: 0, rejected: [], started_at: new Date().toISOString(), status: 'running',
    });
    batchId = batch.id;

    const channel = `upload_${upload.format === 'camt053' ? 'camt' : upload.format}`;
    const totals = { received: 0, accepted: 0, duplicates: 0, rejected: [] };
    for (const items of chunkBySig(built, MAX_CALL_ITEMS)) {
      const out = await invokeNext(base44, auth, 'normaliseTransactions', { batch_id: batchId, channel, source_file_id: upload.id, items });
      if (out?.error) throw httpError(502, out.error);
      totals.received += out.received || 0;
      totals.accepted += out.accepted || 0;
      totals.duplicates += out.duplicates || 0;
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

    await E.StatementUpload.update(upload.id, {
      status: 'committed', committed_by_user_id: auth.actorUserId, committed_at: new Date().toISOString(),
      batch_id: batchId, ...(bankAccountId ? { bank_account_id: bankAccountId } : {}), error: '',
    });
    await writeAudit(base44, auth, {
      tenantId, clientId: client.id, eventType: 'tm_statement_committed',
      before: { status: 'review' },
      after: { status: 'committed', statement_upload_id: upload.id, batch_id: batchId, accepted: totals.accepted, duplicates: totals.duplicates, rejected: totals.rejected.length, gap_days: gapDays },
      notes: `Committed ${upload.file_name}: ${totals.accepted} transaction(s) created, ${totals.duplicates} duplicate(s) skipped, ${gapDays} gap day(s) recorded.`,
    });

    return Response.json({
      statement_upload_id: upload.id, status: 'committed', batch_id: batchId,
      accepted: totals.accepted, duplicates: totals.duplicates, rejected: totals.rejected, gap_days: gapDays,
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