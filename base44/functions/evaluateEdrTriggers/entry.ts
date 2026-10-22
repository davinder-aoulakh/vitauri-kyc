// evaluateEdrTriggers — propose event-driven reviews (EdrTrigger) when the KYC file or behaviour changes. Requires tm_core.
// Modes:
//   change { client_id, change: { type: 'client_profile'|'related_party', source_ref, before, after } } — after an analyst save.
//     Auth: signed-in user with createEditClient (own tenant), or an internal call with no user (tenant from the client).
//     Only clients with an approved KYC case are evaluated. With a kyc_approval baseline the current file is compared with
//     it; without one the submitted before/after is used, checked against the stored data.
//   scan { tenant_id? } — nightly: every client with an approved kyc_approval Decision is compared with that baseline,
//     plus confirmed screening hits since approval and consecutive profile breaches above 150%.
//     Auth: scheduler (no user: all tm_core tenants), Vitauri Ops (tenant_id or all), Tenant Admin (own tenant).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList, mapLimit } from '../../shared/tmAuth.js';
import {
  latestBaseline, currentParties, diffAgainstBaseline, screeningFindings, profileBreachFindings, proposeTriggers, roleKind,
} from '../../shared/edrTriggers.js';

const EDIT_ROLES = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin']; // createEditClient
const SYSTEM = { actorType: 'System', actorName: 'EDR Trigger Scan', actorUserId: undefined };
const norm = (v) => String(v ?? '').trim().toLowerCase();
const CLIENT_FIELDS = { business_activity: 'business_activity_change', sector: 'business_activity_change', country_of_residence: 'country_change', registered_country: 'country_change' };

// Findings from a submitted before/after when the client has no kyc_approval baseline yet. Values are checked against stored data.
async function payloadFindings(E, tenantId, client, change) {
  const out = [];
  const before = change.before || {};
  const after = change.after || {};
  const ref = String(change.source_ref || '').slice(0, 120);
  if (change.type === 'client_profile') {
    for (const [field, type] of Object.entries(CLIENT_FIELDS)) {
      if (!(field in after) || norm(before[field]) === norm(after[field]) || norm(client[field]) !== norm(after[field])) continue;
      out.push({ type, key: `${type}:${field}:nobaseline:${norm(after[field]).slice(0, 60)}`, source_ref: ref, before: { [field]: before[field] ?? null }, after: { [field]: client[field] ?? null },
        summary: `${field.replace(/_/g, ' ')} changed from "${before[field] || '—'}" to "${client[field] || '—'}"` });
    }
  } else if (change.type === 'related_party') {
    const pid = after.related_party_id || before.related_party_id;
    if (!pid) return out;
    const now = (await currentParties(E, tenantId, client.id)).find((p) => p.id === pid) || null;
    const bKind = roleKind(before.role);
    const nKind = now?.kind || null;
    if (nKind && nKind !== bKind) {
      const type = nKind === 'ubo' ? 'ubo_change' : 'director_change';
      out.push({ type, key: `${type}:added:${pid}:nobaseline`, source_ref: ref, before: {}, after: { related_party_id: pid, full_name: now.full_name, role: now.role, ownership_percentage: now.ownership_percentage },
        summary: `${nKind === 'ubo' ? 'UBO' : 'Director'} added: ${now.full_name}` });
    }
    if (bKind && bKind !== nKind) {
      const type = bKind === 'ubo' ? 'ubo_change' : 'director_change';
      out.push({ type, key: `${type}:removed:${pid}:nobaseline`, source_ref: ref, before: { related_party_id: pid, full_name: before.full_name, role: before.role }, after: {},
        summary: `${bKind === 'ubo' ? 'UBO' : 'Director'} removed: ${before.full_name || pid}` });
    }
    if (bKind === 'ubo' && nKind === 'ubo') {
      const delta = Math.abs((Number(now.ownership_percentage) || 0) - (Number(before.ownership_percentage) || 0));
      if (delta >= 10) {
        out.push({ type: 'ubo_change', key: `ubo_change:ownership:${pid}:nobaseline:${now.ownership_percentage ?? 0}`, source_ref: ref,
          before: { related_party_id: pid, ownership_percentage: before.ownership_percentage ?? null }, after: { related_party_id: pid, ownership_percentage: now.ownership_percentage ?? null },
          summary: `Ownership of ${now.full_name} changed from ${before.ownership_percentage ?? 0}% to ${now.ownership_percentage ?? 0}%` });
      }
    }
  }
  return out;
}

