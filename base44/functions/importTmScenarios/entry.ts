// importTmScenarios — loads official FIU indicator lists (Curaçao objective/subjective, Wwft) into the tenant's
// scenario library. Compliance supplies the rows; nothing is invented here. Upserts by (tenant_id, code).
//   { rows: [{ code, name, jurisdiction?, indicator_type?, fiu_codes?: string[] | string, description?, sector? }] }
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';

const ROLES = ['Compliance Admin', 'Compliance Officer', 'Tenant Admin'];
const JURISDICTIONS = ['CW', 'NL', 'ALL'];
const TYPES = ['objective', 'subjective'];
const MAX_ROWS = 500;

const text = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const codeList = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[;,|]/)).map((s) => text(s, 40)).filter(Boolean);

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_rules')) throw httpError(403, 'Feature tm_rules is not enabled');

    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) throw httpError(400, 'No rows to import');
    if (rows.length > MAX_ROWS) throw httpError(400, `At most ${MAX_ROWS} rows per import`);

    const E = base44.asServiceRole.entities;
    const existing = asList(await E.TmScenario.filter({ tenant_id: tenantId }, undefined, 2000));
    const byCode = new Map(existing.map((s) => [String(s.code).toUpperCase(), s]));

    const created = [];
    const updated = [];
    const skipped = [];
    const seen = new Set();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const code = text(r.code, 40);
      const name = text(r.name, 200);
      const jurisdiction = text(r.jurisdiction || 'ALL', 3).toUpperCase();
      const type = text(r.indicator_type, 20).toLowerCase();
      if (!code || !name) { skipped.push({ row: i + 1, reason: 'code and name are required' }); continue; }
      if (!JURISDICTIONS.includes(jurisdiction)) { skipped.push({ row: i + 1, reason: `jurisdiction must be one of ${JURISDICTIONS.join(', ')}` }); continue; }
      if (type && !TYPES.includes(type)) { skipped.push({ row: i + 1, reason: 'indicator_type must be objective or subjective' }); continue; }
      const key = code.toUpperCase();
      if (seen.has(key)) { skipped.push({ row: i + 1, reason: `duplicate code ${code} in this file` }); continue; }
      seen.add(key);

      const codes = codeList(r.fiu_codes ?? r.fiu_indicator_codes);
      const rec = {
        name, jurisdiction, is_library: true,
        ...(type ? { indicator_type: type } : {}),
        ...(r.description ? { description: text(r.description, 4000) } : {}),
        ...(r.sector ? { sector: text(r.sector, 100) } : {}),
      };
      const prev = byCode.get(key);
      if (codes.length) {
        // Codes are filed under the row's jurisdiction; an ALL row files them under both lists.
        const merged = { ...(prev?.fiu_indicator_codes || {}) };
        for (const j of jurisdiction === 'ALL' ? ['CW', 'NL'] : [jurisdiction]) merged[j] = codes;
        rec.fiu_indicator_codes = merged;
      }
      if (prev) {
        await E.TmScenario.update(prev.id, rec);
        updated.push(code);
      } else {
        await E.TmScenario.create({ tenant_id: tenantId, code, ...rec });
        created.push(code);
      }
    }

    await writeAudit(base44, auth, {
      tenantId, eventType: 'tm_scenarios_imported',
      after: { created, updated, skipped: skipped.length },
      notes: `Scenario library import by ${auth.actorName}: ${created.length} created, ${updated.length} updated, ${skipped.length} skipped.`,
    });
    return Response.json({ ok: true, created: created.length, updated: updated.length, skipped });
  } catch (error) {
    return errorResponse(error);
  }
}
