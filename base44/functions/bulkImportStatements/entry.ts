// bulkImportStatements — one file, many statements (phase 8, spec 5.2). Requires tm_core and the KYC + AML layout.
// Auth: user who may add accounts and upload statements (ACCOUNT_ROLES); tenant from the user.
//   { file_url (private file reference), file_name, as_of? }
// Each account in the file is matched on IBAN to a monitored account of the tenant. A matched statement runs the
// normal upload path (parseStatement, then commitStatement unless a check needs a person). An unknown IBAN is held
// as an UnmatchedStatement until it is linked to a customer (resolveUnmatchedStatement). MT940 and CAMT.053 only.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { authenticate, errorResponse, httpError, loadTenant, asList, ACCOUNT_ROLES } from '../../shared/tmAuth.js';
import { sha256Bytes, detectFormat } from '../../shared/tmStatementParse.js';
import { BULK_FORMATS, MAX_BULK_ACCOUNTS, parseStatements, groupByAccount, matchAccounts } from '../../shared/tmBulkImport.js';
import { amlV2On } from '../../shared/tmFiuSubmission.js';
import { runStatement } from '../../shared/tmBulkRun.js';

const HELD_ROWS = 2000;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: ACCOUNT_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    if (!amlV2On(tenant)) throw httpError(403, 'Bulk import is part of the KYC + AML layout, which is not switched on');
    const E = base44.asServiceRole.entities;

    const fileRef = String(body.file_url || '').trim();
    const fileName = String(body.file_name || 'import').trim().slice(0, 200);
    if (!fileRef) throw httpError(400, 'file_url is required');
    const fileUrl = /^https?:\/\//.test(fileRef)
      ? fileRef
      : (await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: fileRef, expires_in: 600 })).signed_url;
    const res = await fetch(fileUrl, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw httpError(422, `Could not read the uploaded file (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const fileHash = await sha256Bytes(bytes);
    const format = detectFormat(fileName, bytes);
    if (!BULK_FORMATS.includes(format)) throw httpError(422, 'Bulk import reads MT940 and CAMT.053 files. Upload other formats from the customer file.');

    let groups;
    try { groups = groupByAccount(parseStatements(format, new TextDecoder().decode(bytes))); }
    catch (e) { throw httpError(422, String(e?.message || e)); }
    if (!groups.length) throw httpError(422, 'No statement was found in this file');
    if (groups.length > MAX_BULK_ACCOUNTS) throw httpError(413, `This file holds ${groups.length} accounts; the limit is ${MAX_BULK_ACCOUNTS} per import. Split the file.`);

    const accounts = asList(await E.BankAccount.filter({ tenant_id: tenantId }, undefined, 5000));
    const { matched, unmatched } = matchAccounts(groups, accounts);
    const clientIds = [...new Set(matched.map((m) => m.account.client_id))];
    const clients = clientIds.length ? asList(await E.Client.filter({ tenant_id: tenantId, id: { $in: clientIds } }, undefined, 1000)) : [];
    const nameOf = new Map(clients.map((c) => [c.id, c.full_name]));
    const ctx = { base44, E, auth, tenantId };
    const base = (g) => ({ iban: g.iban || null, currency: g.currency || null, period_from: g.period_from || null, period_to: g.period_to || null, tx_count: g.rows.length, statements: g.statements });
    const results = [];

    for (const { group, account } of matched) {
      const same = asList(await E.StatementUpload.filter({ tenant_id: tenantId, file_hash: fileHash, bank_account_id: account.id, status: 'committed' }, undefined, 1));
      if (same.length) {
        results.push({ ...base(group), outcome: 'already_imported', client_id: account.client_id, client_name: nameOf.get(account.client_id) || null, bank_account_id: account.id, statement_upload_id: same[0].id });
        continue;
      }
      const run = await runStatement(ctx, { clientId: account.client_id, accountId: account.id, iban: group.iban, fileUrl: fileRef, fileName, asOf: body.as_of });
      results.push({ ...base(group), ...run, client_id: account.client_id, client_name: nameOf.get(account.client_id) || null, bank_account_id: account.id });
    }

    for (const { group, reason } of unmatched) {
      if (reason === 'no_transactions') { results.push({ ...base(group), outcome: 'empty' }); continue; }
      const open = asList(await E.UnmatchedStatement.filter({ tenant_id: tenantId, file_hash: fileHash, iban: group.iban || '', status: 'open' }, undefined, 1));
      let rec = open[0];
      if (!rec) {
        rec = await E.UnmatchedStatement.create({
          tenant_id: tenantId, iban: group.iban || '', currency: group.currency || undefined, period_from: group.period_from || undefined, period_to: group.period_to || undefined,
          tx_count: group.rows.length, ...(group.opening != null ? { opening_balance: group.opening } : {}), ...(group.closing != null ? { closing_balance: group.closing } : {}),
          parsed_rows: group.rows.slice(0, HELD_ROWS), file_url: fileRef, file_name: fileName, file_hash: fileHash, format, reason, status: 'open', uploaded_by_user_id: auth.actorUserId,
        });
        await writeAudit(base44, auth, {
          tenantId, eventType: 'tm_import_unmatched', before: {}, after: { unmatched_statement_id: rec.id, iban: group.iban || null, tx_count: group.rows.length, reason },
          notes: `Bulk import ${fileName}: account ${group.iban || '(no account reference)'} is not linked to a customer; ${group.rows.length} transaction(s) held.`,
        });
      }
      results.push({ ...base(group), outcome: 'unmatched', reason, unmatched_statement_id: rec.id });
    }

    const count = (o) => results.filter((r) => r.outcome === o).length;
    const summary = { accounts: results.length, processed: count('processed'), needs_review: count('needs_review'), unmatched: count('unmatched'), already_imported: count('already_imported'), failed: count('failed') };
    await writeAudit(base44, auth, {
      tenantId, eventType: 'tm_bulk_import', before: {}, after: { file_name: fileName, file_hash: fileHash, format, ...summary },
      notes: `Bulk import ${fileName} (${format}): ${summary.processed} processed, ${summary.needs_review} to review, ${summary.unmatched} unmatched, ${summary.already_imported} already imported, ${summary.failed} failed.`,
    });
    return Response.json({ ok: true, format, file_hash: fileHash, summary, statements: results });
  } catch (error) {
    console.error('bulkImportStatements error:', error?.message);
    return errorResponse(error);
  }
}
