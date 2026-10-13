// saveFiuProfile — audited save of one FIU profile plus its scenario-to-indicator mappings (one user action).
// Auth: signed-in Tenant Admin / Compliance Admin (tenantConfig). Tenant comes from the user, never the payload.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { writeAudit } from '../../shared/tmAudit.js';

const ROLES = ['Tenant Admin', 'Compliance Admin'];
const METHODS = ['portal_upload', 'xml_upload', 'm2m'];
const TYPES = ['objective', 'subjective'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v) => String(v ?? '').trim();
const num = (v, label) => {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw httpError(400, `${label} must be a non-negative number`);
  return n;
};
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function cleanProfile(p) {
  const codes = [];
  const seen = new Set();
  for (const c of Array.isArray(p.indicator_codes) ? p.indicator_codes : []) {
    const code = str(c.code);
    if (!code) throw httpError(400, 'Every indicator code needs a code');
    if (seen.has(code)) throw httpError(400, `Duplicate indicator code ${code}`);
    if (!TYPES.includes(c.type)) throw httpError(400, `Indicator ${code}: type must be objective or subjective`);
    seen.add(code);
    codes.push({ code, label: str(c.label), type: c.type, sector: str(c.sector) });
  }
  const holidays = [...new Set((p.holiday_calendar || []).map(str).filter(Boolean))];
  if (holidays.some((d) => !DATE.test(d) || Number.isNaN(Date.parse(d)))) throw httpError(400, 'Holiday dates must be valid YYYY-MM-DD dates');
  if (!METHODS.includes(p.submission_method)) throw httpError(400, 'Invalid submission method');
  const ids = p.didit_template_ids || {};
  const out = {
    law: str(p.law), language: str(p.language), system: str(p.system) || 'goAML',
    objective_deadline_hours: num(p.objective_deadline_hours, 'Objective deadline'),
    subjective_escalation_hours: num(p.subjective_escalation_hours, 'Subjective escalation'),
    co_investigation_working_days: num(p.co_investigation_working_days, 'CO investigation days'),
    report_deadline_hours: num(p.report_deadline_hours, 'Report deadline'),
    report_without_delay: !!p.report_without_delay,
    submission_method: p.submission_method,
    didit_template_ids: { unusual_objective: str(ids.unusual_objective), unusual_subjective: str(ids.unusual_subjective) },
    holiday_calendar: holidays.sort(),
    notes: str(p.notes),
    mandatory_fields: [...new Set((p.mandatory_fields || []).map(str).filter(Boolean))],
    indicator_codes: codes,
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_fiu')) throw httpError(403, 'Feature tm_fiu is not enabled');
    const E = base44.asServiceRole.entities;

    const profile = asList(await E.FiuProfile.filter({ tenant_id: tenantId, id: body.profile_id }, undefined, 1))[0];
    if (!profile || profile.tenant_id !== tenantId) throw httpError(404, 'FIU profile not found');
    const next = cleanProfile(body.profile || {});
    const validCodes = new Set(next.indicator_codes.map((c) => c.code));

    const scenarios = asList(await E.TmScenario.filter({ tenant_id: tenantId }, undefined, 1000));
    const wanted = new Map((Array.isArray(body.mappings) ? body.mappings : []).map((m) => [m.scenario_id, m.codes]));
    for (const id of wanted.keys()) if (!scenarios.some((s) => s.id === id)) throw httpError(404, 'Scenario not found');

    const before = {}; const after = {}; const changes = [];
    for (const s of scenarios) {
      const current = s.fiu_indicator_codes?.[profile.code] || [];
      const target = (wanted.has(s.id) ? wanted.get(s.id) || [] : current).map(str).filter((c) => validCodes.has(c));
      const unique = [...new Set(target)];
      if (same(current, unique)) continue;
      changes.push({ s, unique });
      before[s.code] = current; after[s.code] = unique;
    }

    const prevProfile = {};
    for (const k of Object.keys(next)) prevProfile[k] = profile[k];
    await E.FiuProfile.update(profile.id, next);
    for (const { s, unique } of changes) {
      await E.TmScenario.update(s.id, { fiu_indicator_codes: { ...(s.fiu_indicator_codes || {}), [profile.code]: unique } });
    }
    await writeAudit(base44, auth, {
      tenantId, eventType: 'fiu_profile_saved',
      before: { profile: prevProfile, scenario_mappings: before },
      after: { profile: next, scenario_mappings: after },
      notes: `FIU profile ${profile.code} saved by ${auth.actorName}; ${changes.length} scenario mapping(s) changed.`,
    });
    return Response.json({ ok: true, scenarios_changed: changes.length });
  } catch (error) {
    console.error('saveFiuProfile error:', error?.message);
    return errorResponse(error);
  }
}