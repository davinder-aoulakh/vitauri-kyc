// Add or update a related party from a suggestion (Didit KYB registry, document OCR) without creating duplicates.
// A party already linked to the client is matched by normalised name (and date of birth when both have one);
// only the fields the analyst accepted are written. Every change is audited.
import { base44 } from '@/api/base44Client';
import { reportEdrChange } from '@/lib/edrChange';
import { parseRoles, joinRoles, mergeRoles, linkRoles } from '@/lib/partyRoles';

const asList = (r) => (Array.isArray(r) ? r : r?.items || []);
export const normName = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Linked related parties of a client: [{ rp, link }]. */
export async function loadLinkedParties(tenantId, clientId) {
  const links = asList(await base44.entities.ClientRelatedPartyLink.filter({ tenant_id: tenantId, client_id: clientId }));
  const ids = [...new Set(links.map((l) => l.related_party_id).filter(Boolean))];
  const parties = ids.length ? asList(await base44.entities.RelatedParty.filter({ tenant_id: tenantId, id: { $in: ids } })) : [];
  return links.map((link) => ({ link, rp: parties.find((p) => p.id === link.related_party_id) })).filter((x) => x.rp);
}

export function findLinkedMatch(linked, candidate) {
  return linked.find(({ rp }) => normName(rp.full_name) === normName(candidate.full_name)
    && (!candidate.date_of_birth || !rp.date_of_birth || String(rp.date_of_birth).slice(0, 10) === String(candidate.date_of_birth).slice(0, 10))) || null;
}

const LINK_FIELDS = ['role_in_relationship', 'ownership_percentage'];
const PARTY_FIELDS = ['nationality', 'date_of_birth', 'registration_number', 'role_in_relationship', 'ownership_percentage'];

/**
 * candidate: { full_name, party_type, role_in_relationship, ownership_percentage, nationality, date_of_birth, registration_number, source_type }
 * acceptFields: for an existing party, the keys to take from the candidate (default: all differing ones the caller passes).
 * Returns { rp, created, updatedFields }.
 */
// Adds already running per client + person. A second call for the same person (double click, two Add buttons,
// parallel accepts) waits for the first and then finds it linked, instead of creating a duplicate.
const inFlight = new Map();

export function upsertRelatedParty(args) {
  const key = `${args.clientId}|${normName(args.candidate?.full_name)}`;
  const prev = inFlight.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(() => doUpsert(args));
  inFlight.set(key, run);
  run.finally(() => { if (inFlight.get(key) === run) inFlight.delete(key); }).catch(() => {});
  return run;
}

async function doUpsert({ tenant, tenantId, clientId, caseId, currentUser, candidate, matchRpId, acceptFields }) {
  const linked = await loadLinkedParties(tenantId, clientId);
  const match = (matchRpId && linked.find((x) => x.rp.id === matchRpId)) || findLinkedMatch(linked, candidate);
  const fromDidit = candidate.source_type === 'didit';
  const ownership = candidate.ownership_percentage != null && candidate.ownership_percentage !== '' && Number.isFinite(Number(candidate.ownership_percentage))
    ? Number(candidate.ownership_percentage) : undefined;
  const value = (k) => (k === 'ownership_percentage' ? ownership : (candidate[k] || undefined));
  const actor = { actor_user_id: currentUser?.id, actor_name: currentUser?.full_name, actor_type: 'User' };

  if (match) {
    const recordedRoles = linkRoles(match.link, match.rp);
    // A role from a source adds to the roles already recorded (Director + Shareholder + UBO); it never replaces them
    const mergedRoles = mergeRoles(recordedRoles, value('role_in_relationship'));
    const keys = (acceptFields || PARTY_FIELDS).filter((k) => value(k) !== undefined)
      .filter((k) => k !== 'role_in_relationship' || mergedRoles.length > recordedRoles.length);
    const rpPatch = Object.fromEntries(keys.filter((k) => PARTY_FIELDS.includes(k)).map((k) => [k, k === 'role_in_relationship' ? joinRoles(mergedRoles) : value(k)]));
    const linkPatch = {};
    if (keys.includes('role_in_relationship')) { linkPatch.role = joinRoles(mergedRoles); linkPatch.roles = mergedRoles; }
    if (keys.includes('ownership_percentage')) linkPatch.ownership_percentage = ownership;
    if (fromDidit && keys.length) rpPatch.didit_applied_fields = [...new Set([...(match.rp.didit_applied_fields || []), ...keys])];
    if (Object.keys(rpPatch).length) await base44.entities.RelatedParty.update(match.rp.id, rpPatch);
    if (Object.keys(linkPatch).length) await base44.entities.ClientRelatedPartyLink.update(match.link.id, linkPatch);
    if (keys.length) {
      const before = Object.fromEntries(keys.map((k) => [k, LINK_FIELDS.includes(k) ? (k === 'role_in_relationship' ? match.link.role ?? match.rp.role_in_relationship : match.link.ownership_percentage ?? match.rp.ownership_percentage) ?? null : match.rp[k] ?? null]));
      const after = Object.fromEntries(keys.map((k) => [k, k === 'role_in_relationship' ? joinRoles(mergedRoles) : value(k) ?? null]));
      await base44.entities.AuditEvent.create({
        tenant_id: tenantId, client_id: clientId, case_id: caseId || undefined, ...actor, event_type: 'related_party_updated_from_source',
        before_state: { related_party_id: match.rp.id, ...before }, after_state: { related_party_id: match.rp.id, ...after },
        notes: `${match.rp.full_name}: ${keys.join(', ')} updated from ${fromDidit ? 'the Didit KYB registry' : 'a document'}.`,
      });
      reportEdrChange(tenant, clientId, { type: 'related_party', source_ref: `related_party:${match.rp.id}`, before, after: { related_party_id: match.rp.id, full_name: match.rp.full_name, ...after } });
    }
    return { rp: { ...match.rp, ...rpPatch }, created: false, updatedFields: keys };
  }

  const roles = parseRoles(candidate.role_in_relationship);
  const role = roles.length ? joinRoles(roles) : 'Unknown';
  const rp = await base44.entities.RelatedParty.create({
    tenant_id: tenantId, party_type: candidate.party_type || 'NP', full_name: candidate.full_name,
    nationality: candidate.nationality || undefined, date_of_birth: candidate.date_of_birth || undefined,
    registration_number: candidate.registration_number || undefined, role_in_relationship: role,
    ownership_percentage: ownership, verification_status: 'Unverified',
    ...(fromDidit ? { didit_applied_fields: PARTY_FIELDS.filter((k) => value(k) !== undefined) } : {}),
  });
  await base44.entities.ClientRelatedPartyLink.create({
    tenant_id: tenantId, client_id: clientId, related_party_id: rp.id, role, roles, ownership_percentage: ownership, added_by_user_id: currentUser?.id,
  });
  await base44.entities.AuditEvent.create({
    tenant_id: tenantId, client_id: clientId, case_id: caseId || undefined, ...actor, event_type: 'related_party_created_and_linked',
    notes: `${candidate.full_name} added as ${role} from ${fromDidit ? 'the Didit KYB registry' : 'a document'}.`,
  });
  reportEdrChange(tenant, clientId, { type: 'related_party', source_ref: `related_party:${rp.id}`, before: null, after: { related_party_id: rp.id, full_name: rp.full_name, role, ownership_percentage: ownership ?? null } });
  return { rp, created: true, updatedFields: [] };
}
