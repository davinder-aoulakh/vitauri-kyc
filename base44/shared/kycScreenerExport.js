// Escalation packet for a KYC Screener run: .xlsx (the kyc-screener "escalator" output) and a PDF for the file.
// Built by Vitauri from the stored run (no AI in this step). Both carry the banner "AI recommendation — the compliance officer decides".
import ExcelJS from 'npm:exceljs@4.4.0';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

const s = (v) => (v === undefined || v === null ? '' : String(v));
const LIST_LABEL = { sanctions: 'Sanctions', pep: 'PEP', adverse_media: 'Adverse media' };
export const AGREE_LABEL = {
  agree_clear: 'Agree: clear', agree_hit: 'Agree: hit', claude_only: 'Claude only', didit_only: 'Didit only',
  review: 'Review', claude_only_clear: 'Claude clear · Didit not screened',
};
const BANNER = 'AI recommendation from the KYC Screener (Claude). It does not change the client file — the compliance officer decides.';

export async function buildScreenerXlsx({ run, client, tenant }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Vitauri KYC Screener';
  wb.created = new Date(run.ran_at || Date.now());
  const head = (ws, cols) => {
    ws.columns = cols.map(([header, key, width]) => ({ header, key, width }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2545' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };
  const r = run.rules || {};
  const sum = wb.addWorksheet('Summary');
  head(sum, [['Item', 'k', 32], ['Value', 'v', 90]]);
  [
    ['Client', client.full_name], ['Client type', client.client_type], ['Tenant', tenant?.name],
    ['Run at', run.ran_at], ['Model', run.model], ['Recommended risk rating', r.risk_rating],
    ['Vitauri risk classification', client.risk_classification || '—'], ['Recommended disposition', r.disposition],
    ['Summary', r.summary], ['Escalation reasons', (r.escalation_reasons || []).join('\n')],
    ['Missing documents', (r.missing_documents || []).join('\n')], ['Notice', BANNER],
    ['Method', 'anthropics/financial-services kyc-screener (Apache-2.0): doc-reader → screening → rules engine'],
  ].forEach(([k, v]) => sum.addRow({ k, v: s(v) }));
  sum.getColumn('v').alignment = { wrapText: true, vertical: 'top' };

  const ent = wb.addWorksheet('Entity file');
  head(ent, [['Field', 'k', 30], ['Value (from documents)', 'v', 90]]);
  const d = run.doc_record || {};
  [['Applicant type', d.applicant_type], ['Legal name', d.legal_name], ['DOB / formation date', d.dob_or_formation_date],
    ['Nationality / jurisdiction', d.nationality_or_jurisdiction], ['Address', d.registered_address], ['Source of funds', d.source_of_funds],
    ['PEP declared', d.pep_declared == null ? '' : d.pep_declared ? 'Yes' : 'No'],
    ...(d.id_documents || []).map((x, i) => [`ID document ${i + 1}`, [x.type, x.number, x.expiry && `exp. ${x.expiry}`, x.issuer].filter(Boolean).join(' · ')]),
    ...(d.beneficial_owners || []).map((x, i) => [`UBO ${i + 1}`, [x.name, x.ownership_pct != null && `${x.ownership_pct}%`, x.nationality, x.dob].filter(Boolean).join(' · ')]),
    ...(d.controllers || []).map((x, i) => [`Controller ${i + 1}`, [x.name, x.role].filter(Boolean).join(' · ')]),
    ...(d.documents_received || []).map((x, i) => [`Document ${i + 1}`, [x.type, x.ref, x.date].filter(Boolean).join(' · ')]),
    ...(d.inventory_gaps || []).map((g, i) => [`Inventory gap ${i + 1}`, g]),
  ].forEach(([k, v]) => ent.addRow({ k, v: s(v) }));

  const ru = wb.addWorksheet('Rule outcomes');
  head(ru, [['Rule', 'rule_id', 10], ['Rule text', 'rule_text', 60], ['Outcome', 'outcome', 10], ['Evidence', 'evidence', 70]]);
  (r.rule_outcomes || []).forEach((o) => {
    const row = ru.addRow(o);
    if (o.outcome === 'fail') row.getCell('outcome').font = { bold: true, color: { argb: 'FFB91C1C' } };
  });
  ru.addRow({}); ru.addRow({ rule_id: 'Factor', rule_text: 'Value', outcome: 'Rating' }).font = { bold: true };
  (r.factors || []).forEach((f) => ru.addRow({ rule_id: f.factor, rule_text: f.value, outcome: f.rating }));

  const sc = wb.addWorksheet('Screening (Claude)');
  head(sc, [['Party', 'party', 30], ['List', 'list', 14], ['Result', 'result', 14], ['Match', 'match', 40], ['Confidence', 'conf', 11], ['Rationale', 'why', 60], ['Sources', 'src', 60]]);
  for (const p of run.screening?.parties || []) for (const list of ['sanctions', 'pep', 'adverse_media']) {
    const c = p.checks[list];
    if (!c.matches.length) sc.addRow({ party: p.name, list: LIST_LABEL[list], result: c.result });
    for (const m of c.matches) sc.addRow({ party: p.name, list: LIST_LABEL[list], result: c.result, match: `${m.name_matched} — ${m.list_or_source}`, conf: m.confidence, why: m.rationale, src: m.sources.join('\n') });
  }

  const cmp = wb.addWorksheet('Didit vs Claude');
  head(cmp, [['Party', 'party', 30], ['Role', 'role', 22], ['List', 'list', 14], ['Didit', 'didit', 14], ['Didit detail', 'dd', 45], ['Claude', 'claude', 14], ['Claude detail', 'cd', 45], ['Agreement', 'agree', 26]]);
  for (const row of run.comparison?.rows || []) {
    const x = cmp.addRow({ party: row.party, role: row.role, list: LIST_LABEL[row.list], didit: row.didit, dd: row.didit_detail, claude: row.claude, cd: row.claude_detail, agree: AGREE_LABEL[row.agreement] });
    if (['claude_only', 'didit_only', 'review'].includes(row.agreement)) x.getCell('agree').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
  }

  const gaps = wb.addWorksheet('Gaps');
  head(gaps, [['Document', 'doc', 50], ['Status', 'st', 14]]);
  (r.required_documents || []).forEach((x) => gaps.addRow({ doc: x.document, st: x.status }));

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export async function buildScreenerPdf({ run, client, tenant }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const A4 = [595.28, 841.89]; const M = 48;
  const okc = new Map();
  const clean = (t) => [...s(t).replace(/\r/g, '')].map((ch) => {
    if (ch === '\n') return ch;
    if (!okc.has(ch)) { try { font.widthOfTextAtSize(ch, 10); okc.set(ch, true); } catch { okc.set(ch, false); } }
    return okc.get(ch) ? ch : ({ '→': '->', '−': '-', '≥': '>=', '≤': '<=', '✓': '+' }[ch] || '?');
  }).join('');
  const pages = []; let page; let y;
  const newPage = () => { page = doc.addPage(A4); pages.push(page); y = A4[1] - M; };
  const wrap = (t, f, size, w) => clean(t).split('\n').flatMap((para) => {
    const out = []; let cur = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const n = cur ? `${cur} ${word}` : word;
      if (f.widthOfTextAtSize(n, size) <= w) cur = n; else { if (cur) out.push(cur); cur = word.slice(0, 90); }
    }
    out.push(cur); return out;
  });
  const text = (t, { f = font, size = 9.5, color = rgb(0.1, 0.1, 0.12), indent = 0 } = {}) => {
    for (const l of wrap(t, f, size, A4[0] - 2 * M - indent)) { if (y < M + 30) newPage(); page.drawText(l, { x: M + indent, y: y - size, size, font: f, color }); y -= size + 3; }
  };
  const heading = (t) => { if (y < M + 60) newPage(); y -= 8; page.drawRectangle({ x: M, y: y - 18, width: A4[0] - 2 * M, height: 18, color: rgb(0.95, 0.96, 0.98) }); page.drawText(clean(t), { x: M + 6, y: y - 13, size: 10.5, font: bold, color: rgb(0.04, 0.15, 0.27) }); y -= 26; };

  const r = run.rules || {};
  newPage();
  page.drawRectangle({ x: 0, y: A4[1] - 84, width: A4[0], height: 84, color: rgb(0.04, 0.15, 0.27) });
  page.drawText(clean(tenant?.name || 'Vitauri'), { x: M, y: A4[1] - 34, size: 10, font: bold, color: rgb(1, 1, 1) });
  page.drawText('KYC Screener — escalation packet', { x: M, y: A4[1] - 56, size: 16, font: bold, color: rgb(1, 1, 1) });
  page.drawText(clean(`${client.full_name} · ${client.client_type} · ${s(run.ran_at).slice(0, 16).replace('T', ' ')} UTC`), { x: M, y: A4[1] - 73, size: 9, font, color: rgb(0.85, 0.9, 0.96) });
  y = A4[1] - 100;
  text(BANNER, { f: bold, size: 9, color: rgb(0.55, 0.3, 0.02) });
  heading('1. Recommendation');
  text(`Recommended risk rating: ${s(r.risk_rating).toUpperCase()} (Vitauri: ${client.risk_classification || '—'})  ·  Disposition: ${r.disposition}`, { f: bold });
  text(r.summary || '');
  for (const e of r.escalation_reasons || []) text(`• ${e}`, { indent: 8 });
  heading('2. Didit vs Claude screening');
  const totals = run.comparison?.totals || {};
  text(Object.entries(totals).filter(([, n]) => n).map(([k, n]) => `${AGREE_LABEL[k]}: ${n}`).join('  ·  ') || 'No parties screened.');
  for (const row of run.comparison?.rows || []) {
    if (row.agreement === 'agree_clear') continue;
    text(`${row.party} (${row.role}) — ${LIST_LABEL[row.list]}: Didit ${row.didit}, Claude ${row.claude} → ${AGREE_LABEL[row.agreement]}`, { f: bold, size: 9 });
    if (row.claude_detail) text(`Claude: ${row.claude_detail}`, { size: 8.5, indent: 10 });
    if (row.didit_detail) text(`Didit: ${row.didit_detail}`, { size: 8.5, indent: 10 });
    for (const u of row.sources || []) text(u, { size: 7.5, indent: 10, color: rgb(0.2, 0.3, 0.6) });
  }
  heading('3. Rule outcomes');
  for (const o of r.rule_outcomes || []) text(`${o.rule_id} — ${o.outcome.toUpperCase()}: ${o.evidence}`, { size: 9, color: o.outcome === 'fail' ? rgb(0.7, 0.1, 0.1) : rgb(0.1, 0.1, 0.12) });
  heading('4. Documents and gaps');
  for (const x of r.required_documents || []) text(`${x.status === 'received' ? '✓' : '•'} ${x.document}: ${x.status}`, { size: 9 });
  for (const g of run.doc_record?.inventory_gaps || []) text(`• ${g}`, { size: 9 });
  heading('5. Method');
  text('Method: anthropics/financial-services kyc-screener (Apache-2.0), run in Vitauri with Claude. Stage 1 reads the client documents in isolation; stage 2 screens every named party with web search; stage 3 applies the firm rules grid. Didit results were not shown to Claude.', { size: 8.5, color: rgb(0.4, 0.43, 0.48) });
  pages.forEach((p, i) => {
    const pn = `Page ${i + 1} of ${pages.length}`;
    p.drawText(clean(`KYC Screener · ${client.full_name} · Confidential`), { x: M, y: M - 20, size: 7.5, font, color: rgb(0.4, 0.43, 0.48) });
    p.drawText(pn, { x: A4[0] - M - font.widthOfTextAtSize(pn, 7.5), y: M - 20, size: 7.5, font, color: rgb(0.4, 0.43, 0.48) });
  });
  return doc.save();
}
