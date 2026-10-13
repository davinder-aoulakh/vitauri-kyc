// Helpers for the FIU profiles tab in Tenant Config.
export const PROFILE_LABELS = { CW: 'FIU Curaçao', NL: 'FIU-Nederland' };
export const METHOD_LABELS = { portal_upload: 'Portal upload', xml_upload: 'XML upload', m2m: 'Machine-to-machine' };
export const WARNING = 'Deadlines and codes must be confirmed against current FIU guidance before go-live.';

/** Editable copy of a FiuProfile record. */
export function toDraft(p) {
  return {
    law: p.law || '', language: p.language || '',
    objective_deadline_hours: p.objective_deadline_hours ?? '',
    subjective_escalation_hours: p.subjective_escalation_hours ?? '',
    co_investigation_working_days: p.co_investigation_working_days ?? '',
    report_deadline_hours: p.report_deadline_hours ?? '',
    report_without_delay: !!p.report_without_delay,
    submission_method: p.submission_method || 'portal_upload',
    didit_template_ids: { unusual_objective: p.didit_template_ids?.unusual_objective || '', unusual_subjective: p.didit_template_ids?.unusual_subjective || '' },
    holiday_calendar: [...(p.holiday_calendar || [])],
    notes: p.notes || '',
    mandatory_fields: [...(p.mandatory_fields || [])],
    indicator_codes: (p.indicator_codes || []).map((c) => ({ code: c.code || '', label: c.label || '', type: c.type || 'subjective', sector: c.sector || '' })),
  };
}

/** scenario id -> selected codes for this profile code. */
export function toMappings(scenarios, profileCode) {
  return Object.fromEntries(scenarios.map((s) => [s.id, [...(s.fiu_indicator_codes?.[profileCode] || [])]]));
}

function splitCsvLine(line) {
  const out = []; let cur = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Parses "code,label,type,sector" (header optional). Returns { rows, errors }. */
export function parseIndicatorCsv(text, existingCodes = []) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  const rows = []; const errors = [];
  const seen = new Set(existingCodes);
  lines.forEach((line, i) => {
    const [code = '', label = '', type = '', sector = ''] = splitCsvLine(line);
    if (i === 0 && code.toLowerCase() === 'code') return;
    const t = type.toLowerCase();
    if (!code) errors.push(`Line ${i + 1}: code is missing`);
    else if (!['objective', 'subjective'].includes(t)) errors.push(`Line ${i + 1} (${code}): type must be objective or subjective`);
    else if (seen.has(code)) errors.push(`Line ${i + 1} (${code}): duplicate code`);
    else { seen.add(code); rows.push({ code, label, type: t, sector }); }
  });
  if (!lines.length) errors.push('The file is empty');
  return { rows, errors };
}