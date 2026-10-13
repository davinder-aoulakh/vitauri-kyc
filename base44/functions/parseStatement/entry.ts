// parseStatement — parse an uploaded bank statement into reviewable rows + integrity checks.
// Auth: user with tmWorkCase. Tenant scope comes from the authenticated user, never from the payload.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import * as XLSX from 'npm:xlsx@0.18.5';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { runTmAgent } from '../../shared/tmAi.js';
import { normaliseDescription } from '../../shared/tmCanonical.js';
import {
  authenticate, errorResponse, httpError, loadTenant, chunk, asList, WORK_ROLES,
} from '../../shared/tmAuth.js';
import {
  MAX_ROWS, sha256Bytes, detectFormat, parseCsv, parseMatrix, matchesSavedMap, parseMt940, parseCamt053,
  parseDate, decorateRow, round2,
} from '../../shared/tmStatementParse.js';
import { deriveBalances, reconcile, findGaps, tamperSignals } from '../../shared/tmStatementChecks.js';
import { assignKeys, execAt } from '../../shared/tmStatementRows.js';
import { STATEMENT_SCHEMA, STATEMENT_SYSTEM_PROMPT, STATEMENT_SOURCE } from '../../shared/tmStatementAgent.js';

const acctNorm = (v) => String(v ?? '').toUpperCase().replace(/[\s-]/g, '');
const DAY_MS = 86400000;

async function parsePdf(base44, tenantId, upload, fileUrl) {
  const { output, ai_run_id } = await runTmAgent(base44, {
    tenantId, agent: 'StatementExtract', schema: STATEMENT_SCHEMA, systemPrompt: STATEMENT_SYSTEM_PROMPT,
    input: { task: 'Extract all transactions and balances from the attached bank statement.', file_name: upload.file_name },
    sources: [STATEMENT_SOURCE], defaultSourceRef: STATEMENT_SOURCE, fileUrls: [fileUrl],
  });
  if (output.insufficient_evidence && !(output.rows || []).length) {
    throw httpError(422, `The PDF could not be read as a bank statement${output.missing.length ? `: ${output.missing.join(', ')}` : ''}`);
  }
  const rows = (output.rows || []).map((r) => ({
    date: parseDate(r.date), description: String(r.description || '').trim(), amount: round2(Math.abs(Number(r.amount))),
    direction: r.direction, balance: typeof r.balance === 'number' ? r.balance : undefined,
  })).filter((r) => r.date && r.amount > 0 && (r.direction === 'inbound' || r.direction === 'outbound'));
  return {
    account_ref: output.account || undefined, currency: output.currency || undefined,
    period_from: parseDate(output.period_from) || undefined, period_to: parseDate(output.period_to) || undefined,
    opening: typeof output.opening_balance === 'number' ? output.opening_balance : null,
    closing: typeof output.closing_balance === 'number' ? output.closing_balance : null,
    rows, ai_run_id,
    pdf: { observations: output.tamper_observations || [], statedCredits: output.stated_total_credits, statedDebits: output.stated_total_debits, missing: output.missing },
  };
}

async function parseTabular(E, tenantId, format, bytes) {
  let matrix;
  if (format === 'xlsx') {
    const wb = XLSX.read(new Uint8Array(bytes), { type: 'array' });
    const sheets = wb.SheetNames.map((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }));
    matrix = sheets.find((s) => s.length >= 2) || sheets[0] || [];
  } else {
    matrix = parseCsv(new TextDecoder().decode(bytes));
  }
  const prev = asList(await E.StatementUpload.filter({ tenant_id: tenantId }, '-created_date', 30))
    .map((u) => u.column_map).filter((m) => m?.by_header);
  const saved = prev.find((m) => matchesSavedMap(matrix, m));
  const parsed = parseMatrix(matrix, saved);
  return { ...parsed, used_saved_map: !!saved };
}

