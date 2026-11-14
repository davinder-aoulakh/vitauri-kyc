// addressParse — splits a one-line address ("Van Goyenstraat 7, 5161 VL Sprang-Capelle, Netherlands") into the KYC
// address parts. Pure; used by buildProfileSuggestions for outreach answers that were stored as text only.
// Returns { street, number, zipcode, city, country } with only the parts it is confident about, or null.

const COUNTRY_HINT = /^(the )?(netherlands|nederland|belgium|belgi[eë]|germany|deutschland|duitsland|france|frankrijk|united kingdom|uk|england|scotland|wales|ireland|spain|italy|portugal|luxembourg|switzerland|austria|denmark|sweden|norway|finland|poland|united states|usa|cura[cç]ao|aruba|suriname|sint maarten)$/i;
// Postcode patterns: NL "5161 VL", UK "SW1A 1AA", 4–5 digit (BE/DE/FR/…)
const ZIP = [/\b\d{4}\s?[A-Za-z]{2}\b/, /\b[A-Za-z]{1,2}\d[A-Za-z\d]?\s?\d[A-Za-z]{2}\b/, /\b\d{5}\b/, /\b\d{4}\b/];
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '').trim();

function splitStreet(line) {
  const s = clean(line);
  // "Van Goyenstraat 7", "Main Street 12A", "Keizersgracht 123-2", or UK/US style "12 Main Street"
  let m = s.match(/^(.*?[^\d\s])\s+(\d+[\w\-/ ]{0,8})$/);
  if (m) return { street: clean(m[1]), number: clean(m[2]) };
  m = s.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (m) return { street: clean(m[2]), number: clean(m[1]) };
  return { street: s };
}

export function parseAddressLine(text, { looksLikeCountry } = {}) {
  const raw = clean(text);
  if (!raw || raw.length < 5) return null;
  const parts = raw.split(/,|\n/).map(clean).filter(Boolean);
  if (!parts.length) return null;
  const out = {};
  const isCountry = (p) => COUNTRY_HINT.test(p) || (looksLikeCountry ? !!looksLikeCountry(p) : false);

  // Country: the last part when it reads as one
  if (parts.length > 1 && isCountry(parts[parts.length - 1])) out.country = parts.pop();

  // Postcode + city: the part that holds a postcode
  let zipIdx = -1;
  let zip = null;
  for (let i = parts.length - 1; i >= 0 && zipIdx < 0; i--) {
    for (const re of ZIP) {
      const m = parts[i].match(re);
      // A bare 4-digit number in the first part is a house number, not a postcode
      if (m && !(i === 0 && parts.length > 1 && re === ZIP[3])) { zipIdx = i; zip = m[0]; break; }
    }
  }
  if (zipIdx >= 0) {
    out.zipcode = zip.toUpperCase().replace(/^(\d{4})\s?([A-Z]{2})$/, '$1 $2');
    // City: what follows the postcode in that part ("5161 VL Sprang-Capelle"), else what stands before it ("London SW1A 2AA")
    const at = parts[zipIdx].indexOf(zip);
    const city = clean(parts[zipIdx].slice(at + zip.length)) || (parts.length > 1 ? clean(parts[zipIdx].slice(0, at)) : '');
    if (city) out.city = city;
    else if (parts[zipIdx + 1]) out.city = parts[zipIdx + 1];
    else if (zipIdx > 1) out.city = parts[zipIdx - 1];
  } else if (parts.length >= 2) {
    out.city = parts[parts.length - 1];
  }

  // Street + number: the first part (unless it is the postcode part itself)
  if (zipIdx !== 0 && parts[0]) Object.assign(out, splitStreet(parts[0]));
  else if (zipIdx === 0 && parts.length === 1) {
    // Everything on one line without commas: "Van Goyenstraat 7 5161 VL Sprang-Capelle"
    const before = clean(parts[0].slice(0, parts[0].indexOf(zip)));
    if (before) Object.assign(out, splitStreet(before));
  }
  // A lone street name without number, postcode or city is not a usable split
  if (Object.keys(out).length === 1 && out.street) return null;
  return Object.keys(out).length ? out : null;
}
