// KYC Investigation Report PDF: tenant-branded body (jsPDF), Annex 9 with the Didit report and every case document
// inlined (pdf-lib), Audit Trail 10 last, and page footers stamped after the merge so every page is numbered.
// Pure module (no React, no SDK): the caller fetches data and file bytes. Runs in the browser and in node.
import { jsPDF } from 'jspdf';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { format } from 'date-fns';

// ── Layout ─────────────────────────────────────────────────────────────────
const PAGE_W = 210, PAGE_H = 297, MARGIN = 16, INNER_W = PAGE_W - MARGIN * 2;
const TOP = 20, BOTTOM = PAGE_H - 20, LH = 4.3;
const A4_PT = [595.28, 841.89];

const WHITE = [255, 255, 255];
const BODY = [40, 45, 55];
const MUTED = [110, 118, 135];
const BORDER = [222, 226, 233];
const ZEBRA = [248, 249, 252];
const RISK = {
  Low: { bg: [209, 250, 229], text: [6, 95, 70] },
  Medium: { bg: [254, 243, 199], text: [120, 53, 15] },
  High: { bg: [254, 226, 226], text: [153, 27, 27] },
  Unacceptable: { bg: [127, 0, 0], text: [255, 255, 255] },
};
const riskColor = (r) => RISK[r] || { bg: [236, 238, 242], text: [50, 55, 65] };

// ── Colour + text helpers ──────────────────────────────────────────────────
export function hexToRgb(hex) {
  const clean = String(hex || '').trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (c, w, t) => c.map((v, i) => Math.round(v + (w[i] - v) * t));
const luminance = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const stripHtml = (s) => String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&copy;/g, '©').replace(/\s+/g, ' ').trim();

// Standard PDF fonts only cover Windows-1252: map common symbols, drop the rest.
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const SYMBOLS = { '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '✓': '', '✔': '', '⚠': '!', '✕': 'x', ' ': ' ', ' ': ' ', ' ': ' ' };
export function safeText(s) {
  return String(s ?? '').replace(/[^\n\t\x20-\x7e\xa0-\xff]/g, (ch) => (SYMBOLS[ch] ?? (CP1252_EXTRA.includes(ch) ? ch : '')));
}
const pretty = (v) => (v == null || v === '' ? '—' : String(v).replace(/_/g, ' '));
const fmtDate = (d, f = 'd MMM yyyy') => { if (!d) return '—'; const x = new Date(d); return Number.isNaN(x.getTime()) ? String(d) : format(x, f); };

/** Report branding, aligned with the client portal (ClientPortal getBranding): colours, header style, white label, footer. */
export function reportBranding(tenant) {
  const primary = hexToRgb(tenant?.branding_primary_color) || [15, 31, 61];
  let secondary = hexToRgb(tenant?.branding_secondary_color) || [26, 107, 255];
  if (luminance(secondary) > 0.85) secondary = primary; // a near-white accent is invisible on paper
  const whiteLabel = !!tenant?.white_label_enabled;
  return {
    primary, secondary, text: hexToRgb(tenant?.branding_text_color) || BODY,
    headerStyle: tenant?.branding_header_style === 'light' ? 'light' : 'dark',
    whiteLabel, name: tenant?.name || '', label: whiteLabel ? (tenant?.name || 'Compliance') : 'Vitauri KYC',
    footerText: stripHtml(tenant?.portal_footer_text),
    tint: mix(primary, WHITE, 0.9), tintAccent: mix(secondary, WHITE, 0.88),
  };
}

// ── File helpers ───────────────────────────────────────────────────────────
/** pdf | png | jpg | other, from the file's first bytes (names are unreliable: portal uploads are called "Additional Documents"). */
export function sniffType(bytes, ...names) {
  if (bytes && bytes.length > 4) {
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  }
  for (const n of names) {
    const ext = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(String(n || ''))?.[1]?.toLowerCase();
    if (ext === 'pdf') return 'pdf';
    if (ext === 'png') return 'png';
    if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
    if (ext) return 'other';
  }
  return 'other';
}

/** A readable document name: the stored name, or the uploaded file's own name when the stored one is generic. */
export function displayName(doc) {
  const name = String(doc?.file_name || '').trim();
  if (name && /\.[a-z0-9]{2,5}$/i.test(name)) return name;
  const base = decodeURIComponent(String(doc?.file_url || '').split('?')[0].split('/').pop() || '');
  const fromUrl = base.replace(/^[0-9a-f]{6,12}_/i, '');
  if (fromUrl && /\.[a-z0-9]{2,5}$/i.test(fromUrl)) return name && !/^additional documents?$/i.test(name) ? `${name} (${fromUrl})` : fromUrl;
  return name || 'Document';
}

const TYPE_LABEL = { pdf: 'PDF', png: 'Image', jpg: 'Image', other: 'File' };

/**
 * Fetches every annex item once, Didit report(s) first. fetchDidit(sessionId) and fetchBytes(url) return Uint8Array or null.
 * Returns [{ ref, name, type, source, date, kind, bytes, status }] — status: Attached | Listed only | Not available.
 */
export async function prepareAnnex({ diditSessions = [], documents = [], fetchDidit, fetchBytes }) {
  const items = [];
  for (const s of diditSessions) {
    const bytes = await fetchDidit(s.session_id).catch(() => null);
    const ok = bytes && sniffType(bytes) === 'pdf';
    items.push({ name: 'Didit identity verification report', type: 'IDV report', source: 'Didit', date: s.date || null, kind: ok ? 'pdf' : null, bytes: ok ? bytes : null, status: ok ? 'Attached' : 'Not available' });
  }
  const seen = new Set();
  const docs = documents.filter((d) => { const k = d.file_url || d.id; if (!d.file_url || seen.has(k)) return false; seen.add(k); return true; });
  const fetched = [];
  for (let i = 0; i < docs.length; i += 4) {
    fetched.push(...await Promise.all(docs.slice(i, i + 4).map((d) => fetchBytes(d.file_url).catch(() => null))));
  }
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const bytes = fetched[i];
    const kind = bytes ? sniffType(bytes, d.file_url, d.file_name) : null;
    let usable = kind === 'pdf' || kind === 'png' || kind === 'jpg';
    // A damaged or password-protected PDF cannot be merged: list it instead of claiming it is attached.
    if (kind === 'pdf') { try { await PDFDocument.load(bytes, { ignoreEncryption: true }); } catch { usable = false; } }
    items.push({
      name: displayName(d), type: pretty(d.doc_type), source: d.source || 'portal', date: d.created_date || null,
      kind: usable ? kind : null, bytes: usable ? bytes : null, status: !bytes ? 'Not available' : usable ? 'Attached' : 'Listed only',
      fileType: kind ? TYPE_LABEL[kind] : '',
    });
  }
  return items.map((it, i) => ({ ...it, ref: `9.${i + 1}` }));
}

