// Counterparty matching + creation for Transaction Monitoring (tenant-scoped).
import { normaliseDescription } from './tmCanonical.js';
import { asList, mapLimit } from './tmAuth.js';

export const NAME_MATCH_THRESHOLD = 0.9;

export function jaroWinkler(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array(la).fill(false), mb = new Array(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - range), hi = Math.min(lb - 1, i + range);
    for (let j = lo; j <= hi; j++) {
      if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; matches++; break; }
    }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) {
    if (!ma[i]) continue;
    while (!mb[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / la + matches / lb + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < Math.min(4, la, lb) && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

export const normaliseAccount = (v) => String(v ?? '').toUpperCase().replace(/[\s-]/g, '');
const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;
const COMPANY_RE = /\b(BV|NV|LTD|LLC|INC|GMBH|SA|CORP|HOLDING|HOLDINGS|STICHTING|FOUNDATION|BANK|COMPANY|CO|LIMITED|PLC|AG|SARL)\b/;
const PERSON_CATEGORIES = new Set(['transfer_foreign_private', 'transfer_domestic', 'remittance']);

function guessKind(name, category) {
  const n = normaliseDescription(name);
  if (!n) return 'unknown';
  if (COMPANY_RE.test(n)) return 'company';
  if (PERSON_CATEGORIES.has(category) && n.split(' ').filter((t) => t.length > 1).length >= 2) return 'person';
  return 'unknown';
}

const RP_MATCH_THRESHOLD = 0.95;

/**
 * Related party of the transaction's client that this counterparty looks like: same normalised name (Jaro-Winkler >= 0.95);
 * for companies a known registration number on both sides must also agree. A suggestion only, never a link.
 */
export function matchRelatedParty(cp, parties) {
  const regs = (cp.identifiers || []).filter((i) => i.type === 'registration').map((i) => normaliseAccount(i.value));
  const names = [cp.display_name, ...(cp.names || [])].map(normaliseDescription).filter(Boolean);
  let best = null, bestScore = 0;
  for (const p of parties) {
    const pn = normaliseDescription(p.full_name);
    if (!pn) continue;
    if (p.party_type === 'ORG' && p.registration_number && regs.length && !regs.includes(normaliseAccount(p.registration_number))) continue;
    for (const n of names) {
      const s = n === pn ? 1 : jaroWinkler(n, pn);
      if (s >= RP_MATCH_THRESHOLD && s > bestScore) { best = p; bestScore = s; }
    }
  }
  return best;
}

async function clientParties(E, tenantId, clientId) {
  const links = asList(await E.ClientRelatedPartyLink.filter({ tenant_id: tenantId, client_id: clientId }, undefined, 200));
  const ids = [...new Set(links.map((l) => l.related_party_id).filter(Boolean))];
  if (!ids.length) return [];
  const parties = asList(await E.RelatedParty.filter({ tenant_id: tenantId, id: { $in: ids } }, undefined, 200));
  return parties.filter((p) => p.is_active !== false).map((p) => {
    const l = links.find((x) => x.related_party_id === p.id) || {};
    return { id: p.id, full_name: p.full_name, party_type: p.party_type, registration_number: p.registration_number, role: l.role || p.role_in_relationship || '', ownership_percentage: l.ownership_percentage ?? p.ownership_percentage ?? null };
  });
}

/**
 * txns: Transaction records (tenant already verified by caller).
 * screenFn(cp) -> { status, hit_refs } | null   (called only for NEW person/company counterparties)
 * Returns { updates: [{id, counterparty_id, counterparty_match_confidence}], stats }
 */
export async function resolveTransactions(base44, { tenantId, txns, sourceRef, screenFn, maxScreen = 25 }) {
  const E = base44.asServiceRole.entities;
  const byId = new Map();
  const byIdent = new Map();
  const byCountry = new Map();
  const dirty = new Map();
  const newOnes = [];
  const stats = { matched_identifier: 0, matched_name: 0, created: 0, skipped: 0, screened: 0, screening_skipped: 0, screening_failed: 0 };
  const now = new Date().toISOString();

  const remember = (cp) => { byId.set(cp.id, cp); return cp; };

  async function active(cp) {
    let cur = cp;
    for (let hop = 0; cur?.merged_into && hop < 5; hop++) {
      let next = byId.get(cur.merged_into);
      if (!next) {
        const r = asList(await E.Counterparty.filter({ tenant_id: tenantId, id: cur.merged_into }));
        next = r[0] ? remember(r[0]) : null;
      }
      cur = next;
    }
    return cur && !cur.merged_into ? cur : null;
  }

  async function byIdentifier(value) {
    if (byIdent.has(value)) return byIdent.get(value);
    const r = asList(await E.Counterparty.filter({ tenant_id: tenantId, 'identifiers.value': value }, undefined, 20));
    let found = null;
    for (const cp of r) {
      remember(cp);
      if ((cp.identifiers || []).some((i) => normaliseAccount(i.value) === value)) {
        const a = await active(cp);
        if (a) { found = a; break; }
      }
    }
    byIdent.set(value, found);
    return found;
  }

  async function countryList(country) {
    const key = country || '';
    if (!byCountry.has(key)) {
      const q = country ? { tenant_id: tenantId, country } : { tenant_id: tenantId, country: { $exists: false } };
      const r = asList(await E.Counterparty.filter(q, '-created_date', 500));
      byCountry.set(key, r.filter((c) => !c.merged_into).map(remember));
    }
    return byCountry.get(key);
  }

  const patch = (cp, fn) => {
    fn(cp);
    dirty.set(cp.id, cp);
  };

  const updates = [];
  const pendingRp = [];
  for (const t of txns) {
    const name = t.counterparty_name ? String(t.counterparty_name).trim() : '';
    const acct = normaliseAccount(t.counterparty_account_id);
    const country = t.counterparty_country ? String(t.counterparty_country).toUpperCase() : '';
    if (!name && !acct) { stats.skipped++; continue; }
    const normName = normaliseDescription(name);

    let cp = null, confidence = 0, how = '';
    if (acct) {
      cp = await byIdentifier(acct);
      if (cp) { confidence = 1; how = 'identifier'; }
    }
    if (!cp && normName) {
      let best = 0;
      for (const cand of await countryList(country)) {
        if (cand.merged_into) continue;
        const names = [cand.display_name, ...(cand.names || [])];
        for (const n of names) {
          const s = jaroWinkler(normName, normaliseDescription(n));
          if (s > best) { best = s; if (s >= NAME_MATCH_THRESHOLD) { cp = cand; confidence = s; } }
        }
        if (best === 1) break;
      }
      if (cp) how = 'name';
    }

    if (cp) {
      stats[how === 'identifier' ? 'matched_identifier' : 'matched_name']++;
      patch(cp, (c) => {
        if (name && !(c.names || []).some((n) => normaliseDescription(n) === normName) && normaliseDescription(c.display_name) !== normName) c.names = [...(c.names || []), name];
        if (acct && !(c.identifiers || []).some((i) => normaliseAccount(i.value) === acct)) {
          c.identifiers = [...(c.identifiers || []), { type: IBAN_RE.test(acct) ? 'iban' : 'account', value: acct }];
          byIdent.set(acct, c);
        }
        c.provenance = [...(c.provenance || []), { source: 'ingest', ref: t.id, at: now }].slice(-20);
      });
    } else {
      const kind = guessKind(name, t.category);
      cp = remember(await E.Counterparty.create({
        tenant_id: tenantId,
        display_name: name || acct,
        names: name ? [name] : [],
        identifiers: acct ? [{ type: IBAN_RE.test(acct) ? 'iban' : 'account', value: acct }] : [],
        country: country || undefined,
        entity_kind: kind,
        screening_status: 'not_screened',
        provenance: [{ source: 'ingest', ref: sourceRef || t.id, at: now }],
      }));
      stats.created++;
      confidence = 1;
      if (acct) byIdent.set(acct, cp);
      (byCountry.get(country) || (byCountry.set(country, []), byCountry.get(country))).push(cp);
      newOnes.push(cp);
    }
    updates.push({ id: t.id, counterparty_id: cp.id, counterparty_match_confidence: Math.round(confidence * 1000) / 1000 });
    if (t.client_id && !cp.related_party_id && !cp.suggested_related_party_id && !cp.client_id) pendingRp.push({ cp, clientId: t.client_id });
  }

  // Related-party suggestions: a counterparty that looks like the client's own UBO, director or related company.
  const partiesByClient = new Map();
  for (const { cp, clientId } of pendingRp) {
    if (cp.suggested_related_party_id) continue;
    try {
      if (!partiesByClient.has(clientId)) partiesByClient.set(clientId, await clientParties(E, tenantId, clientId));
      const p = matchRelatedParty(cp, partiesByClient.get(clientId));
      if (!p) continue;
      patch(cp, (c) => { c.suggested_related_party_id = p.id; });
      stats.related_party_suggested = (stats.related_party_suggested || 0) + 1;
      await E.AuditEvent.create({
        tenant_id: tenantId, client_id: clientId, actor_name: 'System', actor_type: 'System', event_type: 'counterparty_related_party_suggested',
        before_state: { suggested_related_party_id: null }, after_state: { counterparty_id: cp.id, suggested_related_party_id: p.id },
        notes: `Counterparty "${cp.display_name}" looks like the client's ${p.role || 'related party'} ${p.full_name}. Not linked; a user must confirm.`,
      });
    } catch (e) {
      console.warn('related-party suggestion failed:', e?.message);
    }
  }

  // AML screening: only NEW person/company counterparties (screenEntityAml supports NP/ORG only)
  if (screenFn) {
    const eligible = newOnes.filter((c) => c.entity_kind === 'person' || c.entity_kind === 'company');
    stats.screening_skipped += newOnes.length - eligible.length;
    const batch = eligible.slice(0, maxScreen);
    stats.screening_skipped += eligible.length - batch.length;
    const results = await mapLimit(batch, 4, (c) => screenFn(c));
    results.forEach((r, i) => {
      const c = batch[i];
      if (r.ok && r.value) {
        stats.screened++;
        patch(c, (x) => {
          x.screening_status = r.value.status;
          x.screening_hit_ids = r.value.hit_refs;
          x.last_screened_at = now;
        });
      } else {
        stats.screening_failed++;
      }
    });
  }

  const dirtyList = [...dirty.values()];
  await mapLimit(dirtyList, 6, (c) => {
    const { id, names, identifiers, provenance, screening_status, screening_hit_ids, last_screened_at, suggested_related_party_id } = c;
    return E.Counterparty.update(id, { names, identifiers, provenance, screening_status, screening_hit_ids, last_screened_at, ...(suggested_related_party_id ? { suggested_related_party_id } : {}) });
  });

  return { updates, stats };
}