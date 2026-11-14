// Maps KYC "expected transaction behaviour" (JSON string) or a KycTransactionAnalysis to ExpectedProfile limits.

const EU_EEA = [
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
  'IS','LI','NO',
];

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '').replace(/[–—]/g, '-');
const asArray = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

export function parseBehavior(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { const p = JSON.parse(raw); return p && typeof p === 'object' ? p : null; } catch { return null; }
}

// Returns a monthly inbound limit, or undefined (unknown) / null (set manually).
export function mapVolume(v) {
  const s = norm(v);
  if (!s) return undefined;
  if (s.startsWith('>')) return null;
  if (s.startsWith('<')) return 833;
  if (s.startsWith('€1m')) return 833333;
  if (s.startsWith('€100k')) return 83333;
  if (s.startsWith('€10k')) return 8333;
  return undefined;
}

export function mapFrequency(v) {
  const s = norm(v);
  if (s.includes('daily')) return 40;
  if (s.includes('weekly')) return 8;
  if (s.includes('monthly')) return 4;
  if (s.includes('quarterly')) return 2;
  if (s.includes('annual')) return 1;
  if (s.includes('adhoc') || s.includes('ad-hoc')) return 4;
  return undefined;
}

export function mapGeographies(list) {
  const countries = new Set();
  const unmapped = [];
  for (const raw of asArray(list)) {
    for (const part of String(raw).split(/[,;|]+/)) {
      const t = norm(part);
      if (!t) continue;
      if (/^(eu|eea|eu\/eea|eea\/eu|europeanunion|europe)$/.test(t)) EU_EEA.forEach((c) => countries.add(c));
      else if (/^(uk|gb|unitedkingdom)$/.test(t)) countries.add('GB');
      else if (/^(us|usa|unitedstates)$/.test(t)) countries.add('US');
      else if (/^(ca|canada)$/.test(t)) countries.add('CA');
      else if (/^(us\/canada|usa\/canada|northamerica|us\/ca)$/.test(t)) { countries.add('US'); countries.add('CA'); }
      else if (/^[a-z]{2}$/.test(t) && !/^(eu)$/.test(t)) countries.add(t.toUpperCase());
      else unmapped.push(part.trim());
    }
  }
  return { countries: [...countries], unmapped };
}

const round = (n) => Math.round(n);
const amount = (v) => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : undefined; };

/** Limits that follow from the expected use alone (no transaction analysis). homeCountry: ISO-2, for "Domestic only". */
export function limitsFromBehavior(behavior, homeCountry) {
  const fields = {};
  const notes = [];
  if (!behavior) return { fields, notes };
  // A stated monthly amount is more precise than the yearly band; 30% headroom as for analysed statements
  const inMonth = amount(behavior.inbound_month);
  const outMonth = amount(behavior.outbound_month);
  if (inMonth) fields.inbound_max_month = round(inMonth * 1.3);
  if (outMonth) fields.outbound_max_month = round(outMonth * 1.3);
  if (!inMonth) {
    const vols = asArray(behavior.volumes ?? behavior.volume).map(mapVolume).filter((v) => v !== undefined);
    if (vols.length) {
      if (vols.includes(null)) notes.push('Volume above EUR 10M/year: set manually.');
      else fields.inbound_max_month = Math.max(...vols);
    }
  }
  const freqs = asArray(behavior.frequency).map(mapFrequency).filter((v) => v !== undefined);
  if (freqs.length) fields.inbound_max_count_month = Math.max(...freqs);

  const geoList = asArray(behavior.geographies ?? behavior.geography);
  const domestic = geoList.some((g) => /domestic/i.test(String(g)));
  const geo = mapGeographies(geoList.filter((g) => !/domestic/i.test(String(g))));
  const countries = new Set(geo.countries);
  if (domestic && /^[A-Za-z]{2}$/.test(String(homeCountry || ''))) countries.add(String(homeCountry).toUpperCase());
  else if (domestic) geo.unmapped.push('Domestic only');
  if (countries.size) fields.allowed_countries = [...countries];
  if (domestic && geoList.length === 1 && countries.size) fields.outbound_foreign_max_month = 0;
  if (geo.unmapped.length) notes.push(`Geographies not mapped to countries: ${geo.unmapped.join(', ')}.`);

  const cash = norm(behavior.cash);
  if (cash === 'none' || cash === 'nocash') fields.cash_max_month = 0;
  else if (cash) notes.push(`Cash use expected (${behavior.cash}): set the monthly cash limit manually.`);

  const types = asArray(behavior.types ?? behavior.transaction_types);
  if (types.length) fields.expected_categories = types.map(String);
  const cps = asArray(behavior.counterparties);
  if (cps.length) notes.push(`Expected counterparties: ${cps.map(String).join(', ')}.`);
  return { fields, notes };
}

/** Build the profile fields. Returns { fields, notes[] }. Always safe: unusable input => notes only. */
export function buildProfileFields({ behavior, analysis, observedCountries, reportingCurrency }) {
  const fields = {};
  const notes = [];

  if (analysis && (analysis.avg_inbound_month || analysis.avg_outbound_month)) {
    fields.currency = reportingCurrency || 'EUR';
    if (analysis.avg_inbound_month) fields.inbound_max_month = round(analysis.avg_inbound_month * 1.3);
    if (analysis.avg_outbound_month) fields.outbound_max_month = round(analysis.avg_outbound_month * 1.3);
    if (observedCountries?.length) fields.allowed_countries = observedCountries;
    notes.push(`Based on transaction analysis ${analysis.id} (averages x 1.3 headroom).`);
    return { fields, notes };
  }

  if (behavior) {
    fields.currency = 'EUR';
    const fromUse = limitsFromBehavior(behavior);
    Object.assign(fields, fromUse.fields);
    notes.push(...fromUse.notes);
  }

  const usable = Object.keys(fields).some((k) => k !== 'currency' && fields[k] !== undefined);
  if (!usable) {
    notes.push('No usable expected-behaviour or analysis data was available; limits must be set manually.');
  }
  return { fields, notes };
}