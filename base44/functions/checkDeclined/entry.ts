// checkDeclined — intake warning on New Client: does this applicant match a declined / terminated relationship?
// Auth: signed-in createRunCase user; tenant from the user. Returns only { match, strength, info_only } — never the
// record, its reason or who was declined (DeclinedRecord is readable by Compliance only). The case flag itself is set by
// caseSignoffAction when the case is opened. Every positive check is audited.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { ANALYST_ROLES } from '../../shared/signoffRouting.js';
import { matchDeclined, requiresReview } from '../../shared/declinedMatch.js';

const s = (v, n = 200) => String(v ?? '').trim().slice(0, n);

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw httpError(401, 'Unauthorized');
    const role = user.app_role || user.data?.app_role;
    if (!ANALYST_ROLES.includes(role)) throw httpError(403, 'Forbidden');
    const tenantId = user.tenant_id || user.data?.tenant_id;
    const b = await req.json().catch(() => ({}));
    const subject = {
      client_type: b.client_type === 'ORG' ? 'ORG' : 'NP', name: s(b.full_name), date_of_birth: s(b.date_of_birth, 10) || null,
      document_numbers: [s(b.id_number, 60)].filter(Boolean), email: s(b.email, 200) || null, phone: s(b.phone, 40) || null,
      address: b.address && typeof b.address === 'object' ? b.address : null, registration_number: s(b.registration_number, 60) || null,
      registered_country: s(b.registered_country, 80) || null, people: [],
    };
    if (!subject.name && !subject.registration_number && !subject.document_numbers.length && !subject.email) return Response.json({ ok: true, match: false });
    const E = base44.asServiceRole.entities;
    const records = asList(await E.DeclinedRecord.filter({ tenant_id: tenantId }, '-created_date', 1000).catch(() => []));
    const matches = matchDeclined(subject, records);
    if (!matches.length) return Response.json({ ok: true, match: false });
    const review = requiresReview(matches);
    await E.AuditEvent.create({
      tenant_id: tenantId, actor_user_id: user.id, actor_name: user.full_name || user.email, actor_type: 'User', event_type: 'intake.declined_check_match',
      notes: `New-client intake matched ${matches.length} declined/terminated record(s) (${review ? 'strong' : 'possible'}).`, after_state: { strength: review ? 'strong' : 'possible', count: matches.length },
    }).catch(() => {});
    return Response.json({ ok: true, match: true, strength: review ? 'strong' : 'possible', info_only: matches.every((m) => m.info_only) });
  } catch (error) {
    console.error('checkDeclined error:', error?.message);
    return errorResponse(error);
  }
}
