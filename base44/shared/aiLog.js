// Safe AI logging: the full prompt and output of every AI run are kept on AiAgentRun so a decision can be
// reconstructed, with direct identifiers masked and a retention date. purgeAiRunContent blanks them afterwards.

const MAX_CHARS = 200000;

/** Masks e-mail addresses, IBANs, card/account/ID-like digit runs and phone numbers. Not a substitute for access control. */
export function redactForLog(value) {
  let s = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  s = s
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g, '[iban]')
    .replace(/\+?\d[\d\s().-]{8,}\d/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '[number]' : m));
  return s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}…[truncated]` : s;
}

/** Retention end date (YYYY-MM-DD) from the tenant's audit retention period, default 5 years. */
export function retainUntil(tenant, from = new Date()) {
  const years = Number(tenant?.audit_retention_years) || 5;
  const d = new Date(from);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/** Fields to spread into AiAgentRun.create. */
export function aiLogFields({ prompt, output, tenant }) {
  return { prompt_redacted: redactForLog(prompt), output_full: redactForLog(output), retain_until: retainUntil(tenant) };
}