async function runChange(base44, auth, tenantId, body) {
  const E = base44.asServiceRole.entities;
  const client = asList(await E.Client.filter({ tenant_id: tenantId, id: body.client_id }, undefined, 1))[0];
  if (!client || client.tenant_id !== tenantId) throw httpError(404, 'Client not found');
  const approved = asList(await E.KycCase.filter({ tenant_id: tenantId, client_id: client.id, status: 'Approved' }, undefined, 1))[0];
  if (!approved) return { evaluated: false, reason: 'No approved KYC case yet', proposed: 0 };
  const change = body.change || {};
  const baseline = await latestBaseline(E, tenantId, client.id);
  const findings = baseline
    ? diffAgainstBaseline(baseline, client, await currentParties(E, tenantId, client.id))
    : await payloadFindings(E, tenantId, client, change);
  const created = await proposeTriggers(E, { tenantId, client, findings, sourceRef: String(change.source_ref || '').slice(0, 120) || undefined, actor: auth });
  return { evaluated: true, baseline: !!baseline, proposed: created.length, trigger_ids: created.map((t) => t.id) };
}

async function scanTenant(base44, tenant) {
  const E = base44.asServiceRole.entities;
  const tenantId = tenant.id;
  const decisions = asList(await E.Decision.filter({ tenant_id: tenantId, decision_type: 'kyc_approval', outcome: 'approved' }, '-decided_at', 5000));
  const latest = new Map();
  for (const d of decisions) if (d.client_id && !latest.has(d.client_id)) latest.set(d.client_id, d);
  let proposed = 0;
  let errors = 0;
  const results = await mapLimit([...latest.entries()], 4, async ([clientId, decision]) => {
    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: clientId }, undefined, 1))[0];
    if (!client || client.is_deleted) return 0;
    const findings = [
      ...diffAgainstBaseline(decision, client, await currentParties(E, tenantId, clientId)),
      ...await screeningFindings(E, tenantId, clientId, decision),
      ...await profileBreachFindings(E, tenantId, clientId),
    ];
    return (await proposeTriggers(E, { tenantId, client, findings, sourceRef: `scan:${new Date().toISOString().slice(0, 10)}`, actor: SYSTEM })).length;
  });
  for (const r of results) { if (r.ok) proposed += r.value; else { errors++; console.warn('EDR scan client failed:', r.error?.message); } }
  return { tenant_id: tenantId, clients: latest.size, proposed, errors };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const E = base44.asServiceRole.entities;
    const mode = body.mode;
    const user = await base44.auth.me().catch(() => null);
    const role = user?.app_role || user?.data?.app_role;

    if (mode === 'change') {
      if (!body.client_id) throw httpError(400, 'client_id is required');
      let auth;
      let tenantId;
      if (user) {
        auth = await authenticate(base44, req, body, { roles: EDIT_ROLES, allowApiKey: false });
        tenantId = auth.tenantId;
      } else {
        const c = asList(await E.Client.filter({ id: body.client_id }, undefined, 1))[0];
        if (!c) throw httpError(404, 'Client not found');
        tenantId = c.tenant_id;
        auth = { ...SYSTEM, actorName: 'EDR Trigger Check' };
      }
      const tenant = await loadTenant(base44, tenantId);
      if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
      return Response.json({ ok: true, mode, ...(await runChange(base44, auth, tenantId, body)) });
    }

    if (mode === 'scan') {
      let tenants;
      if (!user) {
        tenants = asList(await E.Tenant.filter({}, undefined, 1000));
      } else if (role === 'Vitauri Ops') {
        tenants = body.tenant_id ? [await loadTenant(base44, body.tenant_id)] : asList(await E.Tenant.filter({}, undefined, 1000));
      } else if (role === 'Tenant Admin') {
        const own = user.tenant_id || user.data?.tenant_id;
        if (body.tenant_id && body.tenant_id !== own) throw httpError(403, 'tenant_id does not match your tenant');
        tenants = [await loadTenant(base44, own)];
      } else {
        throw httpError(403, 'Forbidden');
      }
      const summary = [];
      for (const t of tenants.filter((x) => isTmEnabled(x, 'tm_core'))) summary.push(await scanTenant(base44, t));
      return Response.json({ ok: true, mode, tenants: summary });
    }

    throw httpError(400, "mode must be 'change' or 'scan'");
  } catch (error) {
    console.error('evaluateEdrTriggers error:', error?.message);
    return errorResponse(error);
  }
}