// ── Body (jsPDF) ───────────────────────────────────────────────────────────
function parseSof(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { const o = JSON.parse(raw); if (o && typeof o === 'object') return o; } catch { /* plain text */ }
  return { narrative: String(raw) };
}

/**
 * Builds the report body with jsPDF. Footers are NOT drawn here (stamped after the merge).
 * Returns { doc, marks } — marks: TOC slots and section start pages used by assembleReport.
 */
export function buildReportBody(input) {
  const {
    kycCase, client, preparedBy, analystName, screeningHits = [], assessments = [], controlMeasures = [],
    auditEvents = [], relatedPartyLinks = [], relatedParties = [], tenant, nextVersion, annexItems = [],
    txnAnalysis = null, tmMonitoring = null, logo = null, now = new Date(),
  } = input;
  const b = reportBranding(tenant);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const dateStr = format(now, 'd MMMM yyyy');
  const risk = kycCase?.risk_classification;
  let y = TOP;

  const font = (style = 'normal', size = 8.5, color = b.text) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); };
  const text = (s, x, yy, opts) => doc.text(safeText(s), x, yy, opts);
  const wrap = (s, w) => doc.splitTextToSize(safeText(s), w);
  const ensure = (h) => { if (y + h > BOTTOM) { doc.addPage(); y = TOP; return true; } return false; };
  const gap = (h = 3) => { y += h; };
  const pageNo = () => doc.getNumberOfPages();
  const sectionPages = {};

  function section(num, title) {
    ensure(22);
    if (y > TOP) gap(3);
    sectionPages[num] = pageNo();
    doc.setFillColor(...b.tint);
    doc.roundedRect(MARGIN, y, INNER_W, 9, 1.5, 1.5, 'F');
    doc.setFillColor(...b.secondary);
    doc.rect(MARGIN, y, 1.4, 9, 'F');
    font('bold', 10.5, b.primary);
    text(`${num}.  ${title}`, MARGIN + 4.5, y + 6.1);
    y += 13;
  }
  function subheading(s, size = 9) {
    ensure(10);
    font('bold', size, b.primary);
    text(s, MARGIN, y + 3.2);
    y += size >= 10 ? 7 : 6;
  }
  function divider() {
    ensure(4);
    doc.setDrawColor(...BORDER); doc.setLineWidth(0.2);
    doc.line(MARGIN, y + 1, PAGE_W - MARGIN, y + 1);
    y += 4;
  }
  function pill(label, colors, x = MARGIN, w = null) {
    font('bold', 7.5, colors.text);
    const tw = w || doc.getTextWidth(safeText(label)) + 6;
    doc.setFillColor(...colors.bg);
    doc.roundedRect(x, y, tw, 6, 1.5, 1.5, 'F');
    text(label, x + 3, y + 4.2);
    return tw;
  }
  function kv(label, value, x = MARGIN, labelW = 46, width = INNER_W) {
    font('normal', 8.5);
    const lines = wrap(pretty(value), width - labelW);
    const h = Math.max(1, lines.length) * LH;
    ensure(h + 1);
    font('bold', 7, MUTED);
    text(String(label).toUpperCase(), x, y + 3);
    font('normal', 8.5, b.text);
    text(lines, x + labelW, y + 3, { lineHeightFactor: LH / 3 });
    y += h + 1.2;
  }
  /** Two columns of label/value pairs; each row is as tall as its tallest value. */
  function kvGrid(pairs) {
    const colW = INNER_W / 2 - 3, labelW = 34;
    for (let i = 0; i < pairs.length; i += 2) {
      font('normal', 8.5);
      const cells = [pairs[i], pairs[i + 1]].filter(Boolean).map(([l, v]) => ({ l, lines: wrap(pretty(v), colW - labelW) }));
      const h = Math.max(...cells.map((c) => c.lines.length)) * LH;
      ensure(h + 1.5);
      cells.forEach((c, j) => {
        const x = MARGIN + j * (colW + 6);
        font('bold', 7, MUTED); text(String(c.l).toUpperCase(), x, y + 3);
        font('normal', 8.5, b.text); text(c.lines, x + labelW, y + 3, { lineHeightFactor: LH / 3 });
      });
      y += h + 1.6;
    }
  }
  /** Table with auto-sized rows; the header repeats after a page break. cols: [{ label, w }] (widths in mm, sum <= INNER_W). */
  function table(cols, rows) {
    const totalW = cols.reduce((s, c) => s + c.w, 0);
    const head = () => {
      doc.setFillColor(...b.tintAccent);
      doc.rect(MARGIN, y, totalW, 7, 'F');
      font('bold', 7.5, b.primary);
      let x = MARGIN + 2;
      cols.forEach((c) => { text(c.label, x, y + 4.7); x += c.w; });
      y += 7;
    };
    ensure(16);
    head();
    rows.forEach((row, ri) => {
      font('normal', 7.8);
      const cells = cols.map((c, i) => wrap(pretty(row[i]), c.w - 3));
      const h = Math.max(...cells.map((l) => l.length)) * 3.7 + 2.6;
      if (ensure(h)) head();
      if (ri % 2 === 1) { doc.setFillColor(...ZEBRA); doc.rect(MARGIN, y, totalW, h, 'F'); }
      font('normal', 7.8, b.text);
      let x = MARGIN + 2;
      cells.forEach((lines, i) => { text(lines, x, y + 3.9, { lineHeightFactor: 3.7 / 2.75 }); x += cols[i].w; });
      doc.setDrawColor(...BORDER); doc.setLineWidth(0.1);
      doc.line(MARGIN, y + h, MARGIN + totalW, y + h);
      y += h;
    });
    y += 3;
  }

  /** Inline **bold** runs wrapped to width, drawn line by line from x. */
  function richLine(str, x, width, size = 8.5) {
    const tokens = [];
    String(str).split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
      if (!part) return;
      const bold = /^\*\*[^*]+\*\*$/.test(part);
      const clean = safeText((bold ? part.slice(2, -2) : part).replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2').replace(/`/g, ''));
      clean.split(/(\s+)/).forEach((w) => { if (w) tokens.push({ w, bold }); });
    });
    const lines = [[]];
    let lineW = 0;
    for (const t of tokens) {
      doc.setFont('helvetica', t.bold ? 'bold' : 'normal'); doc.setFontSize(size);
      const tw = doc.getTextWidth(t.w);
      const isSpace = /^\s+$/.test(t.w);
      if (!isSpace && lineW + tw > width && lines[lines.length - 1].length) { lines.push([]); lineW = 0; }
      if (isSpace && lineW === 0) continue;
      lines[lines.length - 1].push({ ...t, tw });
      lineW += tw;
    }
    for (const line of lines) {
      ensure(LH);
      let cx = x;
      for (const t of line) {
        doc.setFont('helvetica', t.bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...b.text);
        doc.text(t.w, cx, y + 3.1);
        cx += t.tw;
      }
      y += LH;
    }
  }

  /** Minimal markdown: headings, bullets, numbered lists, **bold**, rules, paragraphs. Never prints raw markup. */
  function markdown(src) {
    const textIn = String(src || '').replace(/\\n/g, '\n').replace(/\r/g, '').trim();
    if (!textIn) return;
    const lines = textIn.split('\n');
    let para = [];
    const flush = () => { if (para.length) { richLine(para.join(' '), MARGIN, INNER_W); y += 1.6; para = []; } };
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line.trim()) { flush(); continue; }
      let m;
      if ((m = /^\s*(#{1,6})\s+(.*)$/.exec(line))) { flush(); ensure(10); gap(1.5); subheading(m[2].replace(/\*\*/g, ''), m[1].length <= 2 ? 9.5 : 8.8); continue; }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); divider(); continue; }
      if ((m = /^(\s*)[-*•]\s+(.*)$/.exec(line))) {
        flush(); ensure(LH);
        const indent = Math.min(2, Math.floor(m[1].length / 2)) * 4;
        font('bold', 8.5, b.secondary); text('•', MARGIN + 1.5 + indent, y + 3.1);
        richLine(m[2], MARGIN + 5.5 + indent, INNER_W - 5.5 - indent); y += 0.6; continue;
      }
      if ((m = /^\s*(\d+)[.)]\s+(.*)$/.exec(line))) {
        flush(); ensure(LH);
        font('bold', 8.5, b.primary); text(`${m[1]}.`, MARGIN + 1, y + 3.1);
        richLine(m[2], MARGIN + 7, INNER_W - 7); y += 0.6; continue;
      }
      para.push(line.trim());
    }
    flush();
  }

  // ══ COVER ════════════════════════════════════════════════════════════════
  const light = b.headerStyle === 'light';
  const bandH = 50;
  if (light) {
    doc.setFillColor(...WHITE); doc.rect(0, 0, PAGE_W, bandH, 'F');
    doc.setDrawColor(...BORDER); doc.setLineWidth(0.3); doc.line(0, bandH, PAGE_W, bandH);
  } else {
    doc.setFillColor(...b.primary); doc.rect(0, 0, PAGE_W, bandH, 'F');
  }
  doc.setFillColor(...b.secondary); doc.rect(0, bandH, PAGE_W, 2.2, 'F');
  font('bold', 21, light ? b.primary : WHITE);
  text('KYC INVESTIGATION REPORT', MARGIN, 24);
  font('normal', 8.5, light ? MUTED : mix(WHITE, b.primary, 0.25));
  text('CONFIDENTIAL — FOR COMPLIANCE USE ONLY', MARGIN, 32);

  // Logo: aspect ratio kept inside a 50 x 22 mm box; on a dark header it sits on a white chip so dark logos stay visible.
  let logoDone = false;
  if (logo?.dataUrl) {
    try {
      const props = doc.getImageProperties(logo.dataUrl);
      const boxW = 50, boxH = 22;
      const s = Math.min(boxW / props.width, boxH / props.height);
      const w = props.width * s, h = props.height * s;
      const x = PAGE_W - MARGIN - w, yy = (bandH - h) / 2;
      if (!light) { doc.setFillColor(...WHITE); doc.roundedRect(x - 3, yy - 3, w + 6, h + 6, 2, 2, 'F'); }
      doc.addImage(logo.dataUrl, logo.format || props.fileType || 'PNG', x, yy, w, h, 'tenant-logo', 'FAST');
      logoDone = true;
    } catch { logoDone = false; }
  }
  if (!logoDone && b.name) {
    font('bold', 10, light ? b.primary : WHITE);
    text(b.name.toUpperCase(), PAGE_W - MARGIN, 24, { align: 'right' });
  }

  // Meta box
  const boxY = 62;
  doc.setFillColor(...ZEBRA); doc.setDrawColor(...BORDER); doc.setLineWidth(0.3);
  doc.roundedRect(MARGIN, boxY, INNER_W, 50, 2.5, 2.5, 'FD');
  font('bold', 15, b.text);
  text(client?.full_name || '—', MARGIN + 6, boxY + 11);
  y = boxY + 15;
  pill(`${(risk || 'Unclassified').toUpperCase()} RISK`, riskColor(risk), MARGIN + 6);
  const meta = [
    ['Case type', pretty(kycCase?.case_type)], ['Report date', dateStr],
    ['Case status', pretty(kycCase?.status)], ['Prepared by', preparedBy || '—'],
    ['Report version', `v${nextVersion}`], ['Analyst', analystName || preparedBy || '—'],
  ];
  meta.forEach(([l, v], i) => {
    const x = MARGIN + 6 + (i % 2) * (INNER_W / 2);
    const yy = boxY + 30 + Math.floor(i / 2) * 6.5;
    font('bold', 7, MUTED); text(l.toUpperCase(), x, yy);
    font('normal', 8.5, b.text); text(String(v), x + 30, yy);
  });

  // Table of contents (page numbers are filled in after the merge)
  font('bold', 9.5, b.primary);
  text('TABLE OF CONTENTS', MARGIN, 126);
  const toc = [
    ['1', 'Client Profile'], ['2', 'Related Parties'], ['3', 'Screening & Adverse Media'], ['4', 'Source of Funds / Source of Wealth'],
    ...(txnAnalysis ? [['4A', 'Transaction Analysis (statements)']] : []),
    ...(tmMonitoring ? [['4B', 'Transaction Monitoring & Expected Profile']] : []),
    ['5', 'Risk Indicators & Assessment'], ['6', 'Consolidated Risk Classification'], ['7', 'Control Measures & Mitigants'],
    ['8', 'Sign-Off Record'], ['9', 'Annex'], ['10', 'Audit Trail Appendix'],
  ];
  const tocSlots = [];
  toc.forEach(([num, title], i) => {
    const yy = 134 + i * 7;
    font('normal', 8.8, b.text); text(`${num}.`, MARGIN + 3, yy); text(title, MARGIN + 13, yy);
    doc.setDrawColor(...BORDER); doc.setLineWidth(0.15); doc.line(MARGIN + 3, yy + 2.2, PAGE_W - MARGIN - 3, yy + 2.2);
    tocSlots.push({ num, y: yy });
  });
  if (b.footerText) {
    font('normal', 7, MUTED);
    text(wrap(b.footerText, INNER_W), MARGIN, BOTTOM - 4);
  }

  // ══ CONTENT ══════════════════════════════════════════════════════════════
  doc.addPage(); y = TOP;

  // 1. Client profile
  section('1', 'Client Profile');
  if (client?.client_type === 'NP') {
    kvGrid([
      ['Full name', client.full_name], ['Client type', 'Natural person'], ['Date of birth', client.date_of_birth], ['Nationality', client.nationality],
      ['Residence', client.country_of_residence], ['ID type', client.id_type], ['ID number', client.id_number], ['ID expiry', client.id_expiry_date],
      ['Tax residency', client.tax_residency], ['TIN', client.tin],
    ]);
  } else {
    kvGrid([
      ['Legal name', client?.full_name], ['Client type', 'Organisation'], ['Registration no.', client?.registration_number], ['LEI', client?.lei_code],
      ['Jurisdiction', client?.registered_country], ['Legal form', client?.legal_form], ['Sector', client?.sector], ['FATCA / CRS', client?.entity_classification],
      ['FATCA reporting', client?.fatca_reporting_status], ['Registered address', client?.registered_address],
    ]);
  }
  if (client?.primary_contact_name || client?.primary_contact_email) {
    gap(2); subheading('Primary contact');
    kvGrid([['Name', client?.primary_contact_name], ['Email', client?.primary_contact_email], ['Phone', client?.primary_contact_phone]]);
  }

  // 2. Related parties
  section('2', 'Related Parties');
  if (!relatedPartyLinks.length) markdown('No related parties recorded for this client.');
  else {
    table(
      [{ label: 'Name', w: 50 }, { label: 'Type', w: 14 }, { label: 'Role', w: 34 }, { label: 'Ownership', w: 22 }, { label: 'Verification', w: 32 }, { label: 'Risk', w: 26 }],
      relatedPartyLinks.map((link) => {
        const rp = relatedParties.find((p) => p.id === link.related_party_id) || {};
        return [rp.full_name, rp.party_type, link.role || rp.role_in_relationship, link.ownership_percentage != null ? `${link.ownership_percentage}%` : '—', rp.verification_status, rp.risk_classification];
      }),
    );
  }

  // 3. Screening
  section('3', 'Screening & Adverse Media');
  if (!screeningHits.length) {
    ensure(9); pill('No screening hits recorded for this case', RISK.Low, MARGIN, INNER_W); y += 9;
  } else {
    table(
      [{ label: 'List / source', w: 34 }, { label: 'Hit name', w: 52 }, { label: 'Confidence', w: 22 }, { label: 'AI assessment', w: 38 }, { label: 'Status', w: 32 }],
      screeningHits.map((h) => [h.source, h.hit_name, h.confidence_score != null ? `${h.confidence_score}%` : '—', h.ai_recommendation, h.status]),
    );
    const decided = screeningHits.filter((h) => h.analyst_justification);
    if (decided.length) {
      subheading('Analyst decisions');
      decided.forEach((h) => { markdown(`**${h.hit_name} — ${pretty(h.analyst_decision)}**`); markdown(h.analyst_justification); y += 1; });
    }
  }

  // 4. Source of funds / wealth
  section('4', 'Source of Funds / Source of Wealth');
  const sof = parseSof(kycCase?.sof_narrative);
  const adequacyColors = (a) => (/not|inadequate|insufficient/i.test(a) ? RISK.High : /partial/i.test(a) ? RISK.Medium : /adequate|sufficient/i.test(a) ? RISK.Low : { bg: [236, 238, 242], text: [50, 55, 65] });
  const sofBlock = (title, s) => {
    if (!s || (!s.sources?.length && !s.explanation && !s.adequacy)) return false;
    subheading(title);
    if (s.adequacy) { ensure(8); font('bold', 7, MUTED); text('ADEQUACY', MARGIN, y + 4.2); pill(s.adequacy, adequacyColors(s.adequacy), MARGIN + 46); y += 8; }
    if (s.sources?.length) kv('Declared sources', (s.sources || []).map((x) => (typeof x === 'string' ? x : x?.label || x?.name || x?.type || '')).filter(Boolean).join(', '));
    if (s.explanation) { ensure(10); font('bold', 7, MUTED); text('EXPLANATION', MARGIN, y + 3); y += 5; markdown(s.explanation); }
    gap(2);
    return true;
  };
  let sofAny = false;
  if (sof) {
    sofAny = sofBlock('Source of funds', sof.sof) || sofAny;
    sofAny = sofBlock('Source of wealth', sof.sow) || sofAny;
    if (Array.isArray(sof.evidence) && sof.evidence.length) {
      subheading('Evidence linked');
      table([{ label: 'Claim', w: 82 }, { label: 'Supported by', w: 64 }, { label: 'Verified', w: 32 }],
        sof.evidence.map((e) => [e.claim, e.doc_name, e.verified ? 'Verified' : 'Not verified']));
      sofAny = true;
    }
    if (sof.narrative) { subheading('Assessment'); markdown(sof.narrative); sofAny = true; }
    if (sof.accepted) { ensure(8); pill(`Assessment accepted${sof.acceptedBy ? ` by ${sof.acceptedBy}` : ''}`, RISK.Low); y += 9; }
  }
  if (!sofAny) markdown(kycCase?.case_notes ? String(kycCase.case_notes).slice(0, 600) : 'No source of funds or source of wealth assessment recorded.');

  // 4A. Transaction analysis
  if (txnAnalysis) {
    const a = txnAnalysis, cur = a.currency || '';
    const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
    section('4A', 'Transaction Analysis (statements)');
    kvGrid([
      ['Period', `${a.period_from} to ${a.period_to}`], ['Statements', a.statement_upload_ids?.length ?? 0], ['Transactions', a.txn_count],
      ['Avg in / month', `${cur} ${num(a.avg_inbound_month)}`], ['Avg out / month', `${cur} ${num(a.avg_outbound_month)}`],
    ]);
    kv('Integrity', a.integrity_summary); kv('Occupation fit', a.consistency_with_occupation);
    [['Income by category', a.income_by_category], ['Spending by category', a.spend_by_category]].forEach(([title, data]) => {
      const rows = Object.entries(data || {}).sort((p, q) => q[1] - p[1]).slice(0, 6);
      if (!rows.length) return;
      subheading(title);
      table([{ label: 'Category', w: 90 }, { label: 'Amount', w: 50 }], rows.map(([c, amt]) => [c, `${cur} ${num(amt)}`]));
    });
    if (a.ai_conclusion) { subheading('AI conclusion'); markdown(a.ai_conclusion); }
    if (a.risk_indicators?.length) { subheading('Risk indicators'); markdown(a.risk_indicators.map((r) => `- **${pretty(r.severity || 'n/a')}** ${r.label || r.code}`).join('\n')); }
    subheading('Analyst conclusion'); markdown(a.analyst_conclusion || '—');
    kvGrid([['Signed off by', a.signed_off_by_name], ['Signed off at', fmtDate(a.signed_off_at, 'd MMM yyyy HH:mm')]]);
  }

  // 4B. Transaction monitoring (never contains FIU reporting details)
  if (tmMonitoring) {
    const m = tmMonitoring, cur = m.currency || '';
    const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
    section('4B', 'Transaction Monitoring & Expected Profile');
    kv('Period', `${fmtDate(m.from)} to ${fmtDate(now)} (${m.basis === 'last_kyc_approval' ? 'since last review' : 'last 12 months'})`);
    kvGrid([
      ['Transactions', m.transactions], ['Expected profile', m.profile ? `v${m.profile.version} (approved)` : 'None approved'],
      ['Dynamic risk', `${m.risk?.from ? `${m.risk.from.score} ${m.risk.from.band}` : '—'} -> ${m.risk?.now ? `${m.risk.now.score} ${m.risk.now.band}` : '—'}`],
      ['Alerts', `${m.alerts?.total ?? 0} (${m.alerts?.open ?? 0} open)`], ['Data gaps', `${m.coverage_missing_days ?? 0} day(s)`],
      ['New in period', `${(m.new_countries || []).join(', ') || 'no new countries'} · ${m.new_counterparties ?? 0} counterparties`],
    ]);
    const L = m.profile?.limits || {};
    table([{ label: 'Per month', w: 66 }, { label: 'Actual (average)', w: 56 }, { label: 'Expected profile', w: 56 }], [
      ['Inbound', `${cur} ${num(m.per_month?.inbound)}`, L.inbound == null ? '—' : `${cur} ${num(L.inbound)}`],
      ['Inbound transactions', num(m.per_month?.inbound_count), L.inbound_count == null ? '—' : num(L.inbound_count)],
      ['Outbound', `${cur} ${num(m.per_month?.outbound)}`, L.outbound == null ? '—' : `${cur} ${num(L.outbound)}`],
      ['Outbound abroad', `${cur} ${num(m.per_month?.foreign_out)}`, L.foreign_out == null ? '—' : `${cur} ${num(L.foreign_out)}`],
      ['Cash', `${cur} ${num(m.per_month?.cash)}`, L.cash == null ? '—' : `${cur} ${num(L.cash)}`],
    ]);
    const flags = [...(m.profile?.breaches || []), ...((m.profile?.outside_countries || []).length ? [`Countries outside the expected profile: ${m.profile.outside_countries.join(', ')}`] : [])];
    if (flags.length) { subheading('Deviations from the expected profile'); markdown(flags.map((f) => `- ${f}`).join('\n')); }
    if (kycCase?.tm_risk_divergence?.rationale) {
      subheading(`KYC rating below monitoring band (${kycCase.tm_risk_divergence.kyc_rating} vs ${kycCase.tm_risk_divergence.dynamic_band})`);
      markdown(kycCase.tm_risk_divergence.rationale);
    }
  }

  // 5. Risk indicators
  section('5', 'Risk Indicators & Assessment');
  if (!assessments.length) markdown('No individual risk indicator assessments recorded. See the consolidated classification below.');
  else {
    const short = (s) => { const t = String(s || '').replace(/\\n|\n/g, ' ').replace(/[*#`]/g, '').trim(); return t.length > 110 ? `${t.slice(0, 107)}…` : t || '—'; };
    table([{ label: 'Indicator', w: 58 }, { label: 'Score', w: 24 }, { label: 'Override', w: 20 }, { label: 'Summary', w: 76 }],
      assessments.map((a) => [a.indicator_name, a.score, a.analyst_override ? 'Yes' : 'No', short(a.analyst_narrative || a.ai_narrative)]));
    const withText = assessments.filter((a) => (a.analyst_narrative || a.ai_narrative || '').length > 110 || (a.analyst_override && a.analyst_justification));
    if (withText.length) {
      subheading('Indicator narratives');
      withText.forEach((a) => {
        markdown(`**${a.indicator_name || 'Indicator'}** (${pretty(a.score)})`);
        if (a.analyst_narrative || a.ai_narrative) markdown(a.analyst_narrative || a.ai_narrative);
        if (a.analyst_override && a.analyst_justification) markdown(`**Override justification:** ${a.analyst_justification}`);
        gap(1.5);
      });
    }
  }

  // 6. Consolidated risk
  section('6', 'Consolidated Risk Classification');
  ensure(20);
  const rc = riskColor(risk);
  doc.setFillColor(...rc.bg); doc.roundedRect(MARGIN, y, 70, 15, 2, 2, 'F');
  font('bold', 13, rc.text); text(String(risk || 'Unclassified'), MARGIN + 4, y + 8);
  font('normal', 6.8, rc.text); text('RISK CLASSIFICATION', MARGIN + 4, y + 12.5);
  y += 19;
  if (kycCase?.risk_override_justification) { subheading('Analyst risk override'); markdown(kycCase.risk_override_justification); }
  if (kycCase?.compliance_advisory_note) { subheading('Compliance advisory note'); markdown(kycCase.compliance_advisory_note); }

  // 7. Control measures
  section('7', 'Control Measures & Mitigants');
  if (!controlMeasures.length) markdown('No control measures recorded for this case.');
  else table([{ label: 'Description', w: 84 }, { label: 'Owner', w: 36 }, { label: 'Due date', w: 26 }, { label: 'Status', w: 32 }],
    controlMeasures.map((cm) => [cm.description, cm.owner_name, cm.due_date, cm.status]));

  // 8. Sign-off
  section('8', 'Sign-Off Record');
  kvGrid([
    ['Submitted by', kycCase?.sign_off_submitted_by || preparedBy], ['Submitted at', fmtDate(kycCase?.sign_off_submitted_at, 'd MMM yyyy HH:mm')],
    ['Approved by', kycCase?.sign_off_approved_by], ['Approved at', fmtDate(kycCase?.sign_off_approved_at, 'd MMM yyyy HH:mm')],
  ]);
  if (kycCase?.sign_off_rejection_reason) kv('Rejection reason', kycCase.sign_off_rejection_reason);
  ensure(30); gap(2);
  ['Analyst signature', 'Compliance officer signature'].forEach((label, i) => {
    const bx = MARGIN + i * (INNER_W / 2 + 3), bw = INNER_W / 2 - 3;
    doc.setDrawColor(...BORDER); doc.setLineWidth(0.3); doc.roundedRect(bx, y, bw, 22, 1.5, 1.5, 'S');
    font('normal', 7, MUTED); text(label, bx + 3, y + 5);
    doc.line(bx + 3, y + 16, bx + bw - 3, y + 16);
    text('Date: ____________', bx + 3, y + 20);
  });
  y += 26;

  // 9. Annex manifest (always starts on a new page; the documents follow it)
  doc.addPage(); y = TOP;
  section('9', 'Annex');
  markdown('The documents below form the annex to this report. Each attached document follows on its own pages, introduced by a cover sheet with its annex reference: first the Didit identity verification report, then every document on the client file.');
  gap(1);
  if (!annexItems.length) markdown('No supporting documents on this case.');
  else table(
    [{ label: 'Ref', w: 13 }, { label: 'Document', w: 63 }, { label: 'Type', w: 28 }, { label: 'Source', w: 20 }, { label: 'Date', w: 24 }, { label: 'Status', w: 30 }],
    annexItems.map((it) => [it.ref, it.name, it.fileType ? `${it.type} (${it.fileType})` : it.type, it.source, fmtDate(it.date), it.status]),
  );
  const annexListedOnly = annexItems.filter((i) => i.status !== 'Attached');
  if (annexListedOnly.length) {
    font('normal', 7.2, MUTED);
    ensure(8);
    text(wrap('Listed only: the file type cannot be embedded in a PDF (it is kept on the client file). Not available: the file could not be retrieved when the report was generated.', INNER_W), MARGIN, y + 3);
    y += 9;
  }
  const annexEndPage = pageNo();

  // 10. Audit trail (new page; moved after the annex documents during assembly)
  doc.addPage(); y = TOP;
  const auditStartPage = pageNo();
  section('10', 'Audit Trail Appendix');
  if (auditEvents.length) {
    font('normal', 7.5, MUTED);
    text(`${auditEvents.length} event(s) recorded${auditEvents.length > 50 ? ' — first 50 shown' : ''}. Append-only audit log.`, MARGIN, y + 2); y += 6;
    table([{ label: 'Timestamp', w: 30 }, { label: 'Actor', w: 34 }, { label: 'Type', w: 18 }, { label: 'Event', w: 40 }, { label: 'Notes', w: 56 }],
      auditEvents.slice(0, 50).map((e) => [fmtDate(e.created_date, 'd MMM yy HH:mm'), e.actor_name, e.actor_type, e.event_type, String(e.notes || '').slice(0, 140)]));
  } else markdown('No audit events recorded for this case.');

  return { doc, dateStr, branding: b, marks: { tocSlots, sectionPages, annexEndPage, auditStartPage } };
}

// ── Assembly (pdf-lib) ─────────────────────────────────────────────────────
const toPt = (mm) => (mm * 72) / 25.4;
const rgbOf = (c) => rgb(c[0] / 255, c[1] / 255, c[2] / 255);

function fitText(fontObj, s, size, maxW) {
  let t = safeText(s);
  while (t.length > 3 && fontObj.widthOfTextAtSize(t, size) > maxW) t = `${t.slice(0, -4)}…`;
  return t;
}

/**
 * Merges: body pages up to the Annex manifest → per attached item a cover sheet + its pages → Audit Trail pages.
 * Then fills the TOC page numbers and stamps a footer with "Page x of N" on every page. Returns Uint8Array.
 */
export async function assembleReport({ doc, marks, branding: b, dateStr, annexItems = [] }) {
  const body = await PDFDocument.load(doc.output('arraybuffer'));
  const out = await PDFDocument.create();
  const helv = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const total = body.getPageCount();
  // One copyPages call: jsPDF pages share one resource dictionary, so separate calls would duplicate the logo.
  const preIdx = Array.from({ length: marks.annexEndPage }, (_, i) => i);
  const auditIdx = Array.from({ length: total - marks.auditStartPage + 1 }, (_, i) => marks.auditStartPage - 1 + i);
  const copied = await out.copyPages(body, [...preIdx, ...auditIdx]);
  const pre = copied.slice(0, preIdx.length);
  const auditPages = copied.slice(preIdx.length);
  pre.forEach((p) => out.addPage(p));
  const kinds = new Array(out.getPageCount()).fill('report');

  for (const it of annexItems) {
    if (it.status !== 'Attached' || !it.bytes) continue;
    let pages = [];
    let image = null;
    try {
      if (it.kind === 'pdf') {
        const src = await PDFDocument.load(it.bytes, { ignoreEncryption: true });
        pages = await out.copyPages(src, src.getPageIndices());
      } else image = it.kind === 'png' ? await out.embedPng(it.bytes) : await out.embedJpg(it.bytes);
    } catch {
      it.status = 'Not available';
      continue;
    }
    // Cover sheet for the annex item
    const sheet = out.addPage(A4_PT);
    kinds.push('report');
    const [W, H] = A4_PT;
    sheet.drawRectangle({ x: 0, y: H - toPt(42), width: W, height: toPt(42), color: rgbOf(b.tint) });
    sheet.drawRectangle({ x: 0, y: H - toPt(43.5), width: W, height: toPt(1.5), color: rgbOf(b.secondary) });
    sheet.drawText(`ANNEX ${it.ref}`, { x: toPt(MARGIN), y: H - toPt(20), size: 22, font: bold, color: rgbOf(b.primary) });
    sheet.drawText(fitText(bold, it.name, 13, W - toPt(MARGIN * 2)), { x: toPt(MARGIN), y: H - toPt(31), size: 13, font: bold, color: rgbOf(b.text) });
    const rows = [['Type', it.fileType ? `${it.type} (${it.fileType})` : it.type], ['Source', it.source], ['Date', fmtDate(it.date)],
      ['Pages', it.kind === 'pdf' ? String(pages.length) : '1 (image)'], ['Report', `KYC Investigation Report · ${dateStr}`]];
    rows.forEach(([l, v], i) => {
      const yy = H - toPt(58 + i * 8);
      sheet.drawText(l.toUpperCase(), { x: toPt(MARGIN), y: yy, size: 8, font: bold, color: rgbOf(MUTED) });
      sheet.drawText(fitText(helv, pretty(v), 10, W - toPt(MARGIN + 52)), { x: toPt(MARGIN + 40), y: yy, size: 10, font: helv, color: rgbOf(b.text) });
    });
    if (image) {
      const page = out.addPage(A4_PT);
      kinds.push('report');
      const maxW = W - toPt(MARGIN * 2), maxH = H - toPt(TOP + 24);
      const s = Math.min(maxW / image.width, maxH / image.height, 1);
      const w = image.width * s, h = image.height * s;
      page.drawImage(image, { x: (W - w) / 2, y: toPt(16) + (maxH - h) / 2, width: w, height: h });
    } else {
      pages.forEach((p) => { out.addPage(p); kinds.push(`annex:${it.ref}`); });
    }
  }

  const auditFirst = out.getPageCount() + 1;
  auditPages.forEach((p) => { out.addPage(p); kinds.push('report'); });

  // TOC page numbers: body pages keep their numbers up to the annex; the audit trail moved behind the documents.
  const cover = out.getPage(0);
  const pageOf = (num) => (num === '10' ? auditFirst : marks.sectionPages[num]);
  for (const slot of marks.tocSlots) {
    const p = pageOf(slot.num);
    if (!p) continue;
    const label = String(p);
    cover.drawText(label, { x: toPt(PAGE_W - MARGIN - 3) - helv.widthOfTextAtSize(label, 9), y: A4_PT[1] - toPt(slot.y), size: 9, font: helv, color: rgbOf(MUTED) });
  }

  // Footer on every page
  const N = out.getPageCount();
  out.getPages().forEach((page, i) => {
    const { width } = page.getSize();
    const kind = kinds[i] || 'report';
    const pageLabel = `Page ${i + 1} of ${N}`;
    if (kind === 'report') {
      page.drawRectangle({ x: 0, y: 0, width, height: toPt(9), color: rgbOf(b.primary) });
      page.drawText(fitText(helv, `${b.label}  ·  ${dateStr}  ·  CONFIDENTIAL — FOR COMPLIANCE USE ONLY`, 7, width - 140), { x: toPt(MARGIN), y: toPt(3.4), size: 7, font: helv, color: rgbOf(WHITE) });
      page.drawText(pageLabel, { x: width - toPt(MARGIN) - helv.widthOfTextAtSize(pageLabel, 7), y: toPt(3.4), size: 7, font: helv, color: rgbOf(WHITE) });
    } else {
      // Embedded document pages: a small label so the original content is never covered.
      const label = `Annex ${kind.slice(6)}  ·  ${pageLabel}`;
      const w = helv.widthOfTextAtSize(label, 6.5) + 10;
      page.drawRectangle({ x: width - w - 8, y: 6, width: w, height: 13, color: rgbOf(b.primary), opacity: 0.92 });
      page.drawText(label, { x: width - w - 3, y: 10.5, size: 6.5, font: helv, color: rgbOf(WHITE) });
    }
  });

  return out.save();
}

/** One call: body + annex + footers. Returns { bytes, pageCount, attached, listedOnly }. */
export async function buildKycReportPdf(input) {
  const { doc, marks, branding, dateStr } = buildReportBody(input);
  const bytes = await assembleReport({ doc, marks, branding, dateStr, annexItems: input.annexItems || [] });
  const pdf = await PDFDocument.load(bytes);
  const items = input.annexItems || [];
  return { bytes, pageCount: pdf.getPageCount(), attached: items.filter((i) => i.status === 'Attached').length, listedOnly: items.filter((i) => i.status !== 'Attached').length };
}
