// kybReview — what Didit is still waiting on in a KYB session, and whether a Vitauri reviewer may accept it.
// Pure; the same rules are copied in base44/shared/kybReview.js (keep both in sync).

export const PENDING_STATUSES = ['Not Started', 'In Progress', 'Awaiting User', 'In Review', 'Resubmitted'];

const CHECK_LABELS = {
  registry_checks: 'Registry check',
  document_verifications: 'Company documents',
  aml_screenings: 'Company AML screening',
  key_people_checks: 'Key people check',
};

const CHECK_HINTS = {
  key_people_checks: 'Didit holds the session for a manual review of the directors / UBOs in the Didit console.',
  document_verifications: 'Didit is reviewing the uploaded company documents.',
  aml_screenings: 'Didit found possible AML matches on the company that need a review.',
  registry_checks: 'Didit could not fully confirm the company in the registry.',
};

const isKeyRole = (role) => /ubo|beneficial|director|board/i.test(role || '');

/** Didit checks that are not Approved: [{ group, label, status, hint }] */
export function openChecks(kyb) {
  const fs = kyb?.feature_statuses || {};
  const out = [];
  for (const [group, rows] of Object.entries(fs)) {
    for (const r of Array.isArray(rows) ? rows : []) {
      if (r?.status && r.status !== 'Approved') {
        out.push({ group, label: CHECK_LABELS[group] || group.replace(/_/g, ' '), status: r.status, hint: CHECK_HINTS[group] || '' });
      }
    }
  }
  return out;
}

/**
 * Whether a reviewer may accept the KYB in Vitauri. Returns { ok, reasons[] }.
 * people: [{ full_name, role, verification_status }] linked to the client.
 */
export function acceptReadiness(kyb, people) {
  const reasons = [];
  if (!kyb) return { ok: false, reasons: ['No business verification'] };
  if (kyb.status !== 'In Review') reasons.push(`Didit status is ${kyb.status || 'unknown'}, not In Review`);
  const open = openChecks(kyb);
  const other = open.filter((c) => c.group !== 'key_people_checks');
  if (other.length) reasons.push(`Didit still has open checks: ${other.map((c) => `${c.label} (${c.status})`).join(', ')}`);
  if (!open.some((c) => c.group === 'key_people_checks') && kyb.status === 'In Review') reasons.push('Didit is not waiting on the key people check');
  if ((Number(kyb.aml?.total_hits) || 0) > 0 && kyb.aml?.status !== 'Approved') reasons.push('Company AML has open hits');
  const key = (people || []).filter((p) => isKeyRole(p.role || p.role_in_relationship));
  if (!key.length) reasons.push('No UBO or director is linked to the client');
  const unverified = key.filter((p) => p.verification_status !== 'Verified');
  if (unverified.length) reasons.push(`Not verified in Vitauri: ${unverified.map((p) => p.full_name).join(', ')}`);
  return { ok: reasons.length === 0, reasons };
}
