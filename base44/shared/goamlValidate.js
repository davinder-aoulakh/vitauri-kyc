// Structural validation of a goAML report XML against the goAML schema rules Vitauri relies on: well-formedness, required
// elements and their order, value formats, one from-side and one to-side per transaction, and the transaction/activity choice
// per report type. It is not a full XSD validation; the FIU portal remains the final check. Errors block approval.
import { XMLValidator, XMLParser } from 'npm:fast-xml-parser@4.4.1';
import { GOAML_REPORT_ORDER } from './goamlXml.js';
import { FIU_TYPES, normaliseType } from './fiuTypes.js';

const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const AMOUNT = /^\d+(\.\d{1,2})?$/;
const ISO2 = /^[A-Z]{2}$/;
const CUR = /^[A-Z]{3}$/;
const ARRAYS = new Set(['transaction', 'indicator', 'director_id', 'report_party', 'phone', 'address', 'signatory']);
const arr = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const txt = (v) => (v === undefined || v === null ? '' : typeof v === 'object' ? '' : String(v).trim());

/** Returns { ok, errors: [{ path, message }], warnings: [{ path, message }] }. */
export function validateGoamlXml(xml, { type } = {}) {
  const errors = [];
  const warnings = [];
  const err = (path, message) => errors.push({ path, message });
  const warn = (path, message) => warnings.push({ path, message });

  const wf = XMLValidator.validate(String(xml || ''));
  if (wf !== true) {
    err('xml', `Not well-formed XML: ${wf?.err?.msg || 'parse error'}${wf?.err?.line ? ` (line ${wf.err.line})` : ''}`);
    return { ok: false, errors, warnings };
  }
  const ordered = new XMLParser({ preserveOrder: true, ignoreDeclaration: true }).parse(xml);
  const rootEl = ordered.find((n) => n.report);
  if (!rootEl) { err('report', 'The root element must be <report>'); return { ok: false, errors, warnings }; }
  const names = rootEl.report.map((n) => Object.keys(n).find((k) => k !== ':@')).filter(Boolean);
  let last = -1;
  for (const n of names) {
    const i = GOAML_REPORT_ORDER.indexOf(n);
    if (i === -1) { err(`report.${n}`, `Unknown element <${n}> in <report>`); continue; }
    if (i < last) err(`report.${n}`, `<${n}> is out of order (goAML sequence: ${GOAML_REPORT_ORDER.join(', ')})`);
    last = Math.max(last, i);
  }

  const doc = new XMLParser({ ignoreDeclaration: true, parseTagValue: false, isArray: (name) => ARRAYS.has(name) }).parse(xml);
  const r = doc.report || {};
  const reportType = normaliseType(type || txt(r.report_code));
  const kind = FIU_TYPES[reportType]?.kind || 'transaction';

  // Header.
  if (!txt(r.rentity_id)) err('report.rentity_id', 'Reporting entity ID is required (set it in the FIU profile)');
  if (!['E', 'M'].includes(txt(r.submission_code))) err('report.submission_code', 'Submission code must be E or M');
  if (!txt(r.report_code)) err('report.report_code', 'Report code is required');
  if (!txt(r.entity_reference)) err('report.entity_reference', 'Entity reference is required');
  if (!DATE.test(txt(r.submission_date))) err('report.submission_date', 'Submission date must be yyyy-MM-ddTHH:mm:ss');
  if (!CUR.test(txt(r.currency_code_local))) err('report.currency_code_local', 'Local currency must be a 3-letter ISO 4217 code');
  const rp = r.reporting_person || {};
  if (!txt(rp.last_name)) err('report.reporting_person.last_name', 'Reporting person last name is required');
  if (!txt(rp.first_name)) warn('report.reporting_person.first_name', 'Reporting person first name is empty');
  if (!txt(rp.email) && !rp.phones) warn('report.reporting_person', 'Reporting person has no email or phone');
  const loc = r.location || {};
  if (!r.location) err('report.location', 'Reporting location is required (set it in the FIU profile)');
  else {
    if (!txt(loc.address)) err('report.location.address', 'Location address is required');
    if (!txt(loc.city)) err('report.location.city', 'Location city is required');
    if (!ISO2.test(txt(loc.country_code))) err('report.location.country_code', 'Location country must be an ISO 3166-1 alpha-2 code');
  }
  if (!txt(r.reason)) err('report.reason', 'Reason for reporting is required');
  if (txt(r.reason).length > 4000) warn('report.reason', 'Reason is longer than 4000 characters; some FIU portals cut it off');

  // Body: transaction(s) or activity.
  const txns = arr(r.transaction);
  if (kind === 'transaction') {
    if (r.activity) err('report.activity', `${reportType} reports carry transactions, not an activity`);
    if (!txns.length) err('report.transaction', `${reportType} needs at least one transaction`);
    txns.forEach((t, i) => {
      const p = `transaction[${i}]`;
      if (!txt(t.transactionnumber)) err(`${p}.transactionnumber`, `Transaction ${i + 1}: number is required`);
      if (!DATE.test(txt(t.date_transaction))) err(`${p}.date_transaction`, `Transaction ${i + 1}: date must be yyyy-MM-ddTHH:mm:ss`);
      if (!txt(t.transmode_code)) err(`${p}.transmode_code`, `Transaction ${i + 1}: transmission mode is required`);
      if (!AMOUNT.test(txt(t.amount_local)) || Number(t.amount_local) <= 0) err(`${p}.amount_local`, `Transaction ${i + 1}: amount in local currency is required (positive, 2 decimals)`);
      const froms = ['t_from', 't_from_my_client'].filter((k) => t[k]);
      const tos = ['t_to', 't_to_my_client'].filter((k) => t[k]);
      if (froms.length !== 1) err(`${p}.t_from`, `Transaction ${i + 1}: exactly one from-side (t_from or t_from_my_client) is required`);
      if (tos.length !== 1) err(`${p}.t_to`, `Transaction ${i + 1}: exactly one to-side (t_to or t_to_my_client) is required`);
      if (!t.t_from_my_client && !t.t_to_my_client) err(`${p}`, `Transaction ${i + 1}: one side must be the reporting entity's client (t_from_my_client or t_to_my_client)`);
      for (const [sideKey, pre] of [[froms[0], 'from'], [tos[0], 'to']]) {
        const sd = sideKey ? t[sideKey] : null;
        if (!sd) continue;
        const party = ['account', 'person', 'entity'].filter((k) => sd[`${pre}_${k}`]);
        if (party.length !== 1) err(`${p}.${sideKey}`, `Transaction ${i + 1}: ${sideKey} needs exactly one of ${pre}_account, ${pre}_person or ${pre}_entity`);
        if (!txt(sd[`${pre}_funds_code`])) err(`${p}.${sideKey}.${pre}_funds_code`, `Transaction ${i + 1}: ${pre} funds code is required`);
        const c = txt(sd[`${pre}_country`]);
        if (c && !ISO2.test(c)) err(`${p}.${sideKey}.${pre}_country`, `Transaction ${i + 1}: ${pre} country must be ISO 3166-1 alpha-2`);
        if (!c) warn(`${p}.${sideKey}.${pre}_country`, `Transaction ${i + 1}: ${pre} country is unknown`);
        const acc = sd[`${pre}_account`];
        if (acc && !txt(acc.account)) err(`${p}.${sideKey}.${pre}_account.account`, `Transaction ${i + 1}: account number is required`);
        const ent = sd[`${pre}_entity`];
        if (ent && !txt(ent.name)) err(`${p}.${sideKey}.${pre}_entity.name`, `Transaction ${i + 1}: entity name is required`);
        const per = sd[`${pre}_person`];
        if (per && !txt(per.last_name)) err(`${p}.${sideKey}.${pre}_person.last_name`, `Transaction ${i + 1}: person last name is required`);
      }
    });
  } else {
    if (txns.length) err('report.transaction', `${reportType} reports carry an activity, not transactions`);
    const parties = arr(r.activity?.report_parties?.report_party);
    if (!parties.length) err('report.activity.report_parties', `${reportType} needs at least one report party`);
    parties.forEach((pt, i) => {
      const subj = ['person', 'person_my_client', 'entity', 'entity_my_client', 'account', 'account_my_client'].filter((k) => pt[k]);
      if (subj.length !== 1) err(`report_party[${i}]`, `Report party ${i + 1}: exactly one person, entity or account is required`);
      const per = pt.person || pt.person_my_client;
      if (per && !txt(per.last_name)) err(`report_party[${i}].person.last_name`, `Report party ${i + 1}: last name is required`);
      const ent = pt.entity || pt.entity_my_client;
      if (ent && !txt(ent.name)) err(`report_party[${i}].entity.name`, `Report party ${i + 1}: entity name is required`);
      if (!txt(pt.reason)) err(`report_party[${i}].reason`, `Report party ${i + 1}: reason is required`);
    });
  }

  // Dates and country codes anywhere in the document.
  const walk = (o, path) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      const p = `${path}.${k}`;
      for (const item of arr(v)) {
        if (item && typeof item === 'object') walk(item, p);
        else if (/(^|_)(birthdate|expiry_date|issue_date)$/.test(k) && txt(item) && !DATE.test(txt(item))) err(p, `${k} must be yyyy-MM-ddTHH:mm:ss`);
        else if (/(country_code|nationality1|residence|issue_country)$/.test(k) && txt(item) && !ISO2.test(txt(item))) err(p, `${k} must be ISO 3166-1 alpha-2 (got "${txt(item)}")`);
      }
    }
  };
  walk(r, 'report');
  if (!arr(r.report_indicators?.indicator).length) warn('report.report_indicators', 'No report indicator. Most FIUs require at least one indicator code; map them in the FIU profile.');
  return { ok: errors.length === 0, errors, warnings };
}
