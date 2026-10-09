import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

const NOTE_CODES = 'Indicator codes must be filled from the official FIU lists.';

const RISKS = [
  ['R-01', 'Money mule / pass-through'],
  ['R-07', 'Structuring under threshold'],
  ['R-10', 'High-risk geography'],
  ['R-14', 'Layering via companies'],
  ['R-18', 'Trade-based ML'],
  ['R-21', 'Unusual vs peers'],
  ['R-30', 'Deviation from expected profile'],
];

// [code, name, riskCode, jurisdiction, indicator_type]
const SCENARIOS = [
  ['S-07a', 'Smurfing via private senders', 'R-07', 'ALL', 'subjective'],
  ['S-11', 'Rapid in/out', 'R-01', 'ALL', 'subjective'],
  ['S-12', 'New high-risk country', 'R-10', 'ALL', 'subjective'],
  ['S-14', 'Circular multi-step', 'R-14', 'ALL', 'subjective'],
  ['S-18', 'Invoice mismatch', 'R-18', 'ALL', undefined],
  ['S-21', 'Peer group', 'R-21', 'ALL', undefined],
  ['S-30', 'Profile deviation', 'R-30', 'ALL', undefined],
  ['S-CW-OBJ-CASH', 'Cash above objective threshold', undefined, 'CW', 'objective'],
];

const MANDATORY_FIELDS = [
  'reporting_entity.id',
  'report.type',
  'report.indicator',
  't_person.first_name',
  't_person.last_name',
  't_person.birthdate',
  't_person.nationality1',
  't_person.identification.number',
  't_person.addresses.address.address',
  't_from_my_client.from_account.account',
  'transaction.date_transaction',
  'transaction.amount_local',
  'transaction.currency_code',
  'report.reason',
];

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const callerTenantId = user.tenant_id || user.data?.tenant_id;
    const appRole = user.app_role || user.data?.app_role;
    const isOps = appRole === 'Vitauri Ops';
    if (!isOps && appRole !== 'Tenant Admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    let body = {};
    try { body = await req.json(); } catch { body = {}; }

    let tenantId = callerTenantId;
    if (body?.tenant_id) {
      if (!isOps && body.tenant_id !== callerTenantId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      tenantId = body.tenant_id;
    }
    if (!tenantId) return Response.json({ error: 'No tenant resolved' }, { status: 400 });

    const db = base44.asServiceRole.entities;
    const q = { tenant_id: tenantId };

    const [existingRisks, existingScenarios, existingProfiles] = await Promise.all([
      db.TmRisk.filter(q, { limit: 1000 }),
      db.TmScenario.filter(q, { limit: 1000 }),
      db.FiuProfile.filter(q, { limit: 100 }),
    ]);
    const riskItems = existingRisks.items || existingRisks;
    const scenarioItems = existingScenarios.items || existingScenarios;
    const profileItems = existingProfiles.items || existingProfiles;

    const riskIdByCode = {};
    for (const r of riskItems) riskIdByCode[r.code] = r.id;

    const created = { risks: [], scenarios: [], fiu_profiles: [] };

    for (const [code, name] of RISKS) {
      if (riskIdByCode[code]) continue;
      const rec = await db.TmRisk.create({ tenant_id: tenantId, code, name, is_active: true });
      riskIdByCode[code] = rec.id;
      created.risks.push(code);
    }

    const scenarioCodes = new Set(scenarioItems.map((s) => s.code));
    for (const [code, name, riskCode, jurisdiction, indicatorType] of SCENARIOS) {
      if (scenarioCodes.has(code)) continue;
      const rec = {
        tenant_id: tenantId,
        code,
        name,
        jurisdiction,
        is_library: true,
        fiu_indicator_codes: { CW: [], NL: [] },
        description: `${name}. ${NOTE_CODES}`,
      };
      if (riskCode) rec.risk_id = riskIdByCode[riskCode];
      if (indicatorType) rec.indicator_type = indicatorType;
      await db.TmScenario.create(rec);
      created.scenarios.push(code);
    }

    const profileCodes = new Set(profileItems.map((p) => p.code));
    if (!profileCodes.has('CW')) {
      await db.FiuProfile.create({
        tenant_id: tenantId,
        code: 'CW',
        name: 'FIU Curaçao',
        law: 'LMOT, LID',
        system: 'goAML',
        language: '',
        objective_deadline_hours: 48,
        subjective_escalation_hours: 24,
        co_investigation_working_days: 10,
        report_deadline_hours: 48,
        submission_method: 'portal_upload',
        mandatory_fields: MANDATORY_FIELDS,
        notes: 'Deadlines per blueprint v3; confirm against FIU guidance. Banks have exceptions for objective reports.',
      });
      created.fiu_profiles.push('CW');
    }
    if (!profileCodes.has('NL')) {
      await db.FiuProfile.create({
        tenant_id: tenantId,
        code: 'NL',
        name: 'FIU-Nederland',
        law: 'Wwft',
        system: 'goAML',
        language: 'nl',
        report_without_delay: true,
        submission_method: 'xml_upload',
        mandatory_fields: MANDATORY_FIELDS,
        notes: 'Report without delay once the unusual nature is known.',
      });
      created.fiu_profiles.push('NL');
    }

    await db.AuditEvent.create({
      tenant_id: tenantId,
      actor_type: 'User',
      actor_user_id: user.id,
      actor_name: user.full_name || user.email,
      event_type: 'tm_library_seeded',
      before_state: {
        risks: riskItems.length,
        scenarios: scenarioItems.length,
        fiu_profiles: profileItems.length,
      },
      after_state: created,
      notes: `Seeded TM library: ${created.risks.length} risks, ${created.scenarios.length} scenarios, ${created.fiu_profiles.length} FIU profiles created.`,
    });

    return Response.json({ tenant_id: tenantId, created });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}