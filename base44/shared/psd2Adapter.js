// PSD2 partner adapter interface and registry (skeleton: no bank or partner is connected).
//
// An adapter is { name, connect, listAccounts, listTransactions, revoke }:
//   connect(ctx, { bankAccount, redirectUrl })                  -> { consentUrl?, consentId? }
//   listAccounts(ctx, consentId)                                -> [{ accountRef, iban?, currency? }]
//   listTransactions(ctx, { consentId, accountRef, from, to })  -> rows for normaliseTransactions (channel 'psd2')
//   revoke(ctx, consentId)                                      -> void
// ctx = { base44, tenantId, tenant }. Methods throw { status, detail } (an Error carrying both) when they fail.

export const NO_PARTNER_DETAIL = 'No PSD2 partner configured';

function notConfigured() {
  const err = new Error(NO_PARTNER_DETAIL);
  err.status = 501;
  err.detail = NO_PARTNER_DETAIL;
  throw err;
}

const manualAdapter = {
  name: 'manual',
  connect: async () => notConfigured(),
  listAccounts: async () => notConfigured(),
  listTransactions: async () => notConfigured(),
  revoke: async () => notConfigured(),
};

const ADAPTERS = { manual: manualAdapter };

/** Registry lookup. Unknown partner names throw a 400. */
export function getAdapter(partnerName) {
  const adapter = ADAPTERS[String(partnerName || 'manual').toLowerCase()];
  if (!adapter) {
    const err = new Error(`Unknown PSD2 partner: ${partnerName}`);
    err.status = 400;
    err.detail = err.message;
    throw err;
  }
  return adapter;
}

export const listPartners = () => Object.keys(ADAPTERS);