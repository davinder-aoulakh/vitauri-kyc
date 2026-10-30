import { base44 } from '@/api/base44Client';

// Measures "Create Client & Open KYC Case" end to end. One trace at a time;
// finished when step 1 is ready (or abandoned after 2 minutes).
const SLOW_MS = 8000;
const MAX_AGE_MS = 120000;

let trace = null;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function startCaseOpenTrace(meta = {}) {
  trace = { start: now(), marks: {}, meta: { ...meta } };
}

export function markCaseOpen(name, extra) {
  if (!trace) return;
  if (now() - trace.start > MAX_AGE_MS) { trace = null; return; }
  if (trace.marks[name] == null) trace.marks[name] = Math.round(now() - trace.start);
  if (extra) Object.assign(trace.meta, extra);
}

// Called when step 1 has loaded. Logs the breakdown and records slow runs.
export function finishCaseOpenTrace(caseId) {
  if (!trace) return;
  markCaseOpen('step1_ready_ms');
  const t = trace;
  trace = null;
  const breakdown = { ...t.marks, ...t.meta };
  console.info('[timing] new client → case', breakdown);
  if ((t.marks.step1_ready_ms || 0) <= SLOW_MS || !t.meta.tenant_id || !caseId) return;
  base44.entities.AuditEvent.create({
    tenant_id: t.meta.tenant_id,
    case_id: caseId,
    client_id: t.meta.client_id,
    actor_user_id: t.meta.user_id,
    actor_name: t.meta.user_name,
    actor_type: 'System',
    event_type: 'case_open_slow',
    notes: `Opening the new case took ${(t.marks.step1_ready_ms / 1000).toFixed(1)} s`,
    after_state: breakdown,
  }).catch(() => {});
}
