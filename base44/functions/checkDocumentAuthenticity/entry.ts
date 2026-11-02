// checkDocumentAuthenticity — AI Document Checker Agent.
// Body: { document_id } | { case_id, all_unchecked: true } | { client_id, all_unchecked: true } | { sweep: true }.
// Signed-in users of the tenant (case workers) check their own tenant's documents; with no user (scheduled workflow)
// it sweeps new unchecked uploads across tenants, capped per run. Advisory only — see base44/shared/docCheckAgent.js.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { checkDocument, isCheckable } from '../../shared/docCheckAgent.js';

const WORKER_ROLES = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin', 'Vitauri Ops'];
const SWEEP_LIMIT = 20;
const USER_LIMIT = 15;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    const E = base44.asServiceRole.entities;

    let tenantId = null;
    if (user) {
      const role = user.app_role || user.data?.app_role;
      if (!WORKER_ROLES.includes(role)) throw httpError(403, 'Forbidden');
      tenantId = user.tenant_id || user.data?.tenant_id;
      if (!tenantId && role !== 'Vitauri Ops') throw httpError(403, 'No tenant associated with this user');
    } else if (!body.sweep) {
      throw httpError(401, 'Unauthorized');
    }

    let docs: any[] = [];
    if (body.document_id) {
      docs = asList(await E.Document.filter({ id: body.document_id }));
    } else if (body.case_id || body.client_id) {
      docs = asList(await E.Document.filter(body.case_id ? { case_id: body.case_id } : { client_id: body.client_id }));
      if (body.all_unchecked) docs = docs.filter((d) => !d.ai_check || d.ai_check.status === 'error');
      docs = docs.slice(0, USER_LIMIT);
    } else if (body.sweep) {
      // New uploads of the last 7 days without a check
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      docs = asList(await E.Document.filter({ created_date: { $gte: since } }, '-created_date', 200))
        .filter((d) => !d.ai_check)
        .filter((d) => !tenantId || d.tenant_id === tenantId)
        .slice(0, SWEEP_LIMIT * 3);
    } else {
      throw httpError(400, 'document_id, case_id, client_id or sweep is required');
    }

    if (tenantId) docs = docs.filter((d) => d.tenant_id === tenantId);
    if (body.document_id && !docs.length) throw httpError(404, 'Document not found');
    const todo = docs.filter(isCheckable).slice(0, body.sweep ? SWEEP_LIMIT : USER_LIMIT);
    if (body.document_id && !todo.length) throw httpError(400, 'This document is not checked by the AI Document Checker (Didit copy, report or generated file).');

    const tenants = new Map();
    const results = [];
    for (const doc of todo) {
      if (!tenants.has(doc.tenant_id)) tenants.set(doc.tenant_id, asList(await E.Tenant.filter({ id: doc.tenant_id }))[0] || null);
      const ctx = {
        base44, E, tenant: tenants.get(doc.tenant_id),
        actor: user ? { id: user.id, name: `${user.full_name || user.email} (AI Document Checker)`, type: 'AI_Agent' } : { name: 'AI Document Checker', type: 'AI_Agent' },
      };
      const r = await checkDocument(ctx, doc);
      results.push({ document_id: doc.id, file_name: doc.file_name, status: r.status, verdict: r.verdict || null, error: r.error || null });
    }
    return Response.json({ ok: true, checked: results.length, results });
  } catch (error) {
    console.error('checkDocumentAuthenticity error:', error?.message);
    return errorResponse(error);
  }
}
