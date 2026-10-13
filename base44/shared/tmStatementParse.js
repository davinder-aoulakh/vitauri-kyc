// Bank statement parsers for Transaction Monitoring (CSV/XLSX matrix, MT940, CAMT.053).
// Every parser returns { account_ref, currency, period_from, period_to, opening, closing, rows[] }.
// Row: { date:'YYYY-MM-DD', description, amount (>0), direction:'inbound'|'outbound', balance?, currency?,
//        counterparty_name?, counterparty_account_id?, lifecycle? }

export const MAX_ROWS = 2000;
export const round2 = (n) => Math.round(n * 100) / 100;
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
const REVERSAL_RE = /\b(reversal|reversed|storno|stornering|chargeback)\b/i;

export async function sha256Bytes(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Scalar parsing ──
export function parseNumber(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const orig = String(v ?? '').trim();
  if (!orig) return null;
  let neg = /^\(.*\)$/.test(orig) || /\bDR\b/i.test(orig) || /-\s*$/.test(orig);
  let s = orig.replace(/[^\d,.\-+]/g, '');
  if (s.startsWith('-')) neg = true;
  s = s.replace(/[-+]/g, '');
  if (!s) return null;
  const lc = s.lastIndexOf(',');
  const ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) {
    s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lc >= 0) {
    s = /,\d{1,2}$/.test(s) && s.indexOf(',') === lc ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return neg ? -n : n;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function ymd(y, m, d) {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function parseDate(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
    return null;
  }
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})/);
  if (m) {
    const a = +m[1]; const b = +m[2];
    return b > 12 ? ymd(+m[3], a, b) : ymd(+m[3], b, a); // day-first unless the second part cannot be a month
  }
  m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ,]+(\d{2,4})/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return ymd(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  return null;
}

export function extractIbans(text) {
  return [...String(text || '').toUpperCase().matchAll(IBAN_RE)].map((m) => m[0]);
}

// Adds lifecycle + counterparty account hints that apply to every format.
export function decorateRow(row, accountRef) {
  const own = String(accountRef || '').toUpperCase().replace(/\s/g, '');
  if (!row.counterparty_account_id) {
    const other = extractIbans(row.description).find((i) => i !== own);
    if (other) row.counterparty_account_id = other;
  }
  if (!row.lifecycle) row.lifecycle = REVERSAL_RE.test(row.description || '') ? 'reversed' : 'booked';
  return row;
}

// ── Delimited text ──
export function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/).find((l) => l.trim()) || '';
  const delim = [',', ';', '\t', '|'].map((d) => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = []; let cell = ''; let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => String(x).trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => String(x).trim() !== '')) rows.push(row);
  return rows;
}

// ── Column mapping (CSV / XLSX) ──
const norm = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9 /]+/g, ' ').replace(/\s+/g, ' ').trim();
const SYN = {
  date: ['date', 'booking date', 'transaction date', 'value date', 'posting date', 'datum', 'boekdatum', 'valutadatum', 'buchungstag', 'fecha', 'completed date', 'started date', 'timestamp'],
  balance: ['balance', 'running balance', 'saldo', 'saldo na mutatie', 'closing balance', 'balance after'],
  debit: ['debit', 'debits', 'withdrawal', 'withdrawals', 'paid out', 'money out', 'uitgaand', 'debet', 'soll'],
  credit: ['credit', 'credits', 'deposit', 'deposits', 'paid in', 'money in', 'inkomend', 'krediet', 'haben'],
  amount: ['amount', 'transaction amount', 'bedrag', 'betrag', 'value', 'importe'],
  currency: ['currency', 'ccy', 'valuta', 'munt', 'curr'],
  description: ['description', 'details', 'narrative', 'memo', 'omschrijving', 'transaction description', 'particulars', 'remarks', 'verwendungszweck', 'beschrijving', 'reference', 'text'],
  counterparty: ['counterparty', 'beneficiary', 'payee', 'tegenpartij', 'naam', 'merchant', 'name'],
  direction: ['direction', 'type', 'dc', 'cr/dr', 'debit/credit', 'af bij', 'af/bij', 'sign'],
};
const FIELD_ORDER = ['date', 'balance', 'debit', 'credit', 'amount', 'currency', 'description', 'counterparty', 'direction'];

