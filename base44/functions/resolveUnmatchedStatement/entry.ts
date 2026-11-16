// resolveUnmatchedStatement — the Unmatched accounts queue of the bulk import (phase 8). Requires tm_core.
// Auth: user who may add accounts and upload statements (ACCOUNT_ROLES); tenant from the user.
//   { id, action: 'link', client_id }       -> adds the account to the customer (unless they already have it) and runs
//                                              the held statement through the normal upload path
//   { id, action: 'dismiss', reason }       -> closes the entry; nothing is imported
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { authenticate, errorResponse, httpError, loadTenant, asList, invokeNext, ACCOUNT_ROLES } from '../../shared/tmAuth.js';
import { ibanNorm } from '../../shared/tmBulkImport.js';
import { runStatement } from '../../shared/tmBulkRun.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: ACCOUNT_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    const E = base44.asServiceRole.entities;

    if (!body.id) throw httpError(400, 'id is required');
    const rec = asList(await E.UnmatchedStatement.filter({ tenant_id: tenantId, id: body.id }, undefined, 1))[0];
    if (!rec || rec.tenant_id !== tenantId) throw httpError(404, 'Unmatched statement not found');
    if (rec.status !== 'open') throw httpError(409, `This entry is already ${rec.status}`);
    const nowIso = new Date().toISOString();

    if (body.action === 'dismiss') {
      const reason = String(body.reason || '').trim();
      if (reason.length < 5) throw httpError(400, 'A reason is required');
      await E.UnmatchedStatement.update(rec.id, { status: 'dismissed', dismiss_reason: reason.slice(0, 500), resolved_by_user_id: auth.actorUserId, resolved_at: nowIso });
      await writeAudit(base44, auth, {
        tenantId, eventType: 'tm_unmatched_dismissed', before: { status: 'open' }, after: { status: 'dismissed', unmatched_statement_id: rec.id, iban: rec.iban || null },
        notes: `Unmatched statement for ${rec.iban || '(no account reference)'} dismissed by ${auth.actorName}: ${reason}`,
      });
      return Response.json({ ok: true, status: 'dismissed' });
    }

    if (body.action !== 'link') throw httpError(400, "action must be 'link' or 'dismiss'");
    if (!rec.iban) throw httpError(409, 'This statement names no account, so it cannot be linked. Upload the file from the customer file instead.');
    const client = body.client_id ? asList(await E.Client.filter({ tenant_id: tenantId, id: body.client_id }, undefined, 1))[0] : null;
    if (!client) throw httpError(404, 'Client not found');

    // The account: the customer's existing one with this IBAN, else a new one through the normal account function.
    const own = asList(await E.BankAccount.filter({ tenant_id: tenantId, client_id: client.id }, undefined, 1000));
    let account = own.find((a) => ibanNorm(a.iban_or_number) === ibanNorm(rec.iban) && a.status !== 'closed') || null;
    let accountCreated = false;
    if (!account) {
      const out = await invokeNext(base44, auth, 'manageBankAccount', { action: 'create', client_id: client.id, iban_or_number: rec.iban, source_type: 'upload', ...(rec.currency ? { currency: rec.currency } : {}) });
      if (out?.error || !out?.account) throw httpError(409, String(out?.error || 'The account could not be added'));
      account = out.account; accountCreated = true;
    }

    const run = await runStatement({ base44, E, auth, tenantId }, { clientId: client.id, accountId: account.id, iban: rec.iban, fileUrl: rec.file_url, fileName: rec.file_name || 'import', asOf: body.as_of });
    if (run.outcome === 'failed') {
      // The account stays (it is the customer's); the entry stays open so the statement can be tried again.
      await E.UnmatchedStatement.update(rec.id, { linked_client_id: client.id, bank_account_id: account.id });
      throw httpError(502, `The account was added, but the statement could not be read: ${run.error}`);
    }
    await E.UnmatchedStatement.update(rec.id, {
      status: 'linked', linked_client_id: client.id, bank_account_id: account.id, statement_upload_id: run.statement_upload_id || undefined,
      resolved_by_user_id: auth.actorUserId, resolved_at: nowIso, parsed_rows: [],
    });
    await writeAudit(base44, auth, {
      tenantId, clientId: client.id, eventType: 'tm_unmatched_linked',
      before: { status: 'open' }, after: { status: 'linked', unmatched_statement_id: rec.id, iban: rec.iban, bank_account_id: account.id, account_created: accountCreated, statement_upload_id: run.statement_upload_id || null, outcome: run.outcome },
      notes: `Unmatched statement for ${rec.iban} linked to ${client.full_name} by ${auth.actorName}; ${run.outcome === 'processed' ? `${run.accepted} transaction(s) added` : 'the statement waits for review'}.`,
    });
    return Response.json({ ok: true, status: 'linked', client_id: client.id, bank_account_id: account.id, account_created: accountCreated, ...run });
  } catch (error) {
    console.error('resolveUnmatchedStatement error:', error?.message);
    return errorResponse(error);
  }
}
