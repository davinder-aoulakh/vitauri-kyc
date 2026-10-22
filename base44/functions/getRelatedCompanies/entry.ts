// getRelatedCompanies — read-only: counterparties on this client's transactions that look like related companies.
// A counterparty matches when its name equals a company RelatedParty (party_type ORG) linked to the client, or when one of
// its identifiers equals an identifier of another client of the tenant (bank account, registration number, LEI, TIN).
// Requires tm_core. Writes nothing (no AuditEvent).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { errorResponse, httpError, loadTenant, asList, chunk } from '../../shared/tmAuth.js';
import { authorizeCaller } from '../../shared/customerFile.js';
import { normaliseAccount } from '../../shared/tmCounterparty.js';

const LEGAL_SUFFIX = /\b(b\.?v\.?|n\.?v\.?|ltd|limited|llc|inc|gmbh|s\.?a\.?|ag|plc|co|corp|company|holding|holdings)\b/g;
const normName = (s) => String(s || '').toLowerCase().replace(LEGAL_SUFFIX, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    if (!body.client_id) throw httpError(400, 'client_id is required');
    const E = base44.asServiceRole.entities;
    const { tenantId } = await authorizeCaller(base44, req, body, async () => {
      const c = asList(await E.Client.filter({ id: body.client_id }, undefined, 1))[0];
      if (!c) throw httpError(404, 'Client not found');
      return c.tenant_id;
    });
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: body.client_id }, undefined, 1))[0];
    if (!client) throw httpError(404, 'Client not found');
    const cid = client.id;

    // Counterparties seen on this client's transactions.
    const txns = asList(await E.Transaction.filter({ tenant_id: tenantId, client_id: cid }, { limit: 1000, fields: ['counterparty_id'] }));
    const cpIds = [...new Set(txns.map((t) => t.counterparty_id).filter(Boolean))];
    const cps = [];
    for (const part of chunk(cpIds, 100).slice(0, 5)) {
      cps.push(...asList(await E.Counterparty.filter({ tenant_id: tenantId, id: { $in: part } }, undefined, 100)));
    }
    if (!cps.length) return Response.json({ related_companies: [] });

    // Company related parties of this client.
    const links = asList(await E.ClientRelatedPartyLink.filter({ tenant_id: tenantId, client_id: cid }, undefined, 200));
    const partyIds = [...new Set(links.map((l) => l.related_party_id).filter(Boolean))];
    const parties = partyIds.length
      ? asList(await E.RelatedParty.filter({ tenant_id: tenantId, id: { $in: partyIds }, party_type: 'ORG' }, undefined, 200)) : [];
    const partyByName = new Map(parties.map((p) => [normName(p.full_name), p]).filter(([k]) => k));

    // Identifiers of other clients of the tenant.
    const identOwners = new Map();
    const addIdent = (value, type, owner) => {
      const v = normaliseAccount(value);
      if (v.length >= 4 && owner.id !== cid && !identOwners.has(v)) identOwners.set(v, { type, client_id: owner.id, client_name: owner.full_name || null });
    };
    const others = asList(await E.Client.filter({ tenant_id: tenantId }, { limit: 2000, fields: ['id', 'full_name', 'registration_number', 'lei_code', 'tin', 'is_deleted'] }))
      .filter((c) => c.id !== cid && !c.is_deleted);
    const othersById = new Map(others.map((c) => [c.id, c]));
    for (const o of others) {
      addIdent(o.registration_number, 'registration_number', o);
      addIdent(o.lei_code, 'lei_code', o);
      addIdent(o.tin, 'tin', o);
    }
    const accounts = asList(await E.BankAccount.filter({ tenant_id: tenantId }, { limit: 2000, fields: ['client_id', 'iban_or_number'] }));
    for (const a of accounts) {
      const owner = othersById.get(a.client_id);
      if (owner) addIdent(a.iban_or_number, 'bank_account', owner);
    }

    const out = [];
    for (const cp of cps) {
      if (cp.merged_into) continue;
      const reasons = [];
      for (const n of [cp.display_name, ...(cp.names || [])]) {
        const p = partyByName.get(normName(n));
        if (p && !reasons.some((r) => r.related_party_id === p.id)) reasons.push({ type: 'related_party', related_party_id: p.id, name: p.full_name });
      }
      for (const i of cp.identifiers || []) {
        const hit = identOwners.get(normaliseAccount(i.value));
        if (hit) reasons.push({ type: 'identifier', identifier_type: hit.type, client_id: hit.client_id, client_name: hit.client_name });
      }
      if (reasons.length) out.push({ id: cp.id, display_name: cp.display_name, entity_kind: cp.entity_kind || null, screening_status: cp.screening_status || null, reasons });
    }
    return Response.json({ related_companies: out.slice(0, 50) });
  } catch (error) {
    console.error('getRelatedCompanies error:', error?.message);
    return errorResponse(error);
  }
}