function mapHeaders(headers) {
  const h = headers.map(norm);
  const map = {};
  const used = new Set();
  for (const f of FIELD_ORDER) {
    let idx = h.findIndex((x, i) => !used.has(i) && SYN[f].includes(x));
    if (idx < 0) idx = h.findIndex((x, i) => !used.has(i) && x && SYN[f].some((s) => s.length >= 4 && x.includes(s)));
    if (idx >= 0) { map[f] = idx; used.add(idx); }
  }
  return map;
}

const hasCore = (m) => m.date !== undefined && (m.amount !== undefined || m.debit !== undefined || m.credit !== undefined);

function locateHeader(matrix, saved) {
  const limit = Math.min(matrix.length, 40);
  if (saved?.by_header) {
    const want = Object.entries(saved.by_header).map(([f, name]) => [f, norm(name)]);
    for (let i = 0; i < limit; i++) {
      const h = matrix[i].map(norm);
      const map = {};
      for (const [f, name] of want) { const idx = h.indexOf(name); if (idx >= 0) map[f] = idx; }
      if (Object.keys(map).length === want.length && hasCore(map)) return { headerIdx: i, map };
    }
  }
  for (let i = 0; i < limit; i++) {
    const map = mapHeaders(matrix[i]);
    if (hasCore(map)) return { headerIdx: i, map };
  }
  return null;
}

const DEBIT_WORDS = /^(d|dr|debit|dbit|af|out|outgoing|withdrawal|soll)$/i;
const CREDIT_WORDS = /^(c|cr|credit|crdt|bij|in|incoming|deposit|haben)$/i;

/** matrix: array of arrays. saved: previously stored column_map for the same template. */
export function parseMatrix(matrix, saved) {
  const loc = locateHeader(matrix, saved);
  if (!loc) throw new Error('Could not detect the header row. Expected a date column and an amount (or debit/credit) column.');
  const { headerIdx, map } = loc;
  const headers = matrix[headerIdx].map((x) => String(x ?? '').trim());
  const by_header = {};
  for (const [f, idx] of Object.entries(map)) by_header[f] = headers[idx];
  const templateKey = headers.map(norm).filter(Boolean).join('|');

  const rows = [];
  let skipped = 0;
  for (const r of matrix.slice(headerIdx + 1)) {
    if (!r.some((x) => String(x ?? '').trim() !== '')) continue;
    const date = parseDate(r[map.date]);
    if (!date) { skipped++; continue; }
    let amount = null; let direction = null;
    if (map.amount !== undefined) {
      const a = parseNumber(r[map.amount]);
      if (a !== null && a !== 0) { amount = Math.abs(a); direction = a < 0 ? 'outbound' : 'inbound'; }
    }
    if (map.debit !== undefined || map.credit !== undefined) {
      const d = map.debit !== undefined ? parseNumber(r[map.debit]) : null;
      const c = map.credit !== undefined ? parseNumber(r[map.credit]) : null;
      if (d) { amount = Math.abs(d); direction = 'outbound'; } else if (c) { amount = Math.abs(c); direction = 'inbound'; }
    }
    if (map.direction !== undefined && amount !== null) {
      const w = String(r[map.direction] ?? '').trim();
      if (DEBIT_WORDS.test(w)) direction = 'outbound'; else if (CREDIT_WORDS.test(w)) direction = 'inbound';
    }
    if (!amount) { skipped++; continue; }
    const bal = map.balance !== undefined ? parseNumber(r[map.balance]) : null;
    const cur = map.currency !== undefined ? String(r[map.currency] ?? '').trim().toUpperCase() : '';
    const row = {
      date, amount: round2(amount), direction,
      description: map.description !== undefined ? String(r[map.description] ?? '').trim() : '',
    };
    if (bal !== null) row.balance = bal;
    if (/^[A-Z]{3}$/.test(cur)) row.currency = cur;
    if (map.counterparty !== undefined && String(r[map.counterparty] ?? '').trim()) row.counterparty_name = String(r[map.counterparty]).trim();
    rows.push(row);
  }
  if (rows.length > 1 && rows[0].date > rows[rows.length - 1].date) rows.reverse(); // newest-first exports
  return {
    account_ref: undefined, currency: undefined, opening: null, closing: null, rows,
    column_map: { header_row: headerIdx, by_header }, templateKey, skipped,
  };
}

