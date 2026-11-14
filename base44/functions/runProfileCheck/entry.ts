// runProfileCheck — monitoring check for ONE client right after new transactions arrived (called by commitStatement):
// expected-profile comparison, change of circumstances by tenant setting, and (when switched on) detection in Vitauri.
// Auth: user with tmManageAccounts. Tenant scope comes from the authenticated user, never from the payload.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { waitUntil } from 'base44:runtime';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList, ACCOUNT_ROLES } from '../../shared/tmAuth.js';
import { nowFor } from '../../shared/tmNow.js';
import { checkClient } from '../../shared/tmProfileCheck.js';
import { writeAudit } from '../../shared/tmAudit.js';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const auth = await authenticate(base44, req, body, { roles: ACCOUNT_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    if (!body.client_id) throw httpError(400, 'client_id is required');
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    const E = base44.asServiceRole.entities;
    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: body.client_id }))[0];
    if (!client || client.is_deleted) throw httpError(404, 'Client not found');

    const now = nowFor(tenant, body, auth);
    const result = await checkClient(base44, { tenant, client, now, actor: auth, waitUntilFn: waitUntil });
    const created = result.alerts.filter((a) => a.created).length;
    await writeAudit(base44, auth, {
      tenantId, clientId: client.id, eventType: 'tm_profile_check_run',
      before: {}, after: { alerts: result.alerts.length, alerts_created: created, change_of_circumstances: result.change_of_circumstances.length, detection_in_vitauri: result.detection, as_of: now.toISOString() },
      notes: `Monitoring check after new transactions: ${created} new alert(s), ${result.change_of_circumstances.length} change(s) of circumstances proposed.`,
    });
    return Response.json({ alerts: result.alerts, change_of_circumstances: result.change_of_circumstances, detection_in_vitauri: result.detection });
  } catch (error) {
    console.error('runProfileCheck error:', error?.message);
    return errorResponse(error);
  }
}
