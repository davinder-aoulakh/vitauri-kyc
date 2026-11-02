// FIU report PDF for internal records and the four-eyes review (pdf-lib, standard fonts). Pure apart from pdf-lib.
// Contents: cover facts, subject and related parties, transactions, reason, indicators, goAML validation, four-eyes block
// with signature lines, the goAML XML SHA-256, and the audit trail. A DRAFT watermark shows until the report is approved.
import { PDFDocument, StandardFonts, rgb, degrees } from 'npm:pdf-lib@1.17.1';
import { typeLabelOf } from './fiuTypes.js';

const A4 = [595.28, 841.89];
const M = 48;
const s = (v) => (v === undefined || v === null ? '' : String(v));
const fmtDate = (v) => { const d = new Date(v); return v && !Number.isNaN(d.getTime()) ? d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—'; };
const hex = (h, fb) => { const m = /^#?([0-9a-f]{6})$/i.exec(s(h)); if (!m) return fb; const n = parseInt(m[1], 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

export async function buildFiuReportPdf({ report, fiu, tenant, client, users = [], audits = [], xmlHash, validation, draft }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const primary = hex(tenant?.branding_primary_color, rgb(0.07, 0.15, 0.3));
  const muted = rgb(0.4, 0.43, 0.48);
  const line = rgb(0.85, 0.87, 0.9);
  doc.setTitle(`${report.report_ref} ${typeLabelOf(report.type)}`);
  doc.setProducer('Vitauri');
  doc.setCreator('Vitauri FIU reporting');

  // Standard fonts only encode WinAnsi: replace anything else (cached per character).
  const okChar = new Map();
  const clean = (text, f = font) => [...s(text).replace(/\r/g, '').replace(/\t/g, ' ')].map((ch) => {
    if (ch === '\n') return ch;
    const key = `${f === mono ? 'm' : 'f'}${ch}`;
    if (!okChar.has(key)) { try { f.widthOfTextAtSize(ch, 10); okChar.set(key, true); } catch { okChar.set(key, false); } }
    return okChar.get(key) ? ch : ({ '−': '-', '→': '->', '≥': '>=', '≤': '<=', '✓': 'v', '✗': 'x' }[ch] || '?');
  }).join('');

  let page;
  let y;
  const pages = [];
  const newPage = () => {
    page = doc.addPage(A4); pages.push(page); y = A4[1] - M;
  };
  const need = (h) => { if (y - h < M + 30) newPage(); };
  const wrap = (text, f, size, width) => {
    const out = [];
    for (const para of clean(text, f).split('\n')) {
      let cur = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = cur ? `${cur} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) <= width) cur = next;
        else {
          if (cur) out.push(cur);
          let w = word;
          while (f.widthOfTextAtSize(w, size) > width) { let i = w.length; while (i > 1 && f.widthOfTextAtSize(w.slice(0, i), size) > width) i--; out.push(w.slice(0, i)); w = w.slice(i); }
          cur = w;
        }
      }
      out.push(cur);
    }
    return out;
  };
  const text = (t, { f = font, size = 9.5, color = rgb(0.1, 0.1, 0.12), x = M, width = A4[0] - 2 * M, gap = 3 } = {}) => {
    for (const l of wrap(t, f, size, width)) { need(size + gap); page.drawText(l, { x, y: y - size, size, font: f, color }); y -= size + gap; }
  };
  const heading = (t) => {
    need(34); y -= 10;
    page.drawRectangle({ x: M, y: y - 18, width: A4[0] - 2 * M, height: 18, color: rgb(0.95, 0.96, 0.98) });
    page.drawText(clean(t, bold), { x: M + 6, y: y - 13, size: 10.5, font: bold, color: primary });
    y -= 26;
  };
  const kv = (rows, labelW = 150) => {
    for (const [k, v] of rows) {
      if (v === undefined || v === null || v === '') continue;
      const lines = wrap(s(v), font, 9.5, A4[0] - 2 * M - labelW);
      need(lines.length * 12.5 + 2);
      page.drawText(clean(k, bold), { x: M, y: y - 9.5, size: 9, font: bold, color: muted });
      lines.forEach((l, i) => page.drawText(l, { x: M + labelW, y: y - 9.5 - i * 12.5, size: 9.5, font, color: rgb(0.1, 0.1, 0.12) }));
      y -= lines.length * 12.5 + 2;
    }
  };
  const table = (cols, rows) => {
    const total = A4[0] - 2 * M;
    const widths = cols.map((c) => c.w * total);
    const drawHead = () => {
      need(18);
      page.drawRectangle({ x: M, y: y - 15, width: total, height: 15, color: rgb(0.93, 0.95, 0.97) });
      let x = M;
      cols.forEach((c, i) => { page.drawText(clean(c.label, bold), { x: x + 3, y: y - 11, size: 8, font: bold, color: muted }); x += widths[i]; });
      y -= 17;
    };
    drawHead();
    for (const r of rows) {
      const cells = cols.map((c, i) => wrap(s(r[c.key]), font, 8, widths[i] - 6).slice(0, 4));
      const h = Math.max(...cells.map((c) => c.length)) * 10 + 4;
      if (y - h < M + 30) { newPage(); drawHead(); }
      let x = M;
      cells.forEach((c, i) => {
        c.forEach((l, j) => {
          const w = font.widthOfTextAtSize(l, 8);
          page.drawText(l, { x: cols[i].right ? x + widths[i] - 3 - w : x + 3, y: y - 8 - j * 10, size: 8, font, color: rgb(0.12, 0.12, 0.14) });
        });
        x += widths[i];
      });
      y -= h;
      page.drawLine({ start: { x: M, y: y + 1 }, end: { x: M + total, y: y + 1 }, thickness: 0.4, color: line });
    }
  };

  // Field access.
  const fields = report.fields || [];
  const F = new Map(fields.map((f) => [f.path, s(f.value)]));
  const get = (p) => F.get(p) || '';
  const userName = (id) => { const u = users.find((x) => x.id === id); return u ? (u.full_name || u.email) : id ? 'Unknown user' : '—'; };
  const isOrg = client?.client_type === 'ORG';

  // Cover.
  newPage();
  page.drawRectangle({ x: 0, y: A4[1] - 92, width: A4[0], height: 92, color: primary });
  page.drawText(clean(tenant?.name || 'Vitauri', bold), { x: M, y: A4[1] - 38, size: 11, font: bold, color: rgb(1, 1, 1) });
  page.drawText(clean(typeLabelOf(report.type), bold), { x: M, y: A4[1] - 62, size: 17, font: bold, color: rgb(1, 1, 1) });
  page.drawText(clean(`${report.report_ref} · ${fiu?.name || report.fiu_profile_code} · CONFIDENTIAL`), { x: M, y: A4[1] - 80, size: 9.5, font, color: rgb(0.88, 0.91, 0.96) });
  y = A4[1] - 112;
  if (report.priority === 'without_delay' || report.freeze_advised) {
    page.drawRectangle({ x: M, y: y - 34, width: A4[0] - 2 * M, height: 34, color: rgb(0.99, 0.93, 0.93), borderColor: rgb(0.85, 0.3, 0.3), borderWidth: 0.8 });
    page.drawText(clean('Report without delay.', bold), { x: M + 8, y: y - 14, size: 9.5, font: bold, color: rgb(0.6, 0.1, 0.1) });
    page.drawText(clean(report.freeze_advised ? 'Terrorist-financing indicators: assess an asset freeze. Vitauri does not freeze assets automatically.' : 'Priority report.'), { x: M + 8, y: y - 27, size: 8.5, font, color: rgb(0.6, 0.1, 0.1) });
    y -= 44;
  }
  heading('1. Report');
  kv([
    ['Report reference', report.report_ref], ['Report type', `${typeLabelOf(report.type)} (goAML code ${report.goaml_report_code || get('report.report_code') || '—'})`],
    ['FIU', `${fiu?.name || report.fiu_profile_code} · reporting entity ${get('report.rentity_id') || fiu?.rentity_id || '—'}`],
    ['Status', `${report.status}${draft ? ' (draft copy)' : ''} · version ${report.version || 1}`],
    ['Origin', report.origin], ['Deadline', fmtDate(report.clock?.due_at)],
    ['Proposal', report.proposal?.rule ? `${report.proposal.rule} on ${report.proposal.date}: ${report.proposal.total} ${report.proposal.currency} (threshold ${report.proposal.threshold})` : ''],
    ['Indicators', (report.indicators || []).join(', ') || '—'],
  ]);

  heading('2. Subject');
  if (isOrg) {
    kv([['Name', get('t_entity.name')], ['Registration number', get('t_entity.incorporation_number')], ['Country', get('t_entity.incorporation_country_code')],
      ['Address', get('t_entity.address')], ['Legal form', get('t_entity.incorporation_legal_form')], ['Business', get('t_entity.business')]]);
    const idx = [...new Set(fields.map((f) => f.path.match(/^director_id\[(\d+)\]\./)?.[1]).filter((x) => x != null))];
    if (idx.length) {
      y -= 4;
      table([{ key: 'name', label: 'Related party', w: 0.32 }, { key: 'role', label: 'Role', w: 0.3 }, { key: 'own', label: 'Ownership', w: 0.12, right: true }, { key: 'dob', label: 'Date of birth', w: 0.13 }, { key: 'nat', label: 'Nationality', w: 0.13 }],
        idx.map((i) => ({ name: get(`director_id[${i}].full_name`), role: get(`director_id[${i}].role`), own: get(`director_id[${i}].ownership_percentage`) ? `${get(`director_id[${i}].ownership_percentage`)}%` : '', dob: get(`director_id[${i}].birthdate`), nat: get(`director_id[${i}].nationality`) })));
    }
  } else {
    kv([['Name', `${get('t_person.first_name')} ${get('t_person.last_name')}`.trim() || client?.full_name], ['Date of birth', get('t_person.birthdate')], ['Place of birth', get('t_person.birth_place')],
      ['Nationality', get('t_person.nationality1')], ['Address', get('t_person.addresses.address.address')],
      ['ID document', [get('t_person.identification.type'), get('t_person.identification.number'), get('t_person.identification.expiry_date') && `exp. ${get('t_person.identification.expiry_date')}`].filter(Boolean).join(' · ')],
      ['Occupation', [get('t_person.occupation'), get('t_person.employer_name')].filter(Boolean).join(' at ')]]);
  }

  const tx = [...new Set(fields.map((f) => f.path.match(/^transaction\[(\d+)\]\./)?.[1]).filter((x) => x != null))].map(Number).sort((a, b) => a - b);
  heading(`3. Transactions (${tx.length})`);
  if (!tx.length) text('No transactions are part of this report.', { color: muted });
  else {
    kv([['Total inbound', get('transactions.total_in')], ['Total outbound', get('transactions.total_out')], ['Note', get('transactions.truncated')]]);
    y -= 4;
    table([
      { key: 'd', label: 'Date', w: 0.12 }, { key: 'dir', label: 'Dir.', w: 0.08 }, { key: 'amt', label: 'Amount', w: 0.15, right: true }, { key: 'cur', label: 'Cur.', w: 0.07 },
      { key: 'cp', label: 'Counterparty', w: 0.28 }, { key: 'cc', label: 'Country', w: 0.09 }, { key: 'mode', label: 'Mode', w: 0.21 },
    ], tx.slice(0, 300).map((i) => {
      const g = (k) => get(`transaction[${i}].${k}`);
      const inbound = g('direction') === 'inbound';
      return { d: g('date_transaction'), dir: inbound ? 'In' : 'Out', amt: g('amount_local'), cur: g('currency_code'), cp: inbound ? g('from_party') : g('to_party'), cc: g('counterparty_country'), mode: g('category') ? g('category').replace(/_/g, ' ') : g('transmode_code').replace(/_/g, ' ') };
    }));
  }

  heading('4. Reason for reporting');
  text(report.narrative?.text || get('report.reason') || '—');

  heading('5. goAML validation');
  if (validation) {
    text(validation.ok ? 'The goAML XML passed the structural checks.' : `The goAML XML has ${validation.errors.length} error(s):`, { f: bold, color: validation.ok ? rgb(0.1, 0.45, 0.2) : rgb(0.7, 0.1, 0.1) });
    for (const e of [...(validation.errors || []), ...(validation.issues || []).map((m) => ({ message: m }))].slice(0, 40)) text(`• ${e.message}`, { size: 8.5 });
    for (const w of (validation.warnings || []).slice(0, 20)) text(`• Warning: ${w.message}`, { size: 8.5, color: muted });
  } else text('Not validated.', { color: muted });
  kv([['goAML XML SHA-256', xmlHash || (draft ? 'Draft: the XML is fixed and hashed at approval' : '—')]], 120);

  heading('6. Four-eyes review');
  kv([
    ['Prepared by', `${userName(report.prepared_by_user_id)}${report.created_date ? ` · ${fmtDate(report.created_date)}` : ''}`],
    ['Sent for approval by', report.submitted_for_approval_by ? `${userName(report.submitted_for_approval_by)} · ${fmtDate(report.submitted_for_approval_at)}` : '—'],
    ['Approved by', report.approved_by_user_id ? `${userName(report.approved_by_user_id)} · ${fmtDate(report.approved_at)}` : 'Not approved yet'],
    ['Approval checks', (report.approval?.checks || []).map((c) => `${c.key}: ${c.ok ? 'passed' : 'failed'}`).join(', ')],
    ['Lateness reason', report.lateness_reason],
  ]);
  need(70); y -= 26;
  const sigW = (A4[0] - 2 * M - 30) / 2;
  for (const [i, label] of ['Prepared by (signature)', 'Approved by (signature)'].entries()) {
    const x = M + i * (sigW + 30);
    page.drawLine({ start: { x, y }, end: { x: x + sigW, y }, thickness: 0.7, color: rgb(0.3, 0.3, 0.35) });
    page.drawText(clean(label), { x, y: y - 12, size: 8, font, color: muted });
  }
  y -= 30;

  heading('7. Audit trail');
  const trail = [...audits].sort((a, b) => s(a.created_date).localeCompare(s(b.created_date))).slice(-80);
  if (!trail.length) text('No audit events.', { color: muted });
  else table([{ key: 'at', label: 'When', w: 0.2 }, { key: 'who', label: 'Who', w: 0.2 }, { key: 'what', label: 'Event', w: 0.22 }, { key: 'notes', label: 'Notes', w: 0.38 }],
    trail.map((a) => ({ at: fmtDate(a.created_date), who: a.actor_name || a.actor_type || '', what: s(a.event_type).replace(/_/g, ' '), notes: s(a.notes).slice(0, 220) })));

  // Footer, page numbers and draft watermark on every page.
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M - 8 }, end: { x: A4[0] - M, y: M - 8 }, thickness: 0.5, color: line });
    p.drawText(clean(`${report.report_ref} · Confidential FIU report — do not disclose to the customer (tipping-off)`), { x: M, y: M - 20, size: 7.5, font, color: muted });
    const pn = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pn, { x: A4[0] - M - font.widthOfTextAtSize(pn, 7.5), y: M - 20, size: 7.5, font, color: muted });
    if (draft) p.drawText('DRAFT', { x: 150, y: 330, size: 110, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.12, rotate: degrees(35) });
  });
  return doc.save();
}