// ── MT940 ──
function mtDate(yymmdd) {
  const yy = +yymmdd.slice(0, 2);
  return ymd((yy > 70 ? 1900 : 2000) + yy, +yymmdd.slice(2, 4), +yymmdd.slice(4, 6));
}
const mtNum = (s) => parseFloat(String(s).replace(',', '.'));

export function parseMt940(text) {
  const blocks = String(text).replace(/\r/g, '').split(/\n(?=:\d{2}[A-Z]?:)/);
  const out = { account_ref: undefined, currency: undefined, period_from: undefined, period_to: undefined, opening: null, closing: null, rows: [] };
  let cur = null;
  for (const blk of blocks) {
    const m = blk.match(/^:(\d{2}[A-Z]?):([\s\S]*)$/);
    if (!m) continue;
    const tag = m[1]; const val = m[2];
    if (tag === '25' && !out.account_ref) {
      const first = val.split('\n')[0].trim();
      out.account_ref = first.split('/')[0].trim();
      const c = first.split('/')[1];
      if (c && /^[A-Z]{3}$/.test(c.trim())) out.currency = c.trim();
    } else if (tag === '60F' || tag === '60M') {
      const b = val.match(/^([CD])(\d{6})([A-Z]{3})([\d,]+)/);
      if (b && out.opening === null) {
        out.opening = (b[1] === 'D' ? -1 : 1) * mtNum(b[4]);
        out.period_from = mtDate(b[2]);
        out.currency = out.currency || b[3];
      }
    } else if (tag === '62F' || tag === '62M') {
      const b = val.match(/^([CD])(\d{6})([A-Z]{3})([\d,]+)/);
      if (b) { out.closing = (b[1] === 'D' ? -1 : 1) * mtNum(b[4]); out.period_to = mtDate(b[2]); }
    } else if (tag === '61') {
      const line = val.split('\n')[0];
      const e = line.match(/^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?(\d+(?:,\d*)?)(N|F|S)([A-Z0-9]{3})(.*)$/);
      if (!e) { cur = null; continue; }
      const mark = e[3];
      cur = {
        date: mtDate(e[1]), amount: round2(mtNum(e[5])),
        direction: mark === 'C' || mark === 'RD' ? 'inbound' : 'outbound',
        description: (val.split('\n')[1] || '').trim(),
      };
      if (mark.startsWith('R')) cur.lifecycle = 'reversed';
      out.rows.push(cur);
    } else if (tag === '86' && cur) {
      const d = val.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      cur.description = cur.description ? `${cur.description} ${d}`.trim() : d;
      const nm = d.match(/\/NAME\/(.+?)(?:\/[A-Z]{2,5}\/|$)/) || d.match(/\?32([^?]+)/);
      if (nm) cur.counterparty_name = nm[1].trim();
    }
  }
  out.rows = out.rows.filter((r) => r.date && r.amount > 0);
  return out;
}

