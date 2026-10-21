/**
 * Recovers Didit IDV decisions that were dropped (webhook failed before the credentials fix).
 * Vitauri Ops or Tenant Admin. Input { tenant_id, lookback_days (default 60, max 180), since (optional), dry_run }.
 * Calls the existing getDiditSessionResult for each pending item; max 50 per run, 300 ms apart.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.49';

const MAX_ITEMS = 50;
const PAUSE_MS = 300;
const DEFAULT_LOOKBACK_DAYS = 60;
const MAX_LOOKBACK_DAYS = 180;
const PAGE_SIZE = 200;
const MAX_SCAN = 2000;
const MAX_LIST = 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shortMsg = (e) => String(e?.message || e || 'error').slice(0, 120);

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const role = user.app_role || user.data?.app_role;
    const isOps = role === 'Vitauri Ops';
    const isTenantAdmin = role === 'Tenant Admin';
    if (!isOps && !isTenantAdmin) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const { tenant_id, since, dry_run, lookback_days } = await req.json();
    if (!tenant_id) return Response.json({ error: 'tenant_id is required' }, { status: 400 });
    const lb = Number(lookback_days);
    const lookback = Math.min(Number.isFinite(lb) && lb > 0 ? lb : DEFAULT_LOOKBACK_DAYS, MAX_LOOKBACK_DAYS);
    let sinceMs = Date.now() - lookback * 86400000;
    if (since) {
      const legacy = Date.parse(since);
      if (Number.isNaN(legacy)) return Response.json({ error: 'since must be an ISO date-time' }, { status: 400 });
      sinceMs = Math.min(sinceMs, legacy);
    }
    const tenantId = isOps ? tenant_id : (user.tenant_id || user.data?.tenant_id);
    if (!isOps && tenant_id !== tenantId) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const E = base44.asServiceRole.entities;
    const query = { tenant_id: tenantId, created_date: { $gte: new Date(sinceMs).toISOString() } };

    const all = [];
    const seen = new Set();
    let scanned = 0; let scanTruncated = false;
    while (scanned < MAX_SCAN) {
      const page = await E.OutreachRequest.filter(query, '-created_date', PAGE_SIZE, scanned);
      const rows = page?.items || page || [];
      for (const r of rows) {
        for (const it of r.items || []) {
          if (it.didit_session_id && (!it.idv_status || it.idv_status === 'Pending') && !seen.has(it.didit_session_id)) {
            seen.add(it.didit_session_id);
            all.push({
              outreach_id: r.id, item_id: it.item_id, client_id: r.client_id || null,
              session_id: it.didit_session_id, created_date: r.created_date, last_updated: r.updated_date,
            });
          }
        }
      }
      scanned += rows.length;
      if (rows.length < PAGE_SIZE) break;
      if (scanned >= MAX_SCAN) scanTruncated = true;
    }
    const candidates = all.slice(0, MAX_ITEMS);

    if (dry_run) {
      return Response.json({
        dry_run: true, scanned, scan_truncated: scanTruncated, candidates: all.length, processed: 0,
        remaining: all.length, capped_at: MAX_ITEMS, lookback_days: lookback,
        updated: 0, still_pending: 0, errors: [], items: all.slice(0, MAX_LIST),
      });
    }

    let updated = 0; let stillPending = 0; const errors = [];
    const items = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (i > 0) await sleep(PAUSE_MS);
      try {
        const res = await base44.functions.invoke('getDiditSessionResult', {
          session_id: c.session_id, outreach_id: c.outreach_id, item_id: c.item_id, tenant_id: tenantId,
        });
        const d = res?.data ?? res;
        if (d?.error) { errors.push(shortMsg(d.error)); items.push({ ...c, outcome: 'error' }); }
        else if (d?.idv_status && d.idv_status !== 'Pending') { updated++; items.push({ ...c, outcome: d.idv_status }); }
        else { stillPending++; items.push({ ...c, outcome: 'Pending' }); }
      } catch (e) {
        errors.push(shortMsg(e)); items.push({ ...c, outcome: 'error' });
      }
    }

    const counts = { scanned, scan_truncated: scanTruncated, lookback_days: lookback, candidates: all.length, processed: candidates.length, remaining: all.length - candidates.length, updated, still_pending: stillPending, errors: errors.length };
    await E.AuditEvent.create({
      tenant_id: tenantId, actor_user_id: user.id, actor_name: user.full_name, actor_type: 'User',
      event_type: 'didit_decisions_catch_up',
      notes: `Didit decisions catch-up since ${new Date(sinceMs).toISOString()}: ${JSON.stringify(counts)}.`,
    }).catch(() => {});

    return Response.json({ dry_run: false, ...counts, errors, items });
  } catch (error) {
    return Response.json({ error: shortMsg(error) }, { status: 500 });
  }
}