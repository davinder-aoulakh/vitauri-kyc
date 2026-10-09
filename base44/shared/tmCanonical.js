// Canonical Transaction mapping + dedupe keys for Transaction Monitoring.

export function normaliseDescription(s) {
  return String(s ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function dedupeKey({ tenant_id, bank_account_id, executed_at, amount, currency, description_raw, external_id, seq }) {
  if (external_id) return 'ext:' + await sha256Hex(`${tenant_id}|${external_id}`);
  const day = new Date(executed_at).toISOString().slice(0, 10);
  const amt = Number(amount).toFixed(2);
  return sha256Hex([
    tenant_id,
    bank_account_id ?? '',
    day,
    amt,
    currency ?? '',
    normaliseDescription(description_raw),
    seq ?? 0,
  ].join('|'));
}

const CHANNEL_TO_SOURCE = {
  api: 'api',
  psd2: 'psd2',
  manual: 'manual',
  csv: 'upload_csv',
  xlsx: 'upload_xlsx',
  mt940: 'upload_mt940',
  camt: 'upload_camt',
  camt053: 'upload_camt',
  pdf: 'upload_pdf',
  upload_csv: 'upload_csv',
  upload_xlsx: 'upload_xlsx',
  upload_mt940: 'upload_mt940',
  upload_camt: 'upload_camt',
  upload_pdf: 'upload_pdf',
};

function dateInZone(date, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * context: { tenant (needs id + tm_timezone), tenant_id, client_id, bank_account_id, seq,
 *            source_file_id, ingest_batch_id, case_id, own_transfer }
 * Returns { record, errors[] }.
 */
export async function toCanonical(raw, channel, context = {}) {
  const errors = [];
  const tenant = context.tenant || {};
  const tenantId = context.tenant_id || tenant.id;
  const clientId = raw.client_id || context.client_id;
  if (!clientId) errors.push('client_id is required');
  if (!tenantId) errors.push('tenant_id is required');

  const execDate = raw.executed_at ? new Date(raw.executed_at) : null;
  if (!execDate || isNaN(execDate.getTime())) errors.push('executed_at is missing or invalid');

  let amount = Number(raw.amount);
  let direction = raw.direction ? String(raw.direction).toLowerCase() : '';
  if (raw.amount === undefined || raw.amount === null || raw.amount === '' || !isFinite(amount) || amount === 0) {
    errors.push('amount is missing or invalid');
  } else {
    if (!direction && amount < 0) direction = 'outbound';
    amount = Math.abs(amount);
  }

  const currency = raw.currency ? String(raw.currency).toUpperCase().trim() : '';
  if (!currency) errors.push('currency is missing');

  if (direction !== 'inbound' && direction !== 'outbound') errors.push('direction must be inbound or outbound');

  const source_type = CHANNEL_TO_SOURCE[String(channel || '').toLowerCase()];
  if (!source_type) errors.push('unknown channel');

  if (errors.length) return { record: null, errors };

  const tz = tenant.tm_timezone || 'America/Curacao';
  const bankAccountId = raw.bank_account_id || context.bank_account_id;
  const record = {
    tenant_id: tenantId,
    client_id: clientId,
    direction,
    amount,
    currency,
    currency_kind: raw.currency_kind || 'fiat',
    lifecycle: raw.lifecycle || 'booked',
    executed_at: execDate.toISOString(),
    received_at: new Date().toISOString(),
    source_type,
    coverage_date: dateInZone(execDate, tz),
    description_raw: raw.description_raw ?? raw.description ?? '',
    external_id: raw.external_id,
    counterparty_name: raw.counterparty_name,
    counterparty_account_id: raw.counterparty_account_id,
    counterparty_country: raw.counterparty_country,
    bank_account_id: bankAccountId,
    own_transfer: !!(raw.own_transfer ?? context.own_transfer),
    case_id: raw.case_id || context.case_id,
    source_file_id: context.source_file_id,
    ingest_batch_id: context.ingest_batch_id,
    related_to: raw.related_to,
  };
  record.dedupe_key = await dedupeKey({
    tenant_id: tenantId,
    bank_account_id: bankAccountId,
    executed_at: record.executed_at,
    amount,
    currency,
    description_raw: record.description_raw,
    external_id: record.external_id,
    seq: context.seq ?? raw.seq ?? 0,
  });
  for (const k of Object.keys(record)) if (record[k] === undefined) delete record[k];
  return { record, errors: [] };
}