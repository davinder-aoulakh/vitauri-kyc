// partyRoles — a related party can hold several roles for one client (e.g. Director + Shareholder + UBO).
// ClientRelatedPartyLink.roles holds the list; link.role / RelatedParty.role_in_relationship hold the joined text,
// which every existing reader matches by regex. The same rules are inlined in buildProfileSuggestions.

export const ROLES = ['UBO', 'Director', 'Shareholder', 'Beneficiary', 'Insured', 'Authorized Signatory', 'Other'];

const SYNONYMS = [
  [/^(ubo|beneficial owner|ultimate beneficial owner|uiteindelijk belanghebbende|beneficial_owner)$/i, 'UBO'],
  [/^(director|board member|managing director|bestuurder|statutair bestuurder|officer|ceo)$/i, 'Director'],
  [/^(shareholder|aandeelhouder|owner|enig aandeelhouder|sole shareholder)$/i, 'Shareholder'],
  [/^(authori[sz]ed signatory|signatory|gevolmachtigde|procuratiehouder)$/i, 'Authorized Signatory'],
  [/^beneficiary$/i, 'Beneficiary'],
  [/^insured$/i, 'Insured'],
];

const canonical = (r) => {
  const t = String(r || '').trim();
  if (!t) return null;
  const hit = SYNONYMS.find(([re]) => re.test(t));
  if (hit) return hit[1];
  return ROLES.find((x) => x.toLowerCase() === t.toLowerCase()) || t;
};

const order = (r) => { const i = ROLES.indexOf(r); return i < 0 ? ROLES.length : i; };

/** Array or "A, B" / "A / B" / "A & B" → canonical, deduplicated, in ROLES order. */
export function parseRoles(x) {
  const parts = Array.isArray(x) ? x : String(x || '').split(/\s*(?:,|\/|&|;|\+|\band\b|\ben\b)\s*/i);
  const out = [];
  for (const p of parts.flatMap((v) => (Array.isArray(v) ? v : [v]))) {
    const c = canonical(p);
    if (c && c !== 'Unknown' && !out.includes(c)) out.push(c);
  }
  return out.sort((a, b) => order(a) - order(b));
}

export const joinRoles = (roles) => parseRoles(roles).join(', ');
export const mergeRoles = (a, b) => parseRoles([...parseRoles(a), ...parseRoles(b)]);
/** Roles in candidate that recorded does not have yet. */
export const missingRoles = (recorded, candidate) => { const r = parseRoles(recorded); return parseRoles(candidate).filter((x) => !r.includes(x)); };
/** Roles of a link (roles array, else the role text, else the party's role). */
export const linkRoles = (link, rp) => parseRoles(link?.roles?.length ? link.roles : (link?.role || rp?.role_in_relationship));
