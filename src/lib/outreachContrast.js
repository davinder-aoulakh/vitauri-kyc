// Guided conversation portal: WCAG contrast helpers (phase 11). The tenant brand colour fills buttons, avatars and the
// client's bubbles; the text colour on it is chosen so it stays readable (4.5:1 where possible) for any brand colour.
const hex = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export function luminance(h) { const rgb = hex(h); if (!rgb) return null; const [r, g, b] = rgb.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
export function contrastRatio(a, b) {
  const la = luminance(a); const lb = luminance(b);
  if (la == null || lb == null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}
export const DARK_INK = '#0b1f18';
/** White or dark text on a brand colour, whichever contrasts more. */
export function inkFor(brand) {
  if (!hex(brand)) return '#ffffff';
  return contrastRatio('#ffffff', brand) >= contrastRatio(DARK_INK, brand) ? '#ffffff' : DARK_INK;
}
/** Inline CSS variables for a tenant brand colour (null when the tenant has none). */
export function brandStyle(brand) {
  if (!hex(brand)) return undefined;
  const ink = inkFor(brand);
  return { '--brand': brand, '--brand-ink': ink, '--me-ink': ink };
}
