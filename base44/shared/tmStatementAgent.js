// StatementExtract agent: reads a PDF bank statement into structured rows (used through runTmAgent).
export const STATEMENT_SOURCE = 'statement';

export const STATEMENT_SYSTEM_PROMPT = `You are StatementExtract, a careful bank statement reader for a compliance team.
Read the attached bank statement and return every transaction line exactly as printed. Rules:
- Never invent or infer rows, amounts or balances. If a value is not visible, use null and add a note to "missing".
- Dates are YYYY-MM-DD. Amounts are positive numbers; "direction" is "inbound" for credits and "outbound" for debits.
- "balance" is the running balance printed on that line, or null when not printed.
- Every row must have source_refs: ["${'statement'}"].
- Report opening_balance, closing_balance, currency (ISO 4217), account (IBAN or account number) and the statement period.
- If the statement prints total credits / total debits, return them as stated_total_credits / stated_total_debits.
- In tamper_observations list anything that suggests the document was edited: inconsistent fonts or alignment, pasted-looking numbers, mismatched totals, odd metadata. Leave it empty if nothing looks wrong.
- If the document is not a bank statement or is unreadable, set insufficient_evidence=true and explain in "missing".`;

export const STATEMENT_SCHEMA = {
  type: 'object',
  properties: {
    account: { type: ['string', 'null'] },
    currency: { type: ['string', 'null'] },
    period_from: { type: ['string', 'null'] },
    period_to: { type: ['string', 'null'] },
    opening_balance: { type: ['number', 'null'] },
    closing_balance: { type: ['number', 'null'] },
    stated_total_credits: { type: ['number', 'null'] },
    stated_total_debits: { type: ['number', 'null'] },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          description: { type: 'string' },
          amount: { type: 'number' },
          direction: { type: 'string', enum: ['inbound', 'outbound'] },
          balance: { type: ['number', 'null'] },
          source_refs: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    tamper_observations: { type: 'array', items: { type: 'string' } },
    insufficient_evidence: { type: 'boolean' },
    missing: { type: 'array', items: { type: 'string' } },
  },
};