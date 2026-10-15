// diditCredentialSelfTest — Vitauri Ops only. Input { tenant_id | 'all' }.
// Per tenant: resolves Didit credentials through withDiditCredentials, reports where the API key and webhook secret came from,
// then makes ONE read-only authenticated GET (rules list) with the same probe helper diditEndpointCheck uses.
// Stores the outcome in DiditEndpointCheck (kind 'credentials'). Never returns or logs key material.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError, loadTenant, mapLimit } from '../../shared/tmAuth.js';
import { withDiditCredentials } from '../../shared/diditCredentials.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { tmPath, probe } from '../../shared/diditTm.js';

function classify(status) {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 0 || status === 429 || status >= 500) return 'unreachable';
  return 'ok'; // 400/404/405/422: Didit answered and accepted the key; the path itself is a plan matter (see diditEndpointCheck)
}

async function testTenant(base44, E, rawTenant, actor) {
  const tenant = await withDiditCredentials(base44, rawTenant);
  let secretRow = null;
  try { secretRow = asList(await E.TenantSecret.filter({ tenant_id: tenant.id }, undefined, 1))[0] || null; } catch { secretRow = null; }
  const source = (field) => (!tenant[field] ? 'missing' : secretRow?.[field] ? 'TenantSecret' : 'Tenant (legacy)');
  const credentials = {
    tenant_name: tenant.name, api_key_source: source('didit_api_key'), webhook_secret_source: source('didit_webhook_secret'),
    probe: 'auth_error', http_status: 0, path: '', note: '',
  };
  if (!tenant.didit_api_key) {
    credentials.note = 'No Didit API key found, so no request was sent.';
  } else {
    credentials.path = tmPath(tenant, 'rules');
    try {
      const r = await probe(tenant, 'GET', credentials.path);
      credentials.http_status = r.status;
      credentials.probe = classify(r.status);
      if (r.status === 0) credentials.note = 'Didit could not be reached (network error or timeout).';
    } catch (e) {
      credentials.probe = e?.status === 412 ? 'auth_error' : 'unreachable';
      credentials.note = String(e?.detail || e?.message || 'Probe failed').slice(0, 200);
    }
  }
  const checkedAt = new Date().toISOString();
  const record = await E.DiditEndpointCheck.create({
    tenant_id: tenant.id, kind: 'credentials', checked_at: checkedAt, checked_by_user_id: actor.actorUserId, credentials,
  });
  await writeAudit(base44, actor, {
    tenantId: tenant.id, eventType: 'didit_credential_self_test', before: {},
    after: { check_id: record.id, api_key_source: credentials.api_key_source, webhook_secret_source: credentials.webhook_secret_source, probe: credentials.probe },
    notes: `Didit credential self-test on ${tenant.name}: API key ${credentials.api_key_source}, webhook secret ${credentials.webhook_secret_source}, probe ${credentials.probe}.`,
  });
  return { tenant_id: tenant.id, checked_at: checkedAt, ...credentials };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Unauthorized');
    if ((user.app_role || user.data?.app_role) !== 'Vitauri Ops') throw httpError(403, 'Forbidden');
    const body = await req.json().catch(() => ({}));
    if (!body.tenant_id) throw httpError(400, "tenant_id is required (a tenant id or 'all')");
    const E = base44.asServiceRole.entities;
    const actor = { actorType: 'User', actorName: user.full_name || user.email, actorUserId: user.id };
    const tenants = body.tenant_id === 'all'
      ? asList(await E.Tenant.list('-created_date', 500))
      : [await loadTenant(base44, String(body.tenant_id))];
    const settled = await mapLimit(tenants, 4, (t) => testTenant(base44, E, t, actor));
    const results = settled.map((s, i) => (s.ok ? s.value : { tenant_id: tenants[i].id, tenant_name: tenants[i].name, error: String(s.error?.message || 'Self-test failed').slice(0, 200) }));
    return Response.json({ results });
  } catch (error) {
    console.error('diditCredentialSelfTest error:', error?.message);
    return errorResponse(error);
  }
}