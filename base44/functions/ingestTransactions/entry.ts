// ingestTransactions — public HTTPS ingest endpoint.
// Auth: Authorization: Bearer <tenant API key>, OR a signed-in user with tmManageIngest.
// Tenant scope comes only from the verified key / the user's own tenant, never from the payload.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { sha256Hex } from '../../shared/tmCanonical.js';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { extractBearer } from '../../shared/tmApiKeys.js';
import {
  authenticate, errorResponse, httpError, invokeNext, loadTenant, chunk, asList, INGEST_ROLES,
} from '../../shared/tmAuth.js';

const MAX_ITEMS = 1000;
const CALL_SIZE = 200; // normaliseTransactions limit per call
const RATE_LIMIT = 60;
const DAY_MS = 86400000;
const LIFECYCLES = ['intended', 'declined', 'booked', 'reversed', 'corrected'];
const isId = (v) => typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v);
const validDate = (v) => v && !isNaN(new Date(v).getTime());

async function resolveAuth(base44, req, body) {
  const bearer = extractBearer(req);
  if (!bearer) return authenticate(base44, req, {}, { roles: INGEST_ROLES, allowApiKey: false });
  const hash = await sha256Hex(bearer);
  const keys = asList(await base44.asServiceRole.entities.TenantApiKey.filter({ key_hash: hash }, undefined, 1));
  const key = keys[0];
  if (!key || key.revoked_at || !key.tenant_id) throw httpError(401, 'Invalid or revoked API key');
  if (!(key.scopes || ['ingest:write']).includes('ingest:write')) throw httpError(403, 'API key lacks scope ingest:write');
  return {
    mode: 'api_key', tenantId: key.tenant_id, actorType: 'System', actorName: `API key ${key.key_prefix || key.id}`,
    actorUserId: undefined, apiKeyId: key.id, apiKeyRaw: bearer,
  };
}

function toNormaliseItem(t) {
  const cp = t.counterparty && typeof t.counterparty === 'object' ? t.counterparty : {};
  const lifecycle = t.lifecycle || 'booked';
  const intendedAt = validDate(t.intended_at) ? new Date(t.intended_at).toISOString() : undefined;
  const executedAt = t.executed_at || (lifecycle === 'intended' ? t.intended_at : undefined);
  const historical = lifecycle === 'intended'
    ? false
    : (validDate(executedAt) && Date.now() - new Date(executedAt).getTime() > 7 * DAY_MS);
  return {
    external_id: t.external_id, client_id: t.client_id, iban_or_number: t.account, lifecycle,
    intended_at: intendedAt, executed_at: executedAt, direction: t.direction, amount: t.amount, currency: t.currency,
    description_raw: t.description, counterparty_name: cp.name, counterparty_account_id: cp.account,
    counterparty_country: cp.country, historical,
  };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const auth = await resolveAuth(base44, req, null);
    const tenantId = auth.tenantId;
    const E = base44.asServiceRole.entities;

    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_ingest_api')) throw httpError(403, 'Feature tm_ingest_api is not enabled');

    // ── Validate payload (before any batch is created or rate-limit is consumed) ──
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') throw httpError(400, 'Request body must be JSON');
    const { batch_ref, transactions } = body;
    if (batch_ref !== undefined && (typeof batch_ref !== 'string' || batch_ref.length > 128)) throw httpError(400, 'batch_ref must be a string (max 128 chars)');
    if (!Array.isArray(transactions) || transactions.length === 0) throw httpError(400, 'transactions must be a non-empty array');
    if (transactions.length > MAX_ITEMS) throw httpError(413, `Max ${MAX_ITEMS} transactions per request`);

    const problems = [];
    transactions.forEach((t, index) => {
      if (!t || typeof t !== 'object' || Array.isArray(t)) { problems.push({ index, reason: 'transaction must be an object' }); return; }
      if (!isId(t.client_id)) problems.push({ index, reason: 'client_id missing or malformed' });
      if (t.lifecycle !== undefined && !LIFECYCLES.includes(t.lifecycle)) problems.push({ index, reason: `lifecycle must be one of ${LIFECYCLES.join(', ')}` });
    });
    if (problems.length === 0) {
      const ids = [...new Set(transactions.map((t) => t.client_id))];
      const owned = new Set();
      for (const c of chunk(ids, 100)) {
        for (const cl of asList(await E.Client.filter({ tenant_id: tenantId, id: { $in: c } }, undefined, 100))) owned.add(cl.id);
      }
      transactions.forEach((t, index) => { if (!owned.has(t.client_id)) problems.push({ index, reason: 'client_id does not belong to this tenant' }); });
    }
    if (problems.length) {
      return Response.json({ error: 'Invalid payload', invalid: problems.slice(0, 100), invalid_count: problems.length }, { status: 422 });
    }

    // ── Rate limit: valid payloads only (each valid request creates one batch) ──
    const since = new Date(Date.now() - 60000).toISOString();
    const recentQuery = auth.mode === 'api_key'
      ? { tenant_id: tenantId, api_key_id: auth.apiKeyId, created_date: { $gte: since } }
      : { tenant_id: tenantId, channel: 'api', api_key_id: { $exists: false }, created_date: { $gte: since } };
    const recent = asList(await E.TransactionIngestBatch.filter(recentQuery, undefined, RATE_LIMIT + 1));
    if (recent.length > RATE_LIMIT) {
      return Response.json({ error: `Rate limit exceeded (${RATE_LIMIT} requests per minute)` }, { status: 429, headers: { 'Retry-After': '60' } });
    }

    // ── Batch + normalisation ──
    const batch = await E.TransactionIngestBatch.create({
      tenant_id: tenantId, channel: 'api', source_ref: batch_ref, api_key_id: auth.apiKeyId,
      received_count: 0, accepted_count: 0, duplicate_count: 0, rejected: [],
      started_at: new Date().toISOString(), status: 'running',
    });

    let accepted = 0, duplicates = 0;
    const rejected = [];
    const items = transactions.map(toNormaliseItem);
    try {
      let offset = 0;
      for (const part of chunk(items, CALL_SIZE)) {
        const out = await invokeNext(base44, auth, 'normaliseTransactions', { channel: 'api', batch_id: batch.id, items: part });
        if (out?.error) throw new Error(out.error);
        accepted += out.accepted || 0;
        duplicates += out.duplicates || 0;
        for (const r of out.rejected || []) rejected.push({ index: (r.index ?? 0) + offset, reason: r.reason });
        offset += part.length;
      }
    } catch (e) {
      await E.TransactionIngestBatch.update(batch.id, { status: 'failed', finished_at: new Date().toISOString() });
      throw httpError(502, `Ingestion failed: ${String(e?.message || e).slice(0, 200)}`);
    }

    if (auth.mode === 'api_key') await E.TenantApiKey.update(auth.apiKeyId, { last_used_at: new Date().toISOString() });

    return Response.json({ batch_id: batch.id, accepted, duplicates, rejected }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}