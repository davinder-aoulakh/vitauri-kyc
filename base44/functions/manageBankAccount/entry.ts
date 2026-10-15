// manageBankAccount — create / update / close / reopen a customer's monitored bank account (tmWorkCase roles, own tenant).
// Tenant scope comes only from the authenticated user. Every change writes an AuditEvent with before/after.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList, WORK_ROLES } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { acctNorm, pickFields, requireDate, snapshot } from '../../shared/bankAccountRules.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const auth = await authenticate(base44, req, body, { roles: WORK_ROLES, allowApiKey: false });
    const tid = auth.tenantId;
    const E = base44.asServiceRole.entities;
    const tenant = await loadTenant(base44, tid);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');

    const { action } = body;
    const loadAccount = async (id) => {
      if (!id) throw httpError(400, 'id is required');
      const acc = asList(await E.BankAccount.filter({ tenant_id: tid, id }))[0];
      if (!acc) throw httpError(404, 'Bank account not found');
      return acc;
    };
    const assertNoDuplicate = async (clientId, number, exceptId) => {
      const list = asList(await E.BankAccount.filter({ tenant_id: tid, client_id: clientId }, undefined, 1000));
      if (list.some((a) => a.id !== exceptId && acctNorm(a.iban_or_number) === acctNorm(number))) {
        throw httpError(409, 'This customer already has an account with that number');
      }
    };
    const audit = (clientId, eventType, before, after, notes) => writeAudit(base44, auth, { tenantId: tid, clientId, eventType, before, after, notes });

    if (action === 'create') {
      const clientId = body.client_id;
      const client = clientId ? asList(await E.Client.filter({ tenant_id: tid, id: clientId }))[0] : null;
      if (!client) throw httpError(404, 'Client not found');
      const f = pickFields(body);
      if (!f.iban_or_number) throw httpError(400, 'iban_or_number is required');
      await assertNoDuplicate(clientId, f.iban_or_number);
      const account = await E.BankAccount.create({
        source_type: 'manual', is_customer_owned: true, expected_frequency: 'daily', ...f,
        tenant_id: tid, client_id: clientId, status: 'active',
      });
      await audit(clientId, 'tm_bank_account_created', {}, snapshot(account), `Bank account ${account.iban_or_number} added.`);
      return Response.json({ account });
    }

    if (action === 'update') {
      const acc = await loadAccount(body.id);
      const f = pickFields(body);
      if (f.iban_or_number) await assertNoDuplicate(acc.client_id, f.iban_or_number, acc.id);
      if (f.opened_at && acc.closed_at && f.opened_at > acc.closed_at) throw httpError(400, 'opened_at cannot be after closed_at');
      const account = await E.BankAccount.update(acc.id, f);
      await audit(acc.client_id, 'tm_bank_account_updated', snapshot(acc), snapshot({ ...acc, ...f }), `Bank account ${acc.iban_or_number} updated.`);
      return Response.json({ account: { ...acc, ...f, ...(account || {}) } });
    }

    if (action === 'close') {
      const acc = await loadAccount(body.id);
      if (acc.status === 'closed') throw httpError(409, 'Account is already closed');
      const closedAt = requireDate(body.closed_at, 'closed_at');
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (!reason) throw httpError(400, 'A reason is required');
      if (acc.opened_at && closedAt < acc.opened_at) throw httpError(400, 'closed_at cannot be before opened_at');
      const patch = { status: 'closed', closed_at: closedAt, closed_reason: reason };
      await E.BankAccount.update(acc.id, patch);
      // Days after the closing date are no longer expected (coverageJob keeps this up to date afterwards).
      await E.CoverageDay.updateMany({ tenant_id: tid, bank_account_id: acc.id, date: { $gt: closedAt } }, { $set: { expected: false } });
      await audit(acc.client_id, 'tm_bank_account_closed', snapshot(acc), snapshot({ ...acc, ...patch }), `Bank account ${acc.iban_or_number} closed on ${closedAt}: ${reason}`);
      return Response.json({ account: { ...acc, ...patch } });
    }

    if (action === 'reopen') {
      const acc = await loadAccount(body.id);
      if (acc.status !== 'closed') throw httpError(409, 'Account is not closed');
      await E.BankAccount.updateMany({ tenant_id: tid, id: acc.id }, { $set: { status: 'active' }, $unset: { closed_at: '', closed_reason: '' } });
      const after = { ...acc, status: 'active', closed_at: undefined, closed_reason: undefined };
      await audit(acc.client_id, 'tm_bank_account_reopened', snapshot(acc), snapshot(after), `Bank account ${acc.iban_or_number} reopened.`);
      return Response.json({ account: after });
    }

    throw httpError(400, 'action must be create, update, close or reopen');
  } catch (error) {
    console.error('manageBankAccount error:', error?.message);
    return errorResponse(error);
  }
}