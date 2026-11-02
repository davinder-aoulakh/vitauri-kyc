// riskSignals — evidence for the Risk Assessment "AI Suggest".
// collectSignals() turns what Vitauri already holds about a case (outreach answers, screening hits, stored Didit AML
// results, SoF assessment, OSINT, profile fields) into per-entity facts with a source label.
// ruleSuggestions() applies the triggers that must never depend on the model (declared PEP, crypto/gambling activity,
// open or confirmed screening matches, inadequate SoF). Pure: no I/O, runs in Deno and node.

const LABELS = {
  pep: /politically exposed|\bpep\b|politiek prominent/i,
  activities: /specific activit|expected activit|type(s)? of (transactions|activit)|activiteiten|transactiesoort/i,
  sof: /source of funds|herkomst (van het )?geld|bron van inkomsten/i,
  sow: /source of wealth|herkomst (van het )?vermogen/i,
  employment: /employment status|dienstverband|werksituatie/i,
  income: /income range|inkomen/i,
  purpose: /purpose of|doel van/i,
  nature: /nature of|aard van/i,
};
const SKIP_TYPES = new Set(['file_upload', 'signature', 'checkbox', 'id_verification', 'kyb_verification']);
const ANSWERED = new Set(['Received', 'Verified']);
const CLEARED_HIT = new Set(['Discounted', 'False_Positive', 'Dismissed', 'Closed_No_Match']);

const SECTOR_TERMS = [
  [/crypto|bitcoin|virtual asset|digital asset|cryptovaluta/i, 'crypto'],
  [/gambl|casino|betting|kansspel|gokken/i, 'gambling'],
  [/porn|adult entertainment|adult content/i, 'adult content'],
  [/weapon|arms|firearm|wapen/i, 'weapons'],
];
const CASH_TERM = /cash|contant/i;

const clip = (s, n = 300) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const dateOf = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toISOString().slice(0, 10) : ''; };
const parseJson = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };

