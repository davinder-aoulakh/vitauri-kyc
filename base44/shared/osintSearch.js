// OSINT for a KYC subject: builds an identity profile from what we already hold (names incl. preferred name, employer,
// email domain, linked companies, location, DOB), searches with explicit queries, and asks the model to judge for each
// finding whether it is about OUR subject. Namesakes are kept apart and never count as findings or adverse media.
import { asList } from './tmAuth.js';

const GENERIC_MAIL = new Set(['gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'live.com', 'live.nl', 'yahoo.com', 'icloud.com', 'me.com',
  'proton.me', 'protonmail.com', 'ziggo.nl', 'kpnmail.nl', 'planet.nl', 'hetnet.nl', 'xs4all.nl', 'home.nl', 'gmx.com', 'gmx.de', 'aol.com', 'msn.com']);
const MATCH_ORDER = { confirmed: 0, likely: 1, possible: 2, not_subject: 3 };
const CRED_ORDER = { high: 0, medium: 1, low: 2 };
const LOCAL_ADVERSE = {
  NL: ['fraude', 'oplichting', 'rechtbank', 'veroordeeld', 'FIOD', 'faillissement'],
  BE: ['fraude', 'oplichting', 'rechtbank', 'veroordeeld', 'faillissement'],
  DE: ['Betrug', 'Gericht', 'verurteilt', 'Insolvenz'],
  CW: ['fraude', 'hof', 'veroordeeld'],
};

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const uniq = (arr) => {
  const seen = new Set();
  return arr.map(clean).filter((v) => { const k = v.toLowerCase(); if (!v || seen.has(k)) return false; seen.add(k); return true; });
};
const countryText = (c) => clean(String(c || '').replace(/\s*\([A-Z]{2,3}\)\s*$/, ''));
const countryCode = (c) => {
  const s = String(c || '').toUpperCase();
  const m = /\(([A-Z]{2})\)/.exec(s) || /^([A-Z]{2})$/.exec(s.trim());
  if (m) return m[1];
  if (/NETHERLANDS|NEDERLAND|NLD/.test(s)) return 'NL';
  if (/BELGI/.test(s)) return 'BE';
  if (/GERMAN|DEUTSCH/.test(s)) return 'DE';
  if (/CURA/.test(s)) return 'CW';
  return '';
};

/** Address as text: ORG registered_address is a string, NP residential_address an object. */
const addressText = (a) => (a && typeof a === 'object' ? [a.street, a.number, a.zipcode, a.city, a.country].filter(Boolean).join(' ') : clean(a));

/** City from an address object, or the town part of a free-text address ("Street 1, Town, 1234AB"). */
function cityOf(a) {
  if (a && typeof a === 'object') return clean(a.city);
  const parts = clean(a).split(',').map((p) => p.trim()).filter(Boolean);
  const town = parts.slice(1).find((p) => /[a-z]/i.test(p) && !/\d/.test(p));
  return town || '';
}

const LEGAL_FORM = /[\s,]+(b\.?\s?v\.?|n\.?\s?v\.?|v\.?o\.?f\.?|c\.?v\.?|ltd\.?|limited|llc|inc\.?|gmbh|ag|s\.?a\.?|sarl|plc|pty\.?\s+ltd\.?|holding)$/i;
/** "Zwarts Management B.V." -> "Zwarts Management" (companies are often written without their legal form). */
export const withoutLegalForm = (name) => { let n = clean(name); for (let i = 0; i < 2; i++) n = n.replace(LEGAL_FORM, '').trim(); return n; };

/** Stable key of the client fields that drive the search; the panel uses it to say "details changed since this search". */
export function clientIdentityKey(c) {
  const a = c?.residential_address || {};
  return [c?.full_name, c?.preferred_name, c?.first_names, c?.last_name, c?.date_of_birth, c?.employer_name, c?.occupation,
    c?.primary_contact_email, a?.city, c?.registration_number, c?.registered_country, c?.country_of_residence,
    addressText(c?.registered_address), c?.sector]
    .map((v) => clean(v).toLowerCase()).join('|');
}

/** Employer named in free text ("IT specialist at Capgemini", "werkzaam bij KPN", "salary from Acme"). */
export function employerFromText(text) {
  const t = String(text || '');
  const re = /(?:employed (?:by|at)|works? (?:at|for)|working (?:at|for)|position (?:at|with)|salary (?:from|at)|(?:specialist|engineer|manager|consultant|director|analyst|developer|officer|owner|founder|partner) (?:at|of|with)|werkzaam bij|werkt bij|in dienst bij)\s+([A-Z][\w&.'-]*(?:\s+(?:[A-Z][\w&.'-]*|B\.V\.|N\.V\.))*)/g;
  const out = [];
  let m;
  while ((m = re.exec(t)) && out.length < 3) out.push(m[1].replace(/[.,;]+$/, ''));
  return uniq(out);
}

