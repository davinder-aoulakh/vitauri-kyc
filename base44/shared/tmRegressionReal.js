// Real-session regression fixtures (kind 'real_session'). They replay signed webhooks for a REAL, completed Didit session
// on the Demo tenant, configured by Vitauri Ops in tm_settings.regression_session_id / regression_outreach_ref.
// The referenced outreach item is saved before the replay and always restored afterwards.
import { asList } from './tmAuth.js';

const asObj = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v) || {}; } catch { return {}; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));

async function poll(check, tries = 6, ms = 3000) {
  for (let i = 0; i < tries; i++) {
    await sleep(ms);
    const r = await check();
    if (r.done) return r;
  }
  return check();
}

/** post(tenant, body) -> http status. Returns { skipped, http_status, error, snapshot }. */
export async function runRealFixture({ E, tenant, fixture, actorName, tag, post }) {
  const s = asObj(tenant.tm_settings);
  const sessionId = String(s.regression_session_id || '').trim();
  const ref = s.regression_outreach_ref || {};
  if (!sessionId || !ref.outreach_id || !ref.item_id) {
    return { skipped: true, http_status: null, error: null, snapshot: { real_result: 'skipped', detail: 'Not configured: set the regression session id and outreach item in TM settings (Vitauri Ops).' } };
  }
  const tid = tenant.id;
  const load = async () => asList(await E.OutreachRequest.filter({ tenant_id: tid, id: ref.outreach_id }))[0];
  const itemOf = (o) => (o?.items || []).find((i) => i.item_id === ref.item_id);
  const outreach = await load();
  const original = itemOf(outreach);
  if (!original) return { skipped: false, http_status: null, error: 'The configured outreach item was not found on this tenant.', snapshot: { real_result: 'fail', detail: 'outreach item not found' } };

  const before = clone(original);
  const writeItem = async (item) => {
    const fresh = await load();
    await E.OutreachRequest.update(fresh.id, { items: (fresh.items || []).map((i) => (i.item_id === ref.item_id ? item : i)) });
  };
  const isStatusEvent = fixture.webhook_type === 'status.updated';
  const result = { skipped: false, http_status: null, error: null, snapshot: null };
  const start = Date.now();
  let restoreError = null;
  try {
    if (isStatusEvent) await writeItem({ ...before, idv_status: 'Pending' });
    const body = {
      webhook_type: fixture.webhook_type, session_id: sessionId, status: 'Approved',
      event_id: `reg-${tag}-real-${Math.random().toString(36).slice(2, 8)}`, vendor_data: outreach.client_id,
      metadata: { tenant_id: tid, outreach_id: ref.outreach_id, item_id: ref.item_id },
    };
    result.http_status = await post(tenant, body);
    const state = await poll(async () => {
      const o = await load();
      const events = asList(await E.AuditEvent.filter({ tenant_id: tid }, '-created_date', 50))
        .filter((e) => new Date(e.created_date).getTime() >= start - 2000 && String(e.notes || '').includes(sessionId));
      const idv = itemOf(o)?.idv_status ?? null;
      const itemUpdated = new Date(o?.updated_date || 0).getTime() >= start;
      const done = isStatusEvent ? (idv && idv !== 'Pending' && events.length > 0) : (events.length > 0 || itemUpdated);
      return { done: !!done, idv, events: events.length, itemUpdated };
    });
    const pass = state.done;
    result.snapshot = isStatusEvent
      ? { real_result: pass ? 'pass' : 'fail', idv_status_after: state.idv, webhook_audit_found: state.events > 0 }
      : { real_result: pass ? 'pass' : 'fail', webhook_audit_found: state.events > 0, outreach_updated_after_replay: state.itemUpdated };
  } catch (e) {
    result.error = String(e?.message || e).slice(0, 300);
    result.snapshot = { real_result: 'fail', detail: 'replay error' };
  } finally {
    try { await writeItem(before); } catch (e) { restoreError = String(e?.message || e).slice(0, 200); }
    await E.AuditEvent.create({
      tenant_id: tid, client_id: outreach.client_id, actor_type: 'User', actor_name: actorName, event_type: 'tm_regression_real_session',
      before_state: { outreach_id: ref.outreach_id, item_id: ref.item_id, idv_status: before.idv_status ?? null },
      after_state: { fixture: fixture.name, restored: !restoreError },
      notes: `Regression ${tag}: "${fixture.name}" replayed for the configured real session; outreach item ${restoreError ? 'NOT restored: ' + restoreError : 'restored'}.`,
    }).catch(() => {});
  }
  if (restoreError) { result.error = `${result.error || ''} RESTORE FAILED: ${restoreError}`.trim(); result.snapshot = { ...result.snapshot, real_result: 'fail' }; }
  return result;
}