// ── CAMT.053 (regex based, namespace agnostic) ──
const P = '(?:[A-Za-z0-9_]+:)?';
const decodeXml = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function xmlBlocks(xml, name) {
  const re = new RegExp(`<${P}${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${P}${name}>`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1]);
}
const xmlText = (xml, name) => { const b = xmlBlocks(xml || '', name)[0]; return b === undefined ? undefined : decodeXml(b.replace(/<[^>]+>/g, '').trim()); };
const xmlDate = (xml) => (String(xml || '').match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
function xmlAmt(xml) {
  const m = String(xml || '').match(new RegExp(`<${P}Amt\\s+[^>]*Ccy="([A-Z]{3})"[^>]*>([^<]+)<`));
  return m ? { ccy: m[1], value: parseFloat(m[2]) } : null;
}

export function parseCamt053(xml) {
  const out = { account_ref: undefined, currency: undefined, period_from: undefined, period_to: undefined, opening: null, closing: null, rows: [] };
  const stmts = xmlBlocks(xml, 'Stmt');
  if (!stmts.length) throw new Error('No Stmt element found. Is this a CAMT.053 file?');
  stmts.forEach((st, si) => {
    const acct = xmlBlocks(st, 'Acct')[0] || '';
    if (!out.account_ref) out.account_ref = xmlText(acct, 'IBAN') || xmlText(xmlBlocks(acct, 'Othr')[0] || '', 'Id');
    for (const bal of xmlBlocks(st, 'Bal')) {
      const code = xmlText(bal, 'Cd');
      const a = xmlAmt(bal);
      if (!a) continue;
      const signed = (xmlText(bal, 'CdtDbtInd') === 'DBIT' ? -1 : 1) * a.value;
      if ((code === 'OPBD' || code === 'PRCD') && out.opening === null && si === 0) { out.opening = signed; out.period_from = xmlDate(bal); out.currency = out.currency || a.ccy; }
      if (code === 'CLBD') { out.closing = signed; out.period_to = xmlDate(bal); out.currency = out.currency || a.ccy; }
    }
    for (const nt of xmlBlocks(st, 'Ntry')) {
      const a = xmlAmt(nt);
      const date = xmlDate(xmlBlocks(nt, 'BookgDt')[0]) || xmlDate(xmlBlocks(nt, 'ValDt')[0]);
      if (!a || !date || !(a.value > 0)) continue;
      const direction = xmlText(nt, 'CdtDbtInd') === 'DBIT' ? 'outbound' : 'inbound';
      const rp = xmlBlocks(nt, 'RltdPties')[0] || '';
      const party = xmlBlocks(rp, direction === 'inbound' ? 'Dbtr' : 'Cdtr')[0] || '';
      const partyAcct = xmlBlocks(rp, direction === 'inbound' ? 'DbtrAcct' : 'CdtrAcct')[0] || '';
      const desc = xmlBlocks(nt, 'Ustrd').map((x) => decodeXml(x.trim())).join(' ')
        || xmlText(nt, 'AddtlTxInf') || xmlText(nt, 'AddtlNtryInf') || '';
      const row = { date, amount: round2(a.value), direction, description: desc.replace(/\s+/g, ' ').trim(), currency: a.ccy };
      const nm = xmlText(party, 'Nm');
      if (nm) row.counterparty_name = nm;
      const acc = xmlText(partyAcct, 'IBAN') || xmlText(partyAcct, 'Id');
      if (acc) row.counterparty_account_id = acc;
      if (/^(true|1)$/i.test(xmlText(nt, 'RvslInd') || '')) row.lifecycle = 'reversed';
      out.rows.push(row);
    }
  });
  return out;
}

export function detectFormat(fileName, bytes) {
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  const head = bytes.slice(0, 4);
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf';
  if (head[0] === 0x50 && head[1] === 0x4b) return 'xlsx';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  const sample = new TextDecoder().decode(bytes.slice(0, 6000));
  if (/:20:/.test(sample) && /:61:/.test(sample)) return 'mt940';
  if (/<(?:\w+:)?(?:BkToCstmrStmt|Stmt)\b/.test(sample)) return 'camt053';
  if (['csv', 'txt', 'tsv'].includes(ext)) return 'csv';
  if (ext === 'xml') return 'camt053';
  if (['sta', '940', 'mt940'].includes(ext)) return 'mt940';
  return null;
}