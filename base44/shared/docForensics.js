// docForensics — deterministic authenticity signals for an uploaded document (no AI, no network).
// Works on the raw bytes: file type, PDF producer / dates / incremental saves / signature, image EXIF software,
// and re-use of the exact same file. Each signal is a check { id, label, result: pass|warn|fail|info, detail }.
// Pure ES module: runs in Deno (checkDocumentAuthenticity) and in node tests.

const EDITORS = /photoshop|gimp|canva|illustrator|inkscape|affinity|pixelmator|paint\.net|snapseed|picsart|ilovepdf|smallpdf|sejda|pdfescape|pdf-?xchange|foxit phantom|nitro pro|pdfelement|pdffiller|dochub|sodapdf/i;
const OFFICE = /microsoft.*word|libreoffice|openoffice|pages|google docs/i;
const SCANNERS = /scan|canon|epson|hp |xerox|ricoh|brother|kyocera|konica|sharp|adobe scan|camscanner|genius scan|microsoft lens/i;

export function sniffType(bytes) {
  const b = bytes || new Uint8Array();
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'zip/office';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'webp';
  if ((b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70)) return 'heic/mp4';
  return 'unknown';
}

const latin1 = (bytes) => {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + step)));
  return s;
};

// PDF date "D:20260626164100+02'00'" → ISO (best effort)
function pdfDate(v) {
  const m = String(v || '').match(/D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00'] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

function pdfField(text, key) {
  // /Producer (text) or /Producer <FEFF…hex> — and the XMP equivalents
  const lit = text.match(new RegExp(`/${key}\\s*\\(([^)]{0,200})\\)`));
  if (lit) return lit[1].replace(/\\(.)/g, '$1').replace(/[^\x20-\x7e]/g, '').trim();
  const hex = text.match(new RegExp(`/${key}\\s*<([0-9A-Fa-f]{4,400})>`));
  if (hex) {
    const h = hex[1].replace(/^FEFF/i, '');
    let out = '';
    for (let i = 0; i + 3 < h.length; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
    return out.replace(/[^\x20-\x7e]/g, '').trim();
  }
  const xmpKey = { Producer: 'pdf:Producer', Creator: 'xmp:CreatorTool', CreationDate: 'xmp:CreateDate', ModDate: 'xmp:ModifyDate' }[key];
  const xmp = xmpKey && text.match(new RegExp(`<${xmpKey}>([^<]{0,200})</${xmpKey}>|${xmpKey}="([^"]{0,200})"`));
  return xmp ? (xmp[1] || xmp[2] || '').trim() : null;
}

// Documents that are normally written in a word processor or made by the client itself (a notary's deed, an organisation
// chart, a declaration): the creating software says nothing about authenticity there.
const SELF_MADE = /deed|akte|articles|statuten|incorporation|association|oprichting|organi[sz]ation(al)? ?(chart|structure)|organogram|structure|chart|declaration|verklaring|letter|brief|resolution|besluit|agreement|overeenkomst|contract/i;

function pdfChecks(bytes, checks, opts = {}) {
  const text = latin1(bytes);
  const producer = pdfField(text, 'Producer');
  const creator = pdfField(text, 'Creator');
  const tool = [producer, creator].filter(Boolean).join(' / ');
  const created = pdfDate(pdfField(text, 'CreationDate')) || pdfField(text, 'CreationDate');
  const modified = pdfDate(pdfField(text, 'ModDate')) || pdfField(text, 'ModDate');
  const eofs = (text.match(/%%EOF/g) || []).length;
  const signed = /\/ByteRange\s*\[/.test(text) && /\/Type\s*\/Sig\b|\/FT\s*\/Sig\b/.test(text);
  const encrypted = /\/Encrypt\s/.test(text);
  const pages = (text.match(/\/Type\s*\/Page\b(?!s)/g) || []).length;

  if (!tool) checks.push({ id: 'pdf_producer', label: 'Creating software', result: 'info', detail: 'No producer recorded in the file.' });
  else if (EDITORS.test(tool)) checks.push({ id: 'pdf_producer', label: 'Creating software', result: 'fail', detail: `Made or edited with an editing tool: ${tool}.` });
  else if (OFFICE.test(tool)) {
    const selfMade = SELF_MADE.test(String(opts.label || ''));
    checks.push(selfMade
      ? { id: 'pdf_producer', label: 'Creating software', result: 'info', detail: `Created in a word processor (${tool}); normal for this kind of document.` }
      : { id: 'pdf_producer', label: 'Creating software', result: 'warn', detail: `Created in a word processor (${tool}); documents from an issuer's system are rarely produced this way.` });
  }
  else checks.push({ id: 'pdf_producer', label: 'Creating software', result: SCANNERS.test(tool) ? 'info' : 'pass', detail: tool });

  const differs = created && modified && String(created).slice(0, 16) !== String(modified).slice(0, 16);
  const sameDay = differs && String(created).slice(0, 10) === String(modified).slice(0, 10);
  if (differs && (signed || sameDay)) {
    // A signing step or a same-day save changes the modification time; that is not an edit of the content.
    checks.push({ id: 'pdf_dates', label: 'Creation vs modification date', result: 'pass', detail: `Created ${String(created).slice(0, 16)}, last saved ${String(modified).slice(0, 16)}${signed ? ' (digital signature applied)' : ' (same day)'}.` });
  } else if (differs) {
    checks.push({ id: 'pdf_dates', label: 'Creation vs modification date', result: 'warn', detail: `Created ${String(created).slice(0, 16)}, modified ${String(modified).slice(0, 16)}.` });
  } else if (created) {
    checks.push({ id: 'pdf_dates', label: 'Creation vs modification date', result: 'pass', detail: `Created ${String(created).slice(0, 16)}; not modified afterwards.` });
  }
  if (eofs > 1 && !signed) checks.push({ id: 'pdf_incremental', label: 'Edited after first save', result: eofs >= 3 || EDITORS.test(tool) ? 'warn' : 'info', detail: `The file was saved ${eofs} times (incremental updates)${eofs >= 3 ? '' : '; a second save is common (e.g. print to PDF, added properties)'}.` });
  else checks.push({ id: 'pdf_incremental', label: 'Edited after first save', result: 'pass', detail: eofs > 1 ? 'Incremental updates belong to the digital signature.' : 'Saved once.' });
  checks.push(signed
    ? { id: 'pdf_signature', label: 'Digital signature', result: 'pass', detail: 'The PDF carries a digital signature.' }
    : { id: 'pdf_signature', label: 'Digital signature', result: 'info', detail: 'Not digitally signed.' });
  if (encrypted) checks.push({ id: 'pdf_encrypted', label: 'Encryption', result: 'info', detail: 'The PDF is encrypted / protected.' });
  if (pages) checks.push({ id: 'pdf_pages', label: 'Pages', result: 'info', detail: `${pages} page(s).` });
  return { producer: tool || null, created, modified, signed, pages };
}

function imageChecks(bytes, type, checks) {
  const text = latin1(bytes.subarray(0, Math.min(bytes.length, 256 * 1024)));
  const sw = (text.match(/(Adobe Photoshop[^\x00]{0,40}|GIMP[^\x00]{0,20}|Snapseed|Picsart|Canva|Pixelmator[^\x00]{0,20}|paint\.net[^\x00]{0,10})/i) || [])[1];
  if (sw) checks.push({ id: 'img_software', label: 'Editing software', result: 'warn', detail: `Image metadata names an editor: ${sw.replace(/[^\x20-\x7e]/g, '').trim()}.` });
  const hasExif = type === 'jpg' ? text.includes('Exif') : /eXIf|tEXt|iTXt/.test(text);
  if (!hasExif) checks.push({ id: 'img_metadata', label: 'Camera / scanner metadata', result: 'info', detail: 'No camera or scanner metadata (screenshots and re-saved images have none).' });
  else if (!sw) checks.push({ id: 'img_metadata', label: 'Camera / scanner metadata', result: 'pass', detail: 'Camera or scanner metadata present.' });
  if (bytes.length < 60 * 1024) checks.push({ id: 'img_quality', label: 'Image quality', result: 'warn', detail: `Small file (${Math.round(bytes.length / 1024)} KB): details may be unreadable.` });
}

/**
 * opts: { fileName, label, sha256, sameHashOtherClients: [names], sameHashSameClient: n }
 * Returns { type, checks, facts }.
 */
export function analyseBytes(bytes, opts = {}) {
  const checks = [];
  const type = sniffType(bytes);
  const ext = String(opts.fileName || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1] || null;
  const extType = { pdf: 'pdf', png: 'png', jpg: 'jpg', jpeg: 'jpg', webp: 'webp', heic: 'heic/mp4', doc: 'zip/office', docx: 'zip/office' }[ext] || null;

  if (type === 'unknown') checks.push({ id: 'file_type', label: 'File type', result: 'warn', detail: 'Unrecognised file format.' });
  else if (extType && extType !== type) checks.push({ id: 'file_type', label: 'File type', result: 'fail', detail: `The file name says .${ext} but the content is ${type.toUpperCase()}.` });
  else checks.push({ id: 'file_type', label: 'File type', result: 'pass', detail: type.toUpperCase() });

  let facts = {};
  if (type === 'pdf') facts = pdfChecks(bytes, checks, opts);
  else if (type === 'jpg' || type === 'png') {
    imageChecks(bytes, type, checks);
    if (/extract|register|uittreksel|kvk|statement|certificate|articles|statuten/i.test(String(opts.label || ''))) {
      checks.push({ id: 'img_for_official', label: 'Format for this document', result: 'warn', detail: 'An official document was provided as a photo or screenshot instead of the original PDF.' });
    }
  }

  // Re-use of the identical file. opts.reuse = { unrelated: [names], sameSubject: [names], linked: [text], sameClient: n }
  // Only a file shared with an UNRELATED client is a concern; the same person/company on an earlier file, or a linked
  // party (a UBO and their company), legitimately shares documents.
  const reuse = opts.reuse || { unrelated: opts.sameHashOtherClients || [], sameSubject: [], linked: [], sameClient: opts.sameHashSameClient || 0 };
  if ((reuse.unrelated || []).length) checks.push({ id: 'file_reuse', label: 'File re-used', result: 'warn', detail: `The identical file is also on the file of an unrelated client: ${reuse.unrelated.slice(0, 3).join(', ')}.` });
  else if ((reuse.linked || []).length) checks.push({ id: 'file_reuse', label: 'File re-used', result: 'info', detail: `Also on the file of a linked party: ${reuse.linked.slice(0, 3).join('; ')}.` });
  else if ((reuse.sameSubject || []).length) checks.push({ id: 'file_reuse', label: 'File re-used', result: 'info', detail: `The same file is on an earlier file of the same ${opts.isOrg ? 'company' : 'person'} (${reuse.sameSubject.slice(0, 2).join(', ')}).` });
  else if (reuse.sameClient) checks.push({ id: 'file_reuse', label: 'File re-used', result: 'info', detail: 'The same file was uploaded earlier for this client.' });
  else if (opts.sha256) checks.push({ id: 'file_reuse', label: 'File re-used', result: 'pass', detail: 'Not seen for any other client.' });

  return { type, checks, facts };
}

// A fail about the document's age / validity period is a follow-up point (ask for a newer one), not an authenticity concern.
const SOFT_FAIL = /\bage\b|older|outdated|validity|valid(ity)? (date|period)|expir|recent|document date|date check/i;
const isSoft = (c) => SOFT_FAIL.test(`${c.id || ''} ${c.label || ''}`.replace(/_/g, ' '));

/**
 * Verdict from all checks (forensic + AI) and the AI's own verdict.
 *  high_risk       a strong signal: any hard fail (wrong file type, editing tool, name / registration mismatch, visible
 *                  tampering, unrelated re-use with a name mismatch) or three or more warnings
 *  needs_attention one or two warnings, a soft fail (document too old), or the AI is not fully satisfied
 *  authentic       nothing to report
 * The AI verdict alone never makes a document high risk: it needs a failed check that says why.
 */
export function combineVerdict(checks, aiVerdict) {
  const list = checks || [];
  const hardFail = list.some((c) => c.result === 'fail' && !isSoft(c));
  const warns = list.filter((c) => c.result === 'warn' || (c.result === 'fail' && isSoft(c))).length;
  if (hardFail || warns >= 3) return 'high_risk';
  if (warns >= 1 || (aiVerdict && aiVerdict !== 'authentic')) return 'needs_attention';
  return 'authentic';
}

/** 0–100 (100 = no concerns). */
export function scoreOf(checks) {
  let s = 100;
  for (const c of checks || []) s -= c.result === 'fail' ? 40 : c.result === 'warn' ? 12 : 0;
  return Math.max(0, s);
}
