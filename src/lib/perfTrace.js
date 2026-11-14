import { base44, recentEntityCalls } from '@/api/base44Client';

// Measures opening a case workspace: "Create Client & Open KYC Case" end to end, or opening an existing case.
// One trace at a time; finished when step 1 has its data (or abandoned after 2 minutes).
const SLOW_MS = 8000;
const MAX_AGE_MS = 120000;

let trace = null;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function startCaseOpenTrace(meta = {}) {
  trace = { start: now(), wallStart: Date.now(), marks: {}, meta: { ...meta } };
}

export const hasCaseOpenTrace = () => !!trace && now() - trace.start <= MAX_AGE_MS;

export function markCaseOpen(name, extra) {
  if (!trace) return;
  if (now() - trace.start > MAX_AGE_MS) { trace = null; return; }
  if (trace.marks[name] == null) trace.marks[name] = Math.round(now() - trace.start);
  if (extra) Object.assign(trace.meta, extra);
}

// Called when step 1 has loaded its data. Logs the breakdown and records slow runs.
//   step1_ready_ms = step 1 usable (set earlier for a new or cached case, where the screen does not wait for the read);
//   step1_data_ms  = the outreach read finished.
export function finishCaseOpenTrace(caseId) {
  if (!trace) return;
  markCaseOpen('step1_ready_ms');
  markCaseOpen('step1_data_ms');
  const t = trace;
  trace = null;
  if (!t.marks.step1_data_ms) return;
  // Timing only (entity.method, ms, retries): which calls were slow or waited in the queue. No data.
  let calls = [];
  try { calls = recentEntityCalls(t.wallStart - 50); } catch { /* measurement must never break the page */ }
  const brief = (c) => ({ call: c.label, queued_ms: c.queued_ms, net_ms: c.net_ms, retries: c.retries, ahead: c.ahead });
  const step1 = calls.find((c) => c.label === 'OutreachRequest.filter');
  const slowest = [...calls].sort((a, b) => b.total_ms - a.total_ms).slice(0, 3).map(brief);
  const breakdown = { ...t.marks, ...t.meta, calls: calls.length, step1_read: step1 ? brief(step1) : null, slowest };
  console.info('[timing] case open', breakdown);
  const worst = Math.max(t.marks.step1_ready_ms || 0, t.marks.step1_data_ms || 0);
  if (worst <= SLOW_MS || !t.meta.tenant_id || !caseId) return;
  const s = (ms) => (ms / 1000).toFixed(1);
  base44.entities.AuditEvent.create({
    tenant_id: t.meta.tenant_id,
    case_id: caseId,
    client_id: t.meta.client_id,
    actor_user_id: t.meta.user_id,
    actor_name: t.meta.user_name,
    actor_type: 'System',
    event_type: 'case_open_slow',
    notes: `Opening the ${t.meta.kind === 'existing' ? '' : 'new '}case: usable after ${s(t.marks.step1_ready_ms)} s, outreach data after ${s(t.marks.step1_data_ms)} s`,
    after_state: breakdown,
  }).catch(() => {});
}
