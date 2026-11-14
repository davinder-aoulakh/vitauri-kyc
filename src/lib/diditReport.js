import { base44 } from '@/api/base44Client';

// Didit's own report PDF for a verification session (person or business), through the existing diditProxy action.
// Kept in memory per session for the open page, so a second look does not ask Didit again.
const cache = new Map();

/** Uint8Array of the PDF, or throws an Error with a readable message. */
export async function fetchDiditReport(sessionId, tenantId) {
  if (!sessionId) throw new Error('No Didit session for this verification.');
  if (cache.has(sessionId)) return cache.get(sessionId);
  const res = await base44.functions.invoke('diditProxy', { action: 'session_pdf', session_id: sessionId, tenant_id: tenantId });
  const d = res?.data ?? res;
  if (!d?.pdf_base64) throw new Error(/404/.test(d?.error || '') ? 'Didit has no report for this session (yet).' : (d?.error || 'Didit returned no report.'));
  const binary = atob(d.pdf_base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) throw new Error('Didit returned a file that is not a PDF.');
  cache.set(sessionId, bytes);
  return bytes;
}

/** Same, for callers that only want bytes or null (the KYC report annex). */
export const fetchDiditReportOrNull = (sessionId, tenantId) => fetchDiditReport(sessionId, tenantId).catch((e) => { console.warn('Didit report fetch failed:', e?.message); return null; });
