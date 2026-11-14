// Expected use of the account, as answered by the client in the outreach (questions linked to expected_use.*).
// Pure: collects the answers and merges them into the step-4 form without overwriting what the analyst entered.
import { EXPECTED_USE_FIELDS } from '@/lib/profileFieldMap';

const ANSWERED = ['Received', 'Verified'];
const MULTI = ['types', 'geographies'];
const has = (v) => (Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== '');

/** Options of a multi-select found in the stored text ("A, B"); matched per option, because options can contain commas. */
export function pickOptions(text, options) {
  if (Array.isArray(text)) return options.filter((o) => text.includes(o));
  const t = String(text || '').toLowerCase();
  return options.filter((o) => t.includes(o.toLowerCase()));
}

/** { values: { types, frequency, … }, at, labels } from the case's outreach requests (latest answer per field wins). */
export function collectExpectedUse(requests) {
  const values = {}; const labels = {}; const when = {};
  for (const req of requests || []) {
    for (const item of req.items || []) {
      const pf = String(item.profile_field || '');
      if (!pf.startsWith('expected_use.') || !ANSWERED.includes(item.status)) continue;
      const key = pf.split('.')[1];
      const def = EXPECTED_USE_FIELDS.find((f) => f.key === pf);
      if (!def) continue;
      const raw = item.response_value != null && typeof item.response_value !== 'object' ? item.response_value : item.response_text;
      let v;
      if (MULTI.includes(key)) v = pickOptions(Array.isArray(item.response_value) ? item.response_value : raw, def.options);
      else if (def.options) v = def.options.find((o) => o.toLowerCase() === String(raw || '').trim().toLowerCase()) || '';
      else if (def.fieldType === 'number') v = String(raw ?? '').replace(/[^\d.]/g, '');
      else v = String(raw || '').trim();
      if (!has(v)) continue;
      const at = item.submitted_at || req.updated_date || req.created_date || '';
      if (when[key] && String(at) < String(when[key])) continue;
      values[key] = v; labels[key] = item.label; when[key] = at;
    }
  }
  const dates = Object.values(when).filter(Boolean).sort();
  return { values, labels, at: dates[dates.length - 1] || null };
}

const same = (a, b) => (Array.isArray(a) || Array.isArray(b)
  ? JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort())
  : String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase());

/** Fills empty fields from the client's answers. Returns { next, filled: [keys], differing: [keys] }. */
export function mergeExpectedUse(current, answers) {
  const next = { ...(current || {}) }; const filled = []; const differing = [];
  for (const [key, v] of Object.entries(answers || {})) {
    if (!has(next[key])) { next[key] = v; filled.push(key); }
    else if (!same(next[key], v)) differing.push(key);
  }
  return { next, filled, differing };
}

export const showAnswer = (v) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''));
