// Guided conversation outreach: which company registry a conversation uses (plan phase 6, "Which provider is used"). Pure.
//   Netherlands + KvK mode Live/Test       -> kvk   (route 'nl')
//   Netherlands with KvK off, or any other country Didit covers (Curaçao included) -> didit
//   no country code, or the client cannot find the organisation, or a provider fails -> document
// Fallback order: kvk -> didit -> document; didit -> document.

const NAME_TO_ISO2 = {
  netherlands: 'NL', nederland: 'NL', 'the netherlands': 'NL', holland: 'NL', curacao: 'CW', curaçao: 'CW', aruba: 'AW', 'sint maarten': 'SX',
  bonaire: 'BQ', suriname: 'SR', belgium: 'BE', belgie: 'BE', germany: 'DE', duitsland: 'DE', france: 'FR', luxembourg: 'LU', ireland: 'IE',
  'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB', england: 'GB', spain: 'ES', portugal: 'PT', italy: 'IT', switzerland: 'CH',
  austria: 'AT', denmark: 'DK', sweden: 'SE', norway: 'NO', finland: 'FI', poland: 'PL', 'united states': 'US', usa: 'US',
  canada: 'CA', australia: 'AU', 'new zealand': 'NZ', singapore: 'SG', 'hong kong': 'HK', 'united arab emirates': 'AE', uae: 'AE',
  'south africa': 'ZA', brazil: 'BR', mexico: 'MX', india: 'IN', japan: 'JP', china: 'CN', malta: 'MT', cyprus: 'CY', estonia: 'EE',
  latvia: 'LV', lithuania: 'LT', czechia: 'CZ', 'czech republic': 'CZ', greece: 'GR', romania: 'RO', bulgaria: 'BG', croatia: 'HR',
  slovenia: 'SI', slovakia: 'SK', hungary: 'HU', turkey: 'TR', israel: 'IL', 'cayman islands': 'KY', 'british virgin islands': 'VG', panama: 'PA',
};

export function countryIso2(name) {
  const t = String(name || '').trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  const k = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s*\([a-z]{2}\)\s*$/, '').trim();
  const m = /\(([A-Z]{2})\)\s*$/.exec(t);
  return NAME_TO_ISO2[k] || NAME_TO_ISO2[t.toLowerCase()] || (m ? m[1] : null);
}

/** Route for a country: 'nl' (KvK) | 'didit' | 'document'. */
export function pickProvider({ country, kvkMode = 'off', diditConfigured = true }) {
  const iso = countryIso2(country);
  if (iso === 'NL' && (kvkMode === 'test' || kvkMode === 'live')) return { route: 'nl', provider: 'kvk', iso2: iso };
  if (iso && diditConfigured) return { route: 'didit', provider: 'didit', iso2: iso };
  return { route: 'document', provider: 'document', iso2: iso };
}

/** The next route after a failure or "I cannot find my organisation". */
export function fallbackRoute(route, { diditConfigured = true } = {}) {
  if (route === 'nl') return diditConfigured ? 'didit' : 'document';
  return 'document';
}

export const providerLabel = (route) => (route === 'nl' ? 'KvK trade register' : route === 'didit' ? 'Didit company registry' : 'documents');