export function isPepYes(answer) {
  const a = String(answer || '').trim();
  if (!a) return false;
  if (/^(no|nee|not|geen)\b/i.test(a) || /\bnot (a )?pep\b|\bgeen pep\b/i.test(a)) return false;
  return /^(yes|ja)\b/i.test(a) || /\bi('| a)?m a pep\b|\bben (een )?pep\b/i.test(a);
}

/** Latest answered value per outreach item label (requests newest first). */
export function outreachAnswers(requests) {
  const sorted = [...(requests || [])].sort((a, b) => String(b.updated_date || b.created_date || '').localeCompare(String(a.updated_date || a.created_date || '')));
  const seen = new Map();
  const idv = [];
  for (const req of sorted) {
    for (const item of req.items || []) {
      if (item.field_type === 'id_verification' && item.idv_aml_status) {
        idv.push({ status: item.idv_aml_status, hits: Number(item.idv_aml_hits) || 0, date: dateOf(item.idv_checked_at || req.updated_date) });
      }
      if (SKIP_TYPES.has(item.field_type) || !ANSWERED.has(item.status)) continue;
      const label = clip(item.label, 80);
      const text = clip(item.response_text, 400);
      if (!label || !text || /^[[{]/.test(text) || seen.has(label.toLowerCase())) continue;
      seen.set(label.toLowerCase(), { label, text, date: dateOf(req.updated_date || req.created_date) });
    }
  }
  return { answers: [...seen.values()], idv };
}

function kindOf(label) {
  return Object.keys(LABELS).find((k) => LABELS[k].test(label)) || 'other';
}

/**
 * Facts per entity key ('client', 'rp_<id>').
 * @returns {{ entities: Array<{key,label,type,facts:Array<{kind,text,source}>}>, used: object }}
 */
export function collectSignals({ client, kycCase, outreach = [], hits = [], relatedParties = [], links = [] }) {
  const clientType = client?.client_type === 'ORG' ? 'ORG_Client' : 'NP_Client';
  const ents = [{ key: 'client', label: client?.full_name || 'Client', type: clientType, facts: [] }];
  const linkByRp = new Map((links || []).map((l) => [l.related_party_id, l]));
  for (const rp of relatedParties || []) {
    ents.push({ key: `rp_${rp.id}`, label: rp.full_name || 'Related party', type: rp.party_type === 'ORG' ? 'ORG_Related_Party' : 'NP_Related_Party', facts: [], rp });
  }
  const byKey = new Map(ents.map((e) => [e.key, e]));
  const add = (key, kind, text, source, extra = {}) => { const e = byKey.get(key); if (e && text) e.facts.push({ kind, text: clip(text), source, ...extra }); };
  const used = { outreach_answers: 0, screening_hits: 0, didit_aml: false, sof: false, osint: false };

  // Profile facts
  const c = client || {};
  [['Nationality', c.nationality], ['Country of residence', c.country_of_residence], ['Registered country', c.registered_country],
    ['Country of birth', c.country_of_birth], ['Sector', c.sector], ['Occupation', c.occupation], ['Employer', c.employer_name],
    ['Legal form', c.legal_form], ['Source channel', c.source_channel]]
    .forEach(([l, v]) => { if (v && v !== 'null') add('client', 'profile', `${l}: ${v}`, 'Client profile'); });
  if (kycCase?.purpose_nature_text) add('client', 'purpose', kycCase.purpose_nature_text, 'Case: Purpose & Nature');
  for (const e of ents.slice(1)) {
    const rp = e.rp; const l = linkByRp.get(rp.id) || {};
    const role = rp.role_in_relationship || l.role || l.relationship_type;
    const pct = rp.ownership_percentage ?? l.ownership_percentage;
    add(e.key, 'profile', [role && `Role: ${role}`, pct != null && `ownership ${pct}%`, rp.nationality && `nationality ${rp.nationality}`,
      rp.country_of_residence && `residence ${rp.country_of_residence}`, rp.registered_country && `registered in ${rp.registered_country}`,
      rp.sector && `sector ${rp.sector}`, rp.verification_status && `verification ${rp.verification_status}`].filter(Boolean).join(', '), 'Related party profile');
  }

  // Outreach answers (the client's own declarations)
  const { answers, idv } = outreachAnswers(outreach);
  used.outreach_answers = answers.length;
  for (const a of answers) {
    const kind = kindOf(a.label);
    const source = `Outreach${a.date ? ` ${a.date}` : ''}: ${a.label}`;
    if (kind === 'pep') add('client', 'pep_declared', `${a.label} = "${a.text}"`, source, { pep_yes: isPepYes(a.text) });
    else add('client', kind === 'other' ? 'declaration' : kind, `${a.label} = "${a.text}"`, source);
  }

  // Stored Didit AML results (outreach ID&V items)
  for (const r of idv) {
    used.didit_aml = true;
    add('client', 'didit_aml', `Didit AML screening: status ${r.status}, ${r.hits} hit(s)`, `Didit ID&V${r.date ? ` ${r.date}` : ''}`, { aml_status: r.status, aml_hits: r.hits });
  }

  // Screening hits
  for (const h of hits || []) {
    if (CLEARED_HIT.has(h.status) || h.analyst_decision === 'Discounted') continue;
    const key = h.related_party_id ? `rp_${h.related_party_id}` : 'client';
    if (!byKey.has(key)) continue;
    used.screening_hits += 1;
    const confirmed = h.status === 'Confirmed_Match' || h.analyst_decision === 'Confirmed';
    const state = confirmed ? 'confirmed' : 'open';
    if (h.source === 'Didit_AML') {
      const d = parseJson(h.hit_details) || {};
      used.didit_aml = true;
      add(key, 'didit_aml', `Didit AML alert (${state}): ${d.aml_hits ?? '?'} hit(s), Didit status ${d.aml_status || 'unknown'}`, 'Screening', { aml_status: d.aml_status, aml_hits: Number(d.aml_hits) || 0, confirmed });
      continue;
    }
    const kind = h.source === 'PEP_List' ? 'screening_pep' : h.source === 'Adverse_Media' ? 'screening_adverse' : 'screening_sanctions';
    add(key, kind, `${state} ${String(h.source || '').replace(/_/g, ' ')} hit "${clip(h.hit_name, 80)}"${h.confidence_score != null ? ` (${h.confidence_score}%)` : ''}`, 'Screening', { confirmed });
  }

  // SoF / SoW assessment
  const sof = parseJson(kycCase?.sof_narrative);
  if (sof) {
    used.sof = true;
    for (const part of ['sof', 'sow']) {
      const p = sof[part];
      if (!p) continue;
      const sources = (p.sources || []).map((s) => (typeof s === 'string' ? s : s?.source || s?.label)).filter(Boolean).join(', ');
      const txt = [sources && `sources ${sources}`, p.adequacy && `adequacy ${p.adequacy}`, p.explanation && clip(p.explanation, 200)].filter(Boolean).join('; ');
      if (txt) add('client', 'sof_assessment', `${part === 'sof' ? 'Source of funds' : 'Source of wealth'}: ${txt}`, 'SoF/SoW step', { adequacy: p.adequacy || '' });
    }
  } else if (kycCase?.sof_narrative) {
    used.sof = true;
    add('client', 'sof_assessment', clip(kycCase.sof_narrative, 300), 'SoF/SoW step');
  }

  // OSINT (only findings about the subject)
  const osint = parseJson(kycCase?.osint_cache);
  const findings = osint?.results?.findings || osint?.findings || [];
  for (const f of findings) {
    if (!f?.is_adverse || !['confirmed', 'likely', undefined].includes(f.subject_match)) continue;
    used.osint = true;
    add('client', 'osint_adverse', `${f.subject_match || 'unrated'} adverse finding: ${clip(f.title, 120)} — ${clip(f.summary, 160)}`, 'OSINT', { confirmed: f.subject_match === 'confirmed' });
  }

  return { entities: ents.map(({ rp, ...e }) => e), used };
}

/**
 * Fixed triggers. indicators: [{ id, name, applies }] (canonical ids: pep, pep_rp, sector, cash, sanctions, sof).
 * @returns Array<{ entity_key, indicator_id, reason, evidence, origin:'rule' }>
 */
export function ruleSuggestions(signals, indicators) {
  const byId = new Map((indicators || []).map((i) => [i.id, i]));
  const out = new Map();
  const typeOf = new Map(signals.entities.map((e) => [e.key, e.type]));
  const put = (key, id, reason, evidence) => {
    const ind = byId.get(id);
    if (!ind || !(ind.applies || []).includes(typeOf.get(key))) return false;
    const k = `${key}|${id}`;
    if (!out.has(k)) out.set(k, { entity_key: key, indicator_id: id, reason, evidence, origin: 'rule' });
    return true;
  };
  // PEP on the entity itself when it can carry "pep", otherwise "pep_rp" (e.g. ORG declaring a PEP)
  const pepOn = (key, reason, evidence) => put(key, 'pep', reason, evidence) || put(key, 'pep_rp', reason, evidence);

  for (const e of signals.entities) {
    for (const f of e.facts) {
      if (f.kind === 'pep_declared' && f.pep_yes) pepOn(e.key, 'The client declared PEP status in outreach.', `${f.source} — ${f.text}`);
      if (f.kind === 'screening_pep') {
        pepOn(e.key, `${f.confirmed ? 'Confirmed' : 'Open'} PEP screening match.`, `${f.source} — ${f.text}`);
        if (e.key !== 'client') put('client', 'pep_rp', `Related party ${e.label} has a ${f.confirmed ? 'confirmed' : 'open'} PEP screening match.`, `${f.source} — ${f.text}`);
      }
      if (f.kind === 'pep_declared' && f.pep_yes && e.key !== 'client') put('client', 'pep_rp', `Related party ${e.label} is a declared PEP.`, `${f.source} — ${f.text}`);
      if (f.kind === 'activities') {
        const hitTerms = SECTOR_TERMS.filter(([re]) => re.test(f.text)).map(([, n]) => n);
        if (hitTerms.length) put(e.key, 'sector', `Declared high-risk activity: ${hitTerms.join(', ')}.`, `${f.source} — ${f.text}`);
        if (CASH_TERM.test(f.text)) put(e.key, 'cash', 'Declared cash deposits / cash-intensive activity.', `${f.source} — ${f.text}`);
      }
      if (f.kind === 'screening_sanctions' || f.kind === 'screening_adverse') {
        put(e.key, 'sanctions', `${f.confirmed ? 'Confirmed' : 'Open'} ${f.kind === 'screening_adverse' ? 'adverse media' : 'sanctions'} screening match.`, `${f.source} — ${f.text}`);
      }
      if (f.kind === 'didit_aml' && f.aml_hits > 0 && (f.confirmed || (f.aml_status && !/approved/i.test(f.aml_status)))) {
        put(e.key, 'sanctions', `Didit AML reported ${f.aml_hits} possible match(es) that were not cleared.`, `${f.source} — ${f.text}`);
      }
      if (f.kind === 'osint_adverse' && f.confirmed) put(e.key, 'sanctions', 'OSINT found confirmed adverse information about the subject.', `${f.source} — ${f.text}`);
      if (f.kind === 'sof_assessment' && /not adequate|inadequate|niet (toereikend|adequaat)/i.test(f.adequacy || '')) {
        put(e.key, 'sof', 'The SoF/SoW assessment was rated not adequate.', `${f.source} — ${f.text}`);
      }
    }
  }
  return [...out.values()];
}

/** Prompt text for the model: facts per entity. */
export function signalsPrompt(signals) {
  return signals.entities.map((e) => {
    const facts = e.facts.length ? e.facts.map((f) => `  - [${f.source}] ${f.text}`).join('\n') : '  - (no facts on file)';
    return `${e.key} | ${e.label} (${e.type}):\n${facts}`;
  }).join('\n\n');
}