export default async function (req) {
  let upload = null;
  let auth = null;
  let E = null;
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    auth = await authenticate(base44, req, body, { roles: WORK_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    E = base44.asServiceRole.entities;

    if (!body.statement_upload_id) throw httpError(400, 'statement_upload_id is required');
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');

    upload = asList(await E.StatementUpload.filter({ tenant_id: tenantId, id: body.statement_upload_id }))[0];
    if (!upload) throw httpError(404, 'Statement upload not found');
    if (upload.status === 'committed') throw httpError(409, 'This statement is already committed');
    const beforeStatus = upload.status;
    await E.StatementUpload.update(upload.id, { status: 'parsing', error: '' });

    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: upload.client_id }))[0];
    if (!client) throw httpError(404, 'Client not found');
    const accounts = asList(await E.BankAccount.filter({ tenant_id: tenantId, client_id: client.id }, undefined, 1000));

    // ── File ──
    // Files are stored privately (file_url holds the private file_uri); read through a short-lived signed URL.
    const fileUrl = /^https?:\/\//.test(upload.file_url)
      ? upload.file_url
      : (await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: upload.file_url, expires_in: 600 })).signed_url;
    const res = await fetch(fileUrl, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw httpError(422, `Could not read the uploaded file (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const file_hash = await sha256Bytes(bytes);
    const format = detectFormat(upload.file_name, bytes);
    if (!format) throw httpError(422, 'Unsupported file type. Use CSV, XLSX, MT940, CAMT.053 or PDF.');

    // ── Parse ──
    let parsed;
    const warnings = [];
    if (format === 'pdf') parsed = await parsePdf(base44, tenantId, upload, fileUrl);
    else if (format === 'mt940') parsed = parseMt940(new TextDecoder().decode(bytes));
    else if (format === 'camt053') parsed = parseCamt053(new TextDecoder().decode(bytes));
    else parsed = await parseTabular(E, tenantId, format, bytes);

    if (!parsed.rows.length) throw httpError(422, 'No transactions were found in this file');
    if (parsed.rows.length > MAX_ROWS) throw httpError(413, `This statement has ${parsed.rows.length} rows; the limit is ${MAX_ROWS}. Split it by period.`);
    if (parsed.skipped) warnings.push(`${parsed.skipped} line(s) without a valid date or amount were skipped`);

    // ── Account + currency ──
    const account = (upload.bank_account_id && accounts.find((a) => a.id === upload.bank_account_id))
      || (parsed.account_ref && accounts.find((a) => acctNorm(a.iban_or_number) === acctNorm(parsed.account_ref)))
      || null;
    if (upload.bank_account_id && !account) throw httpError(404, 'Bank account not found for this client');
    if (account && parsed.account_ref && acctNorm(account.iban_or_number) !== acctNorm(parsed.account_ref)) {
      warnings.push(`The statement account (${parsed.account_ref}) differs from the selected bank account (${account.iban_or_number})`);
    }
    const fallbackCcy = parsed.currency || account?.currency || upload.currency || tenant.tm_reporting_currency || 'USD';
    let assumedCcy = 0;
    const rows = parsed.rows.map((r, i) => {
      if (!r.currency) { r.currency = fallbackCcy; assumedCcy++; }
      return { ...decorateRow(r, parsed.account_ref || account?.iban_or_number), idx: i };
    });
    if (assumedCcy && !parsed.currency) warnings.push(`Currency not in the file; assumed ${fallbackCcy}`);

    // ── Integrity ──
    const bal = deriveBalances(rows, parsed.opening, parsed.closing);
    const rec = reconcile(rows, bal.opening, bal.closing, bal.chainBreaks);
    const dates = rows.map((r) => r.date).sort();
    const period_from = parsed.period_from || dates[0];
    const period_to = parsed.period_to || dates[dates.length - 1];
    const gaps = findGaps({
      rows, periodFrom: period_from, periodTo: period_to, opening: bal.opening, closing: bal.closing,
      hasRowBalances: bal.hasRowBalances, expectedFrequency: account?.expected_frequency || 'daily', reconciles: rec.reconciles,
    });
    const tamper = format === 'pdf'
      ? tamperSignals({ chainBreaks: bal.chainBreaks, reconciles: rec.reconciles, diff: rec.diff, rows, ...parsed.pdf, observations: parsed.pdf.observations })
      : [];
    if (format === 'pdf' && parsed.pdf.missing?.length) warnings.push(`Not found in PDF: ${parsed.pdf.missing.join(', ')}`);

    // ── Duplicates (existing transactions, same dedupe logic as normaliseTransactions) ──
    await assignKeys({ tenantId, clientId: client.id, accountId: account?.id, rows });
    const existing = new Set();
    for (const c of chunk(rows.map((r) => r.dedupe_key), 100)) {
      for (const t of asList(await E.Transaction.filter({ tenant_id: tenantId, dedupe_key: { $in: c } }, undefined, 500))) existing.add(t.dedupe_key);
    }
    let duplicates = 0;
    for (const r of rows) if (existing.has(r.dedupe_key)) { r.duplicate = true; duplicates++; }

    // ── Own transfers + reversal links (informational; normaliseTransactions repeats both on commit) ──
    const ownAccts = new Set(accounts.filter((a) => a.id !== account?.id).map((a) => acctNorm(a.iban_or_number)));
    let ownTransfers = 0;
    for (const r of rows) {
      if (r.counterparty_account_id && ownAccts.has(acctNorm(r.counterparty_account_id))) { r.own_transfer = true; ownTransfers++; }
    }
    let linked = 0;
    for (const r of rows.filter((x) => x.lifecycle === 'reversed' && !x.duplicate).slice(0, 30)) {
      const t0 = Date.parse(execAt(r.date));
      const cands = asList(await E.Transaction.filter({
        tenant_id: tenantId, client_id: client.id, amount: r.amount, currency: r.currency, lifecycle: 'booked',
        executed_at: { $gte: new Date(t0 - 30 * DAY_MS).toISOString(), $lte: new Date(t0 + 30 * DAY_MS).toISOString() },
      }, undefined, 50));
      const nd = normaliseDescription(r.description);
      if (cands.some((o) => { const od = normaliseDescription(o.description_raw); return od === nd || (!!nd && !!od && (od.includes(nd) || nd.includes(od))); })) linked++;
    }

    // ── Same file already committed? ──
    const sameFile = asList(await E.StatementUpload.filter({ tenant_id: tenantId, file_hash, status: 'committed' }, undefined, 1));
    if (sameFile.length) warnings.push('An identical file was already committed for this tenant');

    const patch = {
      format, file_hash, template: parsed.templateKey ? (await sha256Bytes(new TextEncoder().encode(parsed.templateKey))).slice(0, 16) : undefined,
      column_map: parsed.column_map || undefined,
      bank_account_id: account?.id || upload.bank_account_id || undefined,
      period_from, period_to, opening_balance: bal.opening ?? undefined, closing_balance: bal.closing ?? undefined,
      currency: fallbackCcy, reconciles: rec.reconciles ?? undefined, reconcile_diff: rec.diff ?? undefined,
      gaps, tamper_signals: tamper, extracted_count: rows.length, duplicates_removed: duplicates,
      own_transfers: ownTransfers, reversals_linked: linked, parsed_rows: rows, warnings,
      account_ref: parsed.account_ref || account?.iban_or_number || undefined,
      ai_run_id: parsed.ai_run_id || undefined, status: 'review', error: '',
    };
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
    await E.StatementUpload.update(upload.id, patch);

    await writeAudit(base44, auth, {
      tenantId, clientId: client.id, eventType: 'tm_statement_parsed',
      before: { status: beforeStatus }, after: { status: 'review', statement_upload_id: upload.id, format, rows: rows.length, duplicates, reconciles: rec.reconciles, gaps: gaps.length, tamper_signals: tamper.length },
      notes: `Parsed ${upload.file_name} (${format}): ${rows.length} row(s), ${duplicates} duplicate(s), ${gaps.length} gap(s).`,
    });

    return Response.json({
      statement_upload_id: upload.id, status: 'review', format, extracted_count: rows.length, duplicates_removed: duplicates,
      reconciles: rec.reconciles, gaps, tamper_signals: tamper, own_transfers: ownTransfers, reversals_linked: linked, warnings,
    });
  } catch (error) {
    if (upload && E) {
      try {
        await E.StatementUpload.update(upload.id, { status: 'failed', error: String(error?.message || error).slice(0, 500) });
        await writeAudit({ asServiceRole: { entities: E } }, auth, {
          tenantId: upload.tenant_id, clientId: upload.client_id, eventType: 'tm_statement_parse_failed',
          before: { status: upload.status }, after: { status: 'failed', statement_upload_id: upload.id }, notes: String(error?.message || error).slice(0, 300),
        });
      } catch { /* keep original error */ }
    }
    return errorResponse(error);
  }
}