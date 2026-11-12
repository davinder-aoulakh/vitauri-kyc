// declinedMatch — re-application check against DeclinedRecord (build spec §9). Pure: no I/O, runs in Deno and node.
// matchDeclined(subject, records) -> [{ record_id, case_id, status, decided_at, strength: 'strong'|'possible', info_only, matched_on[] }]
// subject: { client_type, name, date_of_birth, document_numbers[], email, phone, address, registration_number, registered_country,
//            people: [{ name, date_of_birth }] }
// "Closed, not completed" records are linked as info only (no mandatory review). Internal reasons are never returned.

const LEGAL = /\b(b\.?v\.?|n\.?v\.?|ltd|limited|llc|inc|gmbh|s\.?a\.?|sarl|plc|vof|v\.o\.f\.|cv|c\.v\.|holding|group|corp(oration)?|co)\b\.?/gi;
export const normName = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const orgName = (s) => normName(String(s || '').replace(LEGAL, ' '));
const digits = (s) => String(s || '').replace(/\D/g, '');
const docNo = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const day = (d) => (d ? String(d).slice(0, 10) : '');
const email = (s) => String(s || '').trim().toLowerCase();
const phone = (s) => { const d = digits(s); return d.length >= 8 ? d.slice(-9) : ''; };
function addrKey(a) {
  if (!a) return '';
  if (typeof a === 'string') { const pc = a.toUpperCase().match(/\b\d{4}\s?[A-Z]{2}\b|\b\d{5}\b/); return pc ? `${pc[0].replace(/\s/g, '')}|${normName(a).split(' ').find((w) => /\d/.test(w)) || ''}` : ''; }
  const pc = String(a.zipcode || a.postal_code || a.postcode || '').toUpperCase().replace(/\s/g, '');
  return pc ? `${pc}|${digits(a.number || a.house_number || '')}` : '';
}
// Same person: normalised full name equal, or same first + last token, plus the same date of birth.
function samePersonName(a, b) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = x.split(' '), ys = y.split(' ');
  return xs[0] === ys[0] && xs[xs.length - 1] === ys[ys.length - 1];
}

/** People held by a record: an NP record is itself a person; an ORG record lists its directors/UBOs. */
function recordPeople(r) {
  const id = r.identifiers || {};
  if (r.client_type === 'NP') return [{ name: id.name, date_of_birth: id.date_of_birth }];
  return (id.people || []).map((p) => ({ name: p.name, date_of_birth: p.date_of_birth, role: p.role }));
}

export function matchDeclined(subject, records = []) {
  const out = [];
  const s = subject || {};
  for (const r of records) {
    const id = r.identifiers || {};
    const on = [];
    let strong = false;
    if (s.client_type === 'NP' && r.client_type === 'NP') {
      const docs = new Set((id.document_numbers || []).map(docNo).filter(Boolean));
      if ((s.document_numbers || []).map(docNo).some((d) => d && docs.has(d))) { on.push('document number'); strong = true; }
      if (s.date_of_birth && day(s.date_of_birth) === day(id.date_of_birth) && samePersonName(s.name, id.name)) { on.push('name + date of birth'); strong = true; }
      if (s.email && email(s.email) === email(id.email)) { on.push('email'); strong = true; }
      if (phone(s.phone) && phone(s.phone) === phone(id.phone)) { on.push('phone'); strong = true; }
      if (addrKey(s.address) && addrKey(s.address) === addrKey(id.address)) on.push('address');
      if (!on.length && normName(s.name) && normName(s.name) === normName(id.name)) on.push('name only');
    }
    if (s.client_type === 'ORG' && r.client_type === 'ORG') {
      const reg = docNo(s.registration_number);
      if (reg && reg === docNo(id.registration_number) && (!s.registered_country || !id.registered_country || normName(s.registered_country) === normName(id.registered_country))) { on.push('registration number'); strong = true; }
      if (orgName(s.name) && orgName(s.name) === orgName(id.name)) on.push('company name');
    }
    // Persons: the subject (NP) or its directors/UBOs (ORG) against people of declined records of either type.
    const subjectPeople = s.client_type === 'NP' ? [] : (s.people || []);
    const theirs = s.client_type === 'NP' && r.client_type === 'NP' ? [] : recordPeople(r);
    const mine = s.client_type === 'NP' ? [{ name: s.name, date_of_birth: s.date_of_birth }] : subjectPeople;
    for (const p of mine) {
      for (const q of theirs) {
        if (!samePersonName(p.name, q.name)) continue;
        const dob = p.date_of_birth && q.date_of_birth && day(p.date_of_birth) === day(q.date_of_birth);
        const label = `${s.client_type === 'NP' ? 'client' : p.name} is ${q.role ? `${q.role} of` : 'linked to'} a declined ${r.client_type === 'ORG' ? 'company' : 'person'}${dob ? ' (name + date of birth)' : ' (name only)'}`;
        if (!on.includes(label)) on.push(label);
        if (dob) strong = true;
      }
    }
    if (!on.length) continue;
    out.push({
      record_id: r.id, case_id: r.case_id, client_id: r.client_id, status: r.status, decided_at: r.decided_at || r.created_date || null,
      strength: strong ? 'strong' : 'possible', info_only: r.status === 'Closed, not completed', matched_on: on,
    });
  }
  return out.sort((a, b) => (a.strength === b.strength ? 0 : a.strength === 'strong' ? -1 : 1));
}

/** Subject from a client + its linked related parties. */
export function subjectFromClient(client, relatedParties = []) {
  const c = client || {};
  return {
    client_type: c.client_type === 'ORG' ? 'ORG' : 'NP', name: c.full_name, date_of_birth: c.date_of_birth || null,
    document_numbers: [c.id_number, c.passport_number, c.document_number].filter(Boolean), email: c.primary_contact_email || c.email || null,
    phone: c.primary_contact_phone || null, address: c.residential_address || c.registered_address || null,
    registration_number: c.registration_number || null, registered_country: c.registered_country || null,
    people: relatedParties.filter((p) => p.party_type !== 'ORG').map((p) => ({ name: p.full_name, date_of_birth: p.date_of_birth || null })),
  };
}

/** Does any match require mandatory Compliance review (strong, on a Declined/Terminated record)? */
export const requiresReview = (matches) => matches.some((m) => m.strength === 'strong' && !m.info_only);
