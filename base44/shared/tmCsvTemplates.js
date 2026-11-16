// Named column-mapping templates for CSV / Excel statements (phase 10). Pure: no I/O.
// Stored per tenant in tm_settings.csv_templates: [{ id, name, by_header: { field: 'Header text' } }].
// A template says which header holds the date, amount (or debit / credit), balance, currency, description,
// counterparty and direction. parseStatement tries the tenant's templates first, in order.

export const TEMPLATE_FIELDS = ['date', 'amount', 'debit', 'credit', 'balance', 'currency', 'description', 'counterparty', 'direction'];
export const MAX_TEMPLATES = 30;

function settingsOf(tenant) {
  const s = tenant?.tm_settings;
  if (!s) return {};
  if (typeof s === 'string') { try { return JSON.parse(s) || {}; } catch { return {}; } }
  return typeof s === 'object' ? s : {};
}
const text = (v, n) => String(v ?? '').trim().slice(0, n);

/** A usable template or null: a name, a date column and an amount (or debit / credit) column are required. */
export function cleanTemplate(input) {
  const name = text(input?.name, 80);
  const by = {};
  for (const f of TEMPLATE_FIELDS) { const h = text(input?.by_header?.[f], 120); if (h) by[f] = h; }
  if (!name || !by.date || !(by.amount || by.debit || by.credit)) return null;
  const id = text(input?.id, 40) || `tpl_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'x'}`;
  return { id, name, by_header: by };
}

/** The tenant's templates, cleaned; unusable entries and duplicate ids are dropped. */
export function templatesOf(tenant) {
  const seen = new Set();
  const out = [];
  for (const raw of settingsOf(tenant).csv_templates || []) {
    const t = cleanTemplate(raw);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id); out.push(t);
    if (out.length >= MAX_TEMPLATES) break;
  }
  return out;
}

/** The first template whose headers are all in the file. `matches(matrix, { by_header })` is tmStatementParse.matchesSavedMap. */
export function pickTemplate(matrix, templates, matches) {
  return (templates || []).find((t) => matches(matrix, { by_header: t.by_header })) || null;
}

/** A template from a reviewed upload's column map (StatementUpload.column_map.by_header). */
export function templateFromUpload(upload, name) {
  return cleanTemplate({ name, by_header: upload?.column_map?.by_header });
}
