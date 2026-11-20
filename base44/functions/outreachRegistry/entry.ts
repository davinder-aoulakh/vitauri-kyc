// outreachRegistry — public: the company-registry search of the current `registry` step of a guided conversation
// (plan phase 6: KvK for the Netherlands in Live/Test, Didit for other covered countries). Access is the link token alone.
// Body: { token, step_id, action: 'search' | 'select', q?, id? }
//   search  KvK: typeahead (>= 2 chars, free in test). Didit: on the Search button, at most settings.registrySearchLimit per
//           conversation ($0.50 per successful search in live; sandbox free).
//   select  KvK: Basisprofiel (EUR 0.02 live) + the directors proposal from one Didit lookup of the same KvK number when
//           settings.directorsFromDidit; Didit: the Lite profile with officers (country's Lite price in live).
// The selected company is stored in the conversation state; the answer then goes through outreachPortal with { selected: true }.
// Every provider call writes an OutreachAdapterCall row (never the key). Failures fail soft: { ok:false, fallback:true }.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { looksLikeToken, hashToken, linkState, createAttemptLimiter } from '../../shared/outreachToken.js';
import { withDiditCredentials } from '../../shared/diditCredentials.js';
import { diditSearch, diditSelect } from '../../shared/outreachAdapters/diditRegistry.js';
import { kvkSearch, kvkProfile } from '../../shared/outreachAdapters/kvk.js';
import { MESSAGES } from '../../shared/outreachMessages.js';

const limiter = createAttemptLimiter({ max: 60, windowMs: 15 * 60 * 1000 });
const NOT_FOUND = 'This link is not valid. Please use the link from your most recent email.';
const hashOf = async (o) => { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(o ?? null))); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 32); };

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const E = base44.asServiceRole.entities;
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
    const token = String(body.token || '');
    if (limiter.blocked(`ip:${ip}`)) throw httpError(429, 'Too many attempts. Please wait a few minutes and try again.');
    if (!looksLikeToken(token)) { limiter.fail(`ip:${ip}`); throw httpError(404, NOT_FOUND); }
    const request = asList(await E.OutreachRequest.filter({ token_hash: await hashToken(token) }, undefined, 1))[0];
    if (!request || request.engine !== 'conversation') { limiter.fail(`ip:${ip}`); throw httpError(404, NOT_FOUND); }
    const conversation = request.conversation_id ? asList(await E.OutreachConversation.filter({ tenant_id: request.tenant_id, id: request.conversation_id }, undefined, 1))[0] : null;
    if (!conversation || linkState(request, conversation, new Date()) !== 'valid') throw httpError(409, MESSAGES.notCurrent);
    const ps = conversation.pending_step || {};
    const step = ps.step;
    const engine = ps.engine || {};
    if (!step || step.widget !== 'registry_search' || String(body.step_id || '') !== step.id) throw httpError(409, MESSAGES.notCurrent);
    const tenantId = conversation.tenant_id;
    const settings = conversation.settings_snapshot || {};
    const costs = settings.adapterCosts || {};
    const tenant = asList(await E.Tenant.filter({ id: tenantId }, undefined, 1))[0] || null;
    const secret = asList(await E.TenantSecret.filter({ tenant_id: tenantId }, undefined, 1))[0] || null;
    const kvkMode = secret?.kvk_mode === 'live' ? 'live' : 'test';
    const diditKey = (await withDiditCredentials(base44, tenant))?.didit_api_key || '';
    const route = engine.route;
    const iso2 = engine.country_iso2 || 'NL';

    const logCall = async (vendor, operation, r, started, { sandbox = false, cost = 0 } = {}) => {
      await E.OutreachAdapterCall.create({
        tenant_id: tenantId, conversation_id: conversation.id, vendor, operation, environment: vendor === 'kvk' ? kvkMode : (sandbox ? 'test' : 'live'),
        cost_eur: r.ok && !sandbox ? cost : 0, cost_basis: r.ok ? (sandbox ? 'sandbox (free)' : `settings.adapterCosts`) : `failed: ${r.error_code || 'error'}`,
        status: r.ok ? 'ok' : 'error', response_hash: await hashOf(r.ok ? (r.candidates || r.company || null) : null), duration_ms: Date.now() - started,
      }).catch((e) => console.warn('adapter log failed', e?.message));
    };
    const save = async (patch) => {
      const next = { ...engine, reg: { ...(engine.reg || {}), ...patch } };
      await E.OutreachConversation.update(conversation.id, { pending_step: { ...ps, engine: next, rev: Number(ps.rev || 0) + 1 } });
      return next.reg;
    };

    if (body.action === 'search') {
      const q = String(body.q || '').trim().slice(0, 120);
      const t0 = Date.now();
      if (route === 'nl') {
        const r = await kvkSearch({ mode: kvkMode, apiKey: secret?.kvk_api_key || '', q });
        if (q.length >= 2) await logCall('kvk', 'zoeken', r, t0, { cost: costs.kvk_search || 0 });
        if (!r.ok) return Response.json({ ok: false, fallback: true, message: MESSAGES.cannotFind });
        await save({ candidates: r.candidates });
        return Response.json({ ok: true, candidates: r.candidates });
      }
      const limit = Number(settings.registrySearchLimit) || 3;
      const used = engine.reg?.searches || 0;
      if (used >= limit) return Response.json({ ok: false, limit_reached: true, searches_left: 0 });
      if (q.length < 2) throw httpError(400, MESSAGES.required);
      if (!diditKey) return Response.json({ ok: false, fallback: true });
      const r = await diditSearch({ apiKey: diditKey, country_code: iso2, ...(/\d{5,}/.test(q) && !/[a-z]{3,}/i.test(q) ? { registration_number: q } : { name: q }) });
      const sandbox = (r.candidates || []).some((c) => String(c.id).startsWith('sandbox-'));
      await logCall('didit', 'kyb_search', r, t0, { sandbox, cost: r.ok && r.candidates?.length ? (costs.didit_search ?? 0.5) : 0 });
      if (!r.ok) return Response.json({ ok: false, fallback: r.status === 400 || r.status === 404, message: r.message });
      const reg = await save({ candidates: r.candidates, searches: used + 1, pending_search: !r.resolved });
      return Response.json({ ok: true, candidates: r.candidates, resolved: r.resolved, searches_left: Math.max(0, limit - reg.searches) });
    }

    if (body.action === 'select') {
      const id = String(body.id || '');
      const cand = (engine.reg?.candidates || []).find((c) => String(c.id) === id);
      if (!cand) throw httpError(400, 'Pick an organisation from the list');
      const t0 = Date.now();
      let company;
      if (route === 'nl') {
        const r = await kvkProfile({ mode: kvkMode, apiKey: secret?.kvk_api_key || '', kvk: cand.number });
        await logCall('kvk', 'basisprofiel', r, t0, { cost: costs.kvk_profile ?? 0.02 });
        if (!r.ok) return Response.json({ ok: false, fallback: true });
        company = { ...r.company, co_status: cand.status === 'Inactive' && r.company.co_status === 'Active' ? 'Inactive' : r.company.co_status };
        // KvK returns no directors: one Didit lookup of the same KvK number for the proposal (setting directorsFromDidit).
        if (settings.directorsFromDidit !== false && diditKey) {
          const t1 = Date.now();
          const s = await diditSearch({ apiKey: diditKey, country_code: 'NL', registration_number: cand.number });
          const sb = (s.candidates || []).some((c) => String(c.id).startsWith('sandbox-'));
          await logCall('didit', 'kyb_search', s, t1, { sandbox: sb, cost: s.ok && s.candidates?.length ? (costs.didit_search ?? 0.5) : 0 });
          const hit = (s.candidates || []).find((c) => String(c.number).replace(/\D/g, '') === String(cand.number)) || (sb ? s.candidates?.[0] : null);
          if (hit) {
            const t2 = Date.now();
            const d = await diditSelect({ apiKey: diditKey, kyb_response_id: hit.id });
            await logCall('didit', 'kyb_select', d, t2, { sandbox: d.sandbox, cost: costs.didit_select ?? 2 });
            if (d.ok) company.officers = d.company.officers;
          }
        }
      } else {
        if (!diditKey) return Response.json({ ok: false, fallback: true });
        const r = await diditSelect({ apiKey: diditKey, kyb_response_id: id });
        await logCall('didit', 'kyb_select', r, t0, { sandbox: r.sandbox || id.startsWith('sandbox-'), cost: costs.didit_select ?? 2 });
        if (!r.ok) return Response.json({ ok: false, fallback: true, message: r.message });
        company = r.company;
        if (r.pending) await save({ pending_select: { request_id: r.request_id, since: new Date().toISOString() } });
      }
      await save({ selected: company, candidates: [] });
      return Response.json({ ok: true, selected: { name: company.legal_name, number: company.reg_no, status: company.co_status } });
    }

    throw httpError(400, 'Unknown action');
  } catch (error) {
    if (!error?.status || error.status >= 500) console.error('outreachRegistry error:', error?.message);
    return errorResponse(error);
  }
}
