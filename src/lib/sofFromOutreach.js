// Turns the client's Source of Funds / Wealth answers from the outreach portal into a prefill for the SoF/SoW step:
// the client's own words (labelled, dated) plus the matching source checkboxes. Pure functions; no I/O.
import { format } from 'date-fns';

const KINDS = {
  sof: /source of funds|herkomst (van (het|de) )?(geld|middelen)|bron van (de )?(inkomsten|middelen)/i,
  sow: /source of wealth|herkomst (van (het )?)?vermogen|bron van (het )?vermogen/i,
  employment: /employment status|employment|dienstverband|werksituatie|arbeidssituatie/i,
  income: /income range|annual income|inkomen/i,
  activities: /specific activities|activiteiten/i,
};
const ANSWERED = ['Received', 'Verified'];
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const fmt = (d) => { const x = new Date(d); return Number.isNaN(x.getTime()) ? '' : format(x, 'd MMM yyyy'); };

/**
 * Latest answered outreach item per kind: { sof, sow, employment, income, activities } -> { text, label, date } | null.
 * The SoW kind wins over SoF when a label matches both.
 */
export function collectSofAnswers(requests = []) {
  const out = { sof: null, sow: null, employment: null, income: null, activities: null };
  const items = (requests || []).flatMap((r) => (r.items || []).map((i) => ({ ...i, _date: i.submitted_at || i.received_at || r.updated_date || r.created_date })));
  for (const item of items) {
    const text = clean(Array.isArray(item.response_value) ? item.response_value.join(', ') : item.response_text);
    if (!text || text.startsWith('{') || !ANSWERED.includes(item.status)) continue;
    const label = String(item.label || '');
    const kind = KINDS.sow.test(label) ? 'sow' : Object.keys(KINDS).find((k) => k !== 'sow' && KINDS[k].test(label));
    if (!kind) continue;
    const prev = out[kind];
    if (!prev || new Date(item._date || 0) >= new Date(prev.date || 0)) out[kind] = { text, label, date: item._date || null };
  }
  return out;
}

// Keyword rules (EN + NL) per checkbox label used in SoFSoWStep. A rule only applies when its label is in the step's options.
const RULES = [
  ['Salary / Employment Income', /salar|wage|(?<!self[- ]?)(?<!un)employ(ed|ment)|payroll|\bloon\b|salaris|in dienst/i],
  ['Business Income / Dividends', /business|dividend|self[- ]?employ|zzp|freelanc|consultan|onderneming|eigen bedrijf|winst/i],
  ['Trading / Operating Revenue', /business|trading|operat|revenue|turnover|sales|consultan|services|omzet|bedrijfsactiviteit/i],
  ['Dividend Income', /dividend/i],
  ['Sale of Property', /(sold|sale of|selling|verkoop).{0,25}(house|home|property|apartment|real estate|woning|huis|pand)|(house|property|woning|huis).{0,15}(sold|verkocht)/i],
  ['Asset Sale Proceeds', /(sold|sale of|verkoop)/i],
  ['Inheritance', /inherit|erfenis|nalatenschap|geërfd/i],
  ['Investment Returns', /invest|beleg|stocks|shares|aandelen|crypto|return/i],
  ['Investment Income', /invest|beleg|interest|rente/i],
  ['Pension', /pension|pensioen|retire/i],
  ['Loan / Credit Facility', /\bloan\b|mortgage|credit|lening|hypotheek|krediet/i],
  ['Loan / Debt Facility', /\bloan\b|debt|credit|lening|financiering/i],
  ['Capital Raise / Equity', /capital raise|equity|funding round|investor|kapitaal/i],
  ['Gift', /\bgift\b|donation|schenking/i],
  // Source of wealth
  ['Lifetime Savings', /saving|spaargeld|spaar|savings/i],
  ['Business Ownership / Sale', /(sold|sale of|verkoop).{0,25}(business|company|bedrijf|onderneming)|business owner|shareholder|aandeelhouder/i],
  ['Inheritance / Gift', /inherit|erfenis|\bgift\b|schenking/i],
  ['Property Portfolio', /propert|real estate|vastgoed|woning|rental/i],
  ['Investment Portfolio', /invest|beleg|portfolio|stocks|shares|aandelen|crypto/i],
  ['Pension / Retirement Funds', /pension|pensioen|retire/i],
  ['Compensation / Settlement', /compensation|settlement|schadevergoeding|severance|ontslagvergoeding/i],
];

/** Checkbox labels (from `options`) that the free text points to; "Other: …" when nothing matches. */
export function mapSources(text, options = [], { allowOther = true } = {}) {
  const t = clean(text);
  if (!t) return [];
  const hits = RULES.filter(([label, re]) => options.includes(label) && re.test(t)).map(([label]) => label);
  // "Asset Sale Proceeds" only when no more specific sale applies.
  const out = [...new Set(hits)];
  if (out.length) return out;
  return allowOther && options.includes('Other') ? [`Other: ${t.slice(0, 60)}${t.length > 60 ? '…' : ''}`] : [];
}

/** The client's own words as an explanation block, labelled and dated so the analyst can tell it from their own text. */
export function buildExplanation(answers, which = 'sof') {
  const main = answers?.[which];
  const lines = [];
  if (main) lines.push(`Client declaration (outreach${main.date ? `, ${fmt(main.date)}` : ''}): "${main.text}"`);
  if (which === 'sof') {
    const ctx = [
      answers?.employment && `Employment status: ${answers.employment.text}`,
      answers?.income && `Income range: ${answers.income.text}`,
      answers?.activities && `Specific activities: ${answers.activities.text}`,
    ].filter(Boolean);
    if (ctx.length) lines.push(ctx.join(' · '));
  }
  return lines.join('\n');
}

/** Marker used to see whether the declaration is already in an explanation. */
export const declarationMarker = (answers, which = 'sof') => (answers?.[which] ? `"${answers[which].text}"` : '');

/**
 * Prefill for the step from the answers. Returns { sof: { sources, explanation }, sow: { sources, explanation } | null }.
 * SoW comes from a SoW answer, or from wealth words in the SoF answer (savings, investments, inheritance, property).
 */
export function prefillFromAnswers(answers, { sofOptions = [], sowOptions = [] } = {}) {
  if (!answers?.sof && !answers?.sow && !answers?.employment) return null;
  const sofText = [answers.sof?.text, answers.employment?.text].filter(Boolean).join('. ');
  const sof = {
    sources: answers.sof || answers.employment ? mapSources(sofText, sofOptions, { allowOther: !!answers.sof }) : [],
    explanation: buildExplanation(answers, 'sof'),
  };
  let sow = null;
  if (sowOptions.length) {
    if (answers.sow) sow = { sources: mapSources(answers.sow.text, sowOptions), explanation: buildExplanation(answers, 'sow') };
    else if (answers.sof) {
      const s = mapSources(answers.sof.text, sowOptions, { allowOther: false });
      if (s.length) sow = { sources: s, explanation: `Indicated in the client's source of funds declaration${answers.sof.date ? ` (outreach, ${fmt(answers.sof.date)})` : ''}: "${answers.sof.text}"` };
    }
  }
  return { sof, sow };
}