/** Everything we know about the subject that helps to tell them apart from namesakes. */
export function subjectProfile({ client = {}, kycCase = {}, outreachItems = [], linkedCompanies = [], keyPeople = [], hints = '' }) {
  const isOrg = client.client_type === 'ORG';
  const first = clean(client.first_names).split(' ').filter(Boolean);
  const last = clean(client.last_name);
  const full = clean(client.full_name);
  const fullParts = full.split(' ').filter(Boolean);
  const lastName = last || (fullParts.length > 1 ? fullParts[fullParts.length - 1] : '');
  const givenNames = first.length ? first : fullParts.slice(0, -1);

  const names = isOrg ? uniq([full, client.preferred_name, withoutLegalForm(full), withoutLegalForm(client.preferred_name)]) : uniq([
    full, client.preferred_name,
    givenNames.length && lastName ? `${givenNames[0]} ${lastName}` : '',
    givenNames.length > 1 && lastName ? `${givenNames[1]} ${lastName}` : '',
    givenNames.length && lastName ? `${givenNames.map((g) => `${g[0]}.`).join('')} ${lastName}` : '',
  ]);

  const answer = (re) => outreachItems.filter((i) => re.test(String(i.label || '')) && i.response_text && !String(i.response_text).trim().startsWith('{')).map((i) => clean(i.response_text));
  const employers = uniq([
    client.employer_name,
    ...answer(/employer|werkgever|company name|bedrijfsnaam/i),
    ...employerFromText(kycCase.purpose_nature_text),
    ...employerFromText(outreachItems.map((i) => i.response_text || '').join('. ')),
  ]).slice(0, 4);
  const occupation = clean(client.occupation) || answer(/occupation|beroep|job title|functie/i)[0] || '';
  const emailDomain = (() => {
    const d = String(client.primary_contact_email || '').split('@')[1]?.toLowerCase().trim();
    return d && !GENERIC_MAIL.has(d) ? d : '';
  })();
  const addr = isOrg ? client.registered_address : (client.residential_address || {});
  const city = cityOf(addr);
  const country = countryText(isOrg ? client.registered_country : (client.country_of_residence || client.nationality));

  return {
    type: isOrg ? 'Organisation' : 'Natural person',
    names,
    identifiers: {
      ...(isOrg ? {} : { date_of_birth: client.date_of_birth || '', birth_year: String(client.date_of_birth || '').slice(0, 4), place_of_birth: clean(client.place_of_birth), nationality: countryText(client.nationality) }),
      country, country_code: countryCode(country), city, occupation, employers, email_domain: emailDomain,
      linked_companies: uniq(linkedCompanies).slice(0, 5),
      ...(isOrg ? {
        registration_number: clean(client.registration_number), lei: clean(client.lei_code), legal_form: clean(client.legal_form),
        registered_address: addressText(client.registered_address), sector: clean(client.sector), business_activity: clean(client.business_activity).slice(0, 200),
        key_people: uniq(keyPeople).slice(0, 6),
      } : {}),
    },
    hints: clean(hints).slice(0, 500),
  };
}

/** Explicit search queries: every name variant, combined with the strongest identifiers, plus adverse terms. */
export function buildQueries(profile) {
  const id = profile.identifiers;
  const brand = id.email_domain ? id.email_domain.split('.')[0] : '';
  const isOrg = profile.type === 'Organisation';
  const ctx = isOrg
    ? uniq([id.city, ...(id.key_people || []).map((p) => p.split(' (')[0]), brand]).slice(0, 5)
    : uniq([...(id.employers || []), brand, ...(id.linked_companies || []), id.city]).slice(0, 5);
  const q = [];
  if (isOrg) {
    // Register and identity first: the registration number is the strongest identifier a company has.
    const short = withoutLegalForm(profile.names[0]) || profile.names[0];
    const regLabel = id.country_code === 'NL' ? 'KvK' : 'company registration';
    if (id.registration_number) { q.push(`"${id.registration_number}"`); q.push(`"${short}" ${regLabel} ${id.registration_number}`); }
    if (id.lei) q.push(`"${id.lei}"`);
  }
  // The preferred name (names[1] when set) is usually the one used online: it gets the full set of combinations first.
  const ordered = uniq([profile.names[1], profile.names[0], ...profile.names.slice(2)]).filter(Boolean);
  ordered.slice(0, 4).forEach((n, i) => {
    q.push(`"${n}"`);
    ctx.slice(0, i < 2 ? 4 : 1).forEach((c) => q.push(`"${n}" ${c.includes(' ') ? `"${c}"` : c}`));
    if (!isOrg && i < 2) q.push(`"${n}" LinkedIn`);
    if (isOrg && i < 2) q.push(`"${n}" website OR company profile`);
  });
  const main = ordered[0];
  const local = LOCAL_ADVERSE[id.country_code] || [];
  const adverse = [...['fraud', 'sanction', 'court', 'investigation'], ...local].slice(0, 8);
  adverse.forEach((t) => q.push(`"${main}" ${t}`));
  if (profile.names[0] !== main) q.push(`"${profile.names[0]}" ${adverse.slice(0, 3).join(' OR ')}`);
  return uniq(q).slice(0, 30);
}

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    overall_summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          source_type: { type: 'string', enum: ['news', 'regulatory', 'website', 'social', 'legal', 'registry', 'other'] },
          credibility: { type: 'string', enum: ['high', 'medium', 'low'] },
          source_url: { type: 'string' },
          is_adverse: { type: 'boolean' },
          subject_match: { type: 'string', enum: ['confirmed', 'likely', 'possible', 'not_subject'] },
          matched_on: { type: 'array', items: { type: 'string' } },
          name_variant: { type: 'string' },
          mismatch: { type: 'string' },
        },
      },
    },
  },
};

function prompt(profile, queries, focus) {
  const id = profile.identifiers;
  const lines = Object.entries(id).filter(([, v]) => (Array.isArray(v) ? v.length : v)).map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(', ') : v}`);
  return `You are an OSINT analyst at a regulated financial institution doing customer due diligence.

SUBJECT (${profile.type})
Names the subject is known by (search ALL of them; the preferred name is often the one used online):
${profile.names.map((n) => `- ${n}`).join('\n')}
Known identifiers:
${lines.join('\n') || '- none'}
${profile.hints ? `Analyst hints: ${profile.hints}\n` : ''}
TASK: ${focus}
Run web searches with these queries (and close variations), not only the full legal name:
${queries.map((q) => `- ${q}`).join('\n')}

For EVERY result decide whether it is about THIS subject:
- confirmed: at least two independent identifiers match (e.g. name variant + employer, name + company, name + city + birth year; for a company: registration number, or name + address/town, or name + a key person)
- likely: name variant plus one identifier matches, nothing contradicts
- possible: only the name matches, no contradiction
- not_subject: a namesake or contradicted (different birth year/era, location, profession, deceased, different company; for a company: different registration number, country or town, or a different legal entity with a similar name)
List matched_on (which identifiers matched) and, for not_subject, the mismatch.
Include namesakes you came across as not_subject so the analyst can see they were checked.
For each finding: title, 2-3 sentence factual summary, source_type, credibility, source_url (real URL you saw), is_adverse.
Return up to 8 findings. Never invent sources. If nothing about the subject is found, say so in overall_summary.`;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

async function ask(base44, payload) {
  try {
    return await base44.asServiceRole.integrations.Core.InvokeLLM({ ...payload, model: 'gemini_3_1_pro' });
  } catch (e) {
    console.warn('OSINT: preferred model failed, retrying with the default model:', e?.message);
    return await base44.asServiceRole.integrations.Core.InvokeLLM(payload);
  }
}

/** Loads the context and runs the search. Returns the object stored (as JSON) in KycCase.osint_cache. */
export async function runOsint(base44, { client, kycCase, hints = '' }) {
  const E = base44.asServiceRole.entities;
  const outreach = kycCase?.id ? asList(await E.OutreachRequest.filter({ case_id: kycCase.id }).catch(() => [])) : [];
  const outreachItems = outreach.flatMap((r) => r.items || []);

  // Companies this person is linked to as UBO / director (other clients of the tenant).
  let linkedCompanies = [];
  if (client?.client_type !== 'ORG' && client?.tenant_id) {
    try {
      const names = uniq([client.full_name, client.preferred_name]);
      const parties = asList(await E.RelatedParty.filter({ tenant_id: client.tenant_id, full_name: { $in: names } }, undefined, 20));
      const links = parties.length ? asList(await E.ClientRelatedPartyLink.filter({ tenant_id: client.tenant_id, related_party_id: { $in: parties.map((p) => p.id) } }, undefined, 50)) : [];
      const orgIds = [...new Set(links.map((l) => l.client_id))].filter((id) => id && id !== client.id);
      linkedCompanies = orgIds.length ? asList(await E.Client.filter({ tenant_id: client.tenant_id, id: { $in: orgIds } }, undefined, 10)).map((c) => c.full_name) : [];
    } catch { linkedCompanies = []; }
  }

  // For an organisation: its UBOs and directors ("Jan de Vries (UBO 40%)").
  let keyPeople = [];
  if (client?.client_type === 'ORG' && client?.tenant_id) {
    try {
      const links = asList(await E.ClientRelatedPartyLink.filter({ tenant_id: client.tenant_id, client_id: client.id }, undefined, 50));
      const ids = [...new Set(links.map((l) => l.related_party_id).filter(Boolean))];
      const parties = ids.length ? asList(await E.RelatedParty.filter({ tenant_id: client.tenant_id, id: { $in: ids } }, undefined, 50)) : [];
      keyPeople = links.map((l) => {
        const p = parties.find((x) => x.id === l.related_party_id);
        if (!p?.full_name || p.is_active === false) return '';
        const role = l.role || p.role_in_relationship || '';
        const pct = l.ownership_percentage ?? p.ownership_percentage;
        return role || pct ? `${p.full_name} (${[role, pct ? `${pct}%` : ''].filter(Boolean).join(' ')})` : p.full_name;
      }).filter(Boolean);
    } catch { keyPeople = []; }
  }

  const profile = subjectProfile({ client, kycCase, outreachItems, linkedCompanies, keyPeople, hints });
  const isOrg = profile.type === 'Organisation';
  const queries = buildQueries(profile);
  const base = { add_context_from_internet: true, response_json_schema: FINDING_SCHEMA };
  const [identity, adverse] = await Promise.allSettled([
    ask(base44, { ...base, prompt: prompt(profile, queries.filter((q) => !/fraud|sanction|court|investigation|fraude|oplichting|rechtbank|veroordeeld|FIOD|faillissement|Betrug|Gericht|verurteilt|Insolvenz|hof/i.test(q)),
      isOrg
        ? 'Find the company\'s presence: trade/company register entries (e.g. KvK, Companies House, OpenCorporates), its own website, activities, key people (UBOs/directors), group structure, news and reviews.'
        : 'Find the subject\'s online presence: professional profiles (LinkedIn), company roles and registrations, own websites, interviews, publications and news.') }),
    ask(base44, { ...base, prompt: prompt(profile, queries,
      isOrg
        ? 'Find adverse information on the company and its key people: regulatory actions, enforcement, sanctions, court cases, insolvency/bankruptcy, fraud allegations and negative media.'
        : 'Find adverse information: regulatory actions, enforcement, sanctions, court cases, insolvency, fraud allegations and negative media.') }),
  ]);
  if (identity.status === 'rejected' && adverse.status === 'rejected') throw identity.reason || adverse.reason;

  const all = [identity, adverse].flatMap((r) => (r.status === 'fulfilled' ? r.value?.findings || [] : []));
  const seen = new Set();
  const merged = all.filter((f) => {
    if (!f?.title) return false;
    const k = norm(f.source_url) || norm(f.title);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((f) => ({ ...f, subject_match: MATCH_ORDER[f.subject_match] != null ? f.subject_match : 'possible', matched_on: Array.isArray(f.matched_on) ? f.matched_on : [] }));
  merged.sort((a, b) => (MATCH_ORDER[a.subject_match] - MATCH_ORDER[b.subject_match])
    || (Number(!!b.is_adverse) - Number(!!a.is_adverse)) || ((CRED_ORDER[a.credibility] ?? 3) - (CRED_ORDER[b.credibility] ?? 3)));

  const findings = merged.filter((f) => f.subject_match !== 'not_subject');
  const otherPeople = merged.filter((f) => f.subject_match === 'not_subject').map((f) => ({ ...f, is_adverse: false }));
  const summaries = [identity, adverse].map((r) => (r.status === 'fulfilled' ? clean(r.value?.overall_summary) : '')).filter(Boolean);

  return {
    entity_searched: profile.names[0],
    subject: { names: profile.names, identifiers: profile.identifiers },
    queries,
    hints: profile.hints,
    overall_summary: summaries.join(' '),
    findings,
    other_people: otherPeople,
    adverse_count: findings.filter((f) => f.is_adverse && f.subject_match !== 'possible').length,
    possible_adverse_count: findings.filter((f) => f.is_adverse && f.subject_match === 'possible').length,
    identity_key: clientIdentityKey(client),
    partial: identity.status === 'rejected' || adverse.status === 'rejected',
  };
}
