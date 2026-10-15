// manageBankConnection — create / record_consent / withdraw / sync_now for a PSD2 BankConnection (tmWorkCase roles, own tenant).
// No bank is contacted: the only registered adapter is 'manual'. Every state change writes an AuditEvent.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList, WORK_ROLES } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { getAdapter } from '../../shared/psd2Adapter.js';

const REAUTH_DAYS = 180;
const DAY_MS = 86400000;
const snap = (c) => ({ partner: c.partner, consent_status: c.consent_status, consent_id_set: !!c.consent_id, consent_granted_at: c.consent_granted_at, reauth_due_at: c.reauth_due_at });

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const auth = await authenticate(base44, req, body, { roles: WORK_ROLES, allowApiKey: false });
    const tid = auth.tenantId;
    const E = base44.asServiceRole.entities;
    const tenant = await loadTenant(base44, tid);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');

    const audit = (clientId, eventType, before, after, notes) => writeAudit(base44, auth, { tenantId: tid, clientId, eventType, before, after, notes });
    const loadConn = async (id) => {
      if (!id) throw httpError(400, 'id is required');
      const conn = asList(await E.BankConnection.filter({ tenant_id: tid, id }))[0];
      if (!conn) throw httpError(404, 'Connection not found');
      return conn;
    };

    const { action } = body;

    if (action === 'create') {
      const account = body.bank_account_id ? asList(await E.BankAccount.filter({ tenant_id: tid, id: body.bank_account_id }))[0] : null;
      if (!account) throw httpError(404, 'Bank account not found');
      const partner = String(body.partner || 'manual').toLowerCase();
      try { getAdapter(partner); } catch (e) { throw httpError(400, e.detail); }
      const existing = asList(await E.BankConnection.filter({ tenant_id: tid, bank_account_id: account.id }, undefined, 100));
      if (existing.some((c) => !['withdrawn', 'expired'].includes(c.consent_status))) throw httpError(409, 'This account already has a connection');
      const connection = await E.BankConnection.create({
        tenant_id: tid, bank_account_id: account.id, client_id: account.client_id, partner, consent_status: 'pending',
      });
      await audit(account.client_id, 'tm_bank_connection_created', {}, snap(connection), `PSD2 connection (${partner}) created for ${account.iban_or_number}.`);
      return Response.json({ connection });
    }

    if (action === 'record_consent') {
      const conn = await loadConn(body.id);
      if (conn.consent_status === 'withdrawn') throw httpError(409, 'This connection was withdrawn');
      const consentId = typeof body.consent_id === 'string' ? body.consent_id.trim() : '';
      if (!consentId) throw httpError(400, 'consent_id is required');
      const granted = new Date(body.consent_granted_at);
      if (Number.isNaN(granted.getTime())) throw httpError(400, 'consent_granted_at must be a valid date');
      if (granted.getTime() > Date.now() + 5 * 60000) throw httpError(400, 'consent_granted_at cannot be in the future');
      const patch = {
        consent_id: consentId, consent_status: 'active', consent_granted_at: granted.toISOString(),
        reauth_due_at: new Date(granted.getTime() + REAUTH_DAYS * DAY_MS).toISOString(), last_error: '',
      };
      await E.BankConnection.update(conn.id, patch);
      await audit(conn.client_id, 'tm_bank_consent_recorded', snap(conn), snap({ ...conn, ...patch }), 'PSD2 consent recorded; re-authentication due in 180 days.');
      return Response.json({ connection: { ...conn, ...patch } });
    }

    if (action === 'withdraw') {
      const conn = await loadConn(body.id);
      if (conn.consent_status === 'withdrawn') throw httpError(409, 'Already withdrawn');
      let revokeNote = '';
      if (conn.consent_id) {
        try { await getAdapter(conn.partner).revoke({ base44, tenantId: tid, tenant }, conn.consent_id); } catch (e) {
          revokeNote = ` Partner revoke not performed: ${String(e?.detail || e?.message || e).slice(0, 120)}.`;
        }
      }
      await E.BankConnection.update(conn.id, { consent_status: 'withdrawn' });
      await audit(conn.client_id, 'tm_bank_consent_withdrawn', snap(conn), snap({ ...conn, consent_status: 'withdrawn' }), `PSD2 consent withdrawn.${revokeNote}`);
      return Response.json({ connection: { ...conn, consent_status: 'withdrawn' } });
    }

    if (action === 'sync_now') {
      const conn = await loadConn(body.id);
      const res = await base44.functions.invoke('syncBankConnection', { connection_id: conn.id });
      return Response.json(res?.data ?? res);
    }

    throw httpError(400, 'action must be create, record_consent, withdraw or sync_now');
  } catch (error) {
    console.error('manageBankConnection error:', error?.message);
    return errorResponse(error);
  }
}