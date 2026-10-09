// Rules-table categorisation for Transaction Monitoring.
import { normaliseDescription } from './tmCanonical.js';

export const CATEGORIES = [
  'salary', 'rent', 'cash_deposit', 'cash_withdrawal', 'gambling', 'crypto', 'remittance',
  'transfer_foreign_private', 'transfer_domestic', 'card_payment', 'fees', 'own_transfer', 'other',
];

// Ordered: first match wins. Keywords are matched against the normalised (upper-case, alnum) description.
const RULES = [
  ['gambling', ['CASINO', 'BETTING', 'POKER', 'LOTTERY', 'BET365', 'SPORTSBOOK', 'GAMBLING']],
  ['crypto', ['BINANCE', 'COINBASE', 'KRAKEN', 'BITCOIN', 'CRYPTO', 'BITSTAMP', 'BTC', 'ETHEREUM']],
  ['remittance', ['WESTERN UNION', 'MONEYGRAM', 'REMITLY', 'WORLDREMIT', 'REMITTANCE', 'RIA MONEY', 'XOOM']],
  ['cash_deposit', ['CASH DEPOSIT', 'CASH DEP', 'CASH IN', 'STORTING CONTANT', 'CASH PAYMENT IN']],
  ['cash_withdrawal', ['ATM', 'CASH WITHDRAWAL', 'CASH OUT', 'GELDAUTOMAAT', 'OPNAME']],
  ['salary', ['SALARY', 'SALARIS', 'PAYROLL', 'WAGES', 'LOON']],
  ['rent', ['RENT', 'HUUR', 'LEASE', 'LANDLORD']],
  ['fees', ['FEE', 'COMMISSION', 'INTEREST CHARGE', 'BANK CHARGE', 'KOSTEN', 'SERVICE CHARGE']],
  ['card_payment', ['POS ', 'CARD PAYMENT', 'DEBIT CARD', 'CREDIT CARD', 'VISA', 'MASTERCARD', 'BETAALPAS', 'CARD PURCHASE']],
  ['transfer_foreign_private', ['SWIFT', 'INTERNATIONAL TRANSFER', 'FOREIGN TRANSFER', 'WIRE TRANSFER INTL']],
  ['transfer_domestic', ['TRANSFER', 'OVERBOEKING', 'IBAN', 'SEPA', 'ACH', 'PAYMENT TO', 'PAYMENT FROM']],
];

export function categoriseByRules(descriptionRaw) {
  const d = ` ${normaliseDescription(descriptionRaw)} `;
  if (!d.trim()) return null;
  for (const [category, keywords] of RULES) {
    for (const k of keywords) {
      const kw = normaliseDescription(k);
      if (kw && d.includes(` ${kw} `)) return category;
    }
  }
  return null;
}

export const CATEGORY_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'number' },
          category: { type: 'string', enum: CATEGORIES },
          confidence: { type: 'number' },
          counterparty_name: { type: 'string' },
          source_refs: { type: 'array', items: { type: 'string' } },
        },
        required: ['index', 'category', 'source_refs'],
      },
    },
    insufficient_evidence: { type: 'boolean' },
    missing: { type: 'array', items: { type: 'string' } },
  },
  required: ['items', 'insufficient_evidence', 'missing'],
};

export const CATEGORY_SYSTEM_PROMPT =
  `You classify bank transaction descriptions into exactly one category from: ${CATEGORIES.join(', ')}. ` +
  'For each numbered description return {index, category, confidence (0-1), counterparty_name (the other party if clearly stated, else empty), source_refs: ["desc:<index>"]}. ' +
  'Use "other" when unsure. Never invent a counterparty.';