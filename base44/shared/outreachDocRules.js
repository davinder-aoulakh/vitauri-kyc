// Guided conversation outreach: document checks (spec 6.3, adapter contract 4). Pure: the rules part of every upload check.
// The AI reads the document (outreachDocAi.js); rules decide age, name and address; the rest is the AI's finding.
// A check is { name, ok: true|false|null, message, by: 'rule'|'ai'|'manual' }; ok null = pending manual review.

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const AGE_RE = /not older than\s+\d+\s+months?/i;

/** Block check names with the tenant's document age ("Not older than 3 months" -> documentMaxAgeMonths). */
export function normaliseChecks(checks = [], settings = {}) {
  const n = Number(settings.documentMaxAgeMonths) || 3;
  return (checks || []).map((c) => (AGE_RE.test(c) ? c.replace(AGE_RE, `Not older than ${n} month${n === 1 ? '' : 's'}`) : c));
}

export const ruleKind = (name) => (AGE_RE.test(name) ? 'age' : /name matches/i.test(name) ? 'name' : /address matches/i.test(name) ? 'address' : null);

/** Whole months between two ISO dates (a document of 12 August read on 3 November is 2 months old). */
export function monthsBetween(fromIso, toIso) {
  const a = new Date(`${String(fromIso).slice(0, 10)}T00:00:00Z`);
  const b = new Date(`${String(toIso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) m -= 1;
  return m;
}

/** The document's name belongs to the person: every name part on the document appears in the ID name (initials allowed). */
export function nameMatches(docName, idName) {
  const d = fold(docName).split(' ').filter(Boolean);
  const id = fold(idName).split(' ').filter(Boolean);
  if (!d.length || !id.length) return null;
  const surnameOk = d.some((p) => p.length > 1 && p === id[id.length - 1]);
  const allOk = d.every((p) => id.includes(p) || (p.length === 1 && id.some((x) => x.startsWith(p))));
  return surnameOk && allOk;
}

/** Postcode and house number of the address the client entered both appear in the address on the document. */
export function addressMatches(docAddress, address) {
  const doc = fold(docAddress).replace(/\s+/g, '');
  if (!doc || !address) return null;
  const pc = fold(address.postcode).replace(/\s+/g, '');
  const nr = fold(address.number).replace(/\s+/g, '');
  if (!pc) return null;
  return doc.includes(pc) && (!nr || fold(docAddress).split(' ').includes(fold(address.number)));
}

/**
 * Rule results for the checks a rule decides. read: { issue_date, name_on_document, address_on_document } from the AI;
 * context: { today, id_name, address, max_age_months }.
 */
export function ruleChecks(checks = [], read = {}, context = {}) {
  const out = {};
  for (const name of checks) {
    const kind = ruleKind(name);
    if (kind === 'age') {
      const m = read?.issue_date ? monthsBetween(read.issue_date, context.today || new Date().toISOString()) : null;
      const max = Number(context.max_age_months) || 3;
      out[name] = m === null ? { ok: null, message: 'Date not found on the document' } : { ok: m >= 0 && m < max, message: m < max ? `Dated ${String(read.issue_date).slice(0, 10)}` : `The document is ${m} months old` };
    } else if (kind === 'name') {
      const ok = nameMatches(read?.name_on_document, context.id_name);
      out[name] = ok === null ? { ok: null, message: 'Name not found on the document' } : { ok, message: ok ? '' : `The document says "${read.name_on_document}"` };
    } else if (kind === 'address') {
      const ok = addressMatches(read?.address_on_document, context.address);
      out[name] = ok === null ? { ok: null, message: 'Address not found on the document' } : { ok, message: ok ? '' : 'The address differs from what you entered' };
    }
  }
  return out;
}

/**
 * The final list in block order. ai: { ok, checks: [{ name, ok, message }] } or { ok: false } when the AI failed.
 * Rule checks win where they decided (ok not null); without an AI result every other check is pending manual review.
 */
export function combineChecks(checks = [], ai = null, rules = {}) {
  return checks.map((name) => {
    const r = rules[name];
    if (r && r.ok !== null) return { name, ok: r.ok, message: r.message || '', by: 'rule' };
    const a = ai?.ok !== false ? (ai?.checks || []).find((c) => fold(c.name) === fold(name)) : null;
    if (a && typeof a.ok === 'boolean') return { name, ok: a.ok, message: String(a.message || '').slice(0, 200), by: 'ai' };
    return { name, ok: null, message: 'Pending manual review', by: 'manual' };
  });
}

export const failedNames = (checks = []) => checks.filter((c) => c.ok === false).map((c) => c.name);
export const evidenceStatus = (checks = []) => (checks.some((c) => c.ok === false) ? 'failed' : checks.some((c) => c.ok === null) ? 'pending' : 'passed');
