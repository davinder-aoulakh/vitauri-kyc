// fxRateImport — daily 16:30 UTC (scheduler, no user) or a Tenant Admin ("Import now", own tenant only).
// Downloads the ECB daily reference rates and upserts EUR-base, USD-base and XCG/ANG cross rows (source 'ECB')
// for every tenant with tm_core on. A tenant that already holds the file's date is skipped (weekends/holidays).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { asList, errorResponse, httpError } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { ECB_DAILY_URL, fetchBytes, parseEcbDailyXml, buildRows, upsertRates } from '../../shared/fxEcb.js';

const SYSTEM = { actorType: 'System', actorName: 'FX Rate Import', actorUserId: undefined };

async function importTenant(base44, tenant, file, rows, auth) {
  const E = base44.asServiceRole.entities;
  const have = asList(await E.FxRate.filter({ tenant_id: tenant.id, date: file.date, base: 'EUR', quote: 'USD', source: 'ECB' }, { limit: 1 }));
  if (have.length) return { tenant_id: tenant.id, skipped: 'no new file', date: file.date };
  const res = await upsertRates(E, tenant.id, rows);
  await writeAudit(base44, auth, {
    tenantId: tenant.id, eventType: 'fx_rates_imported', before: {},
    after: { date: file.date, source: 'ECB', rows: rows.length, ...res },
    notes: `ECB reference rates for ${file.date} imported (${rows.length} rates).`,
  });
  return { tenant_id: tenant.id, date: file.date, rows: rows.length, ...res };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    let onlyTenant = null;
    let auth = SYSTEM;
    if (user) {
      if ((user.app_role || user.data?.app_role) !== 'Tenant Admin') throw httpError(403, 'Forbidden');
      onlyTenant = user.tenant_id || user.data?.tenant_id;
      if (!onlyTenant) throw httpError(403, 'No tenant associated with this user');
      auth = { actorType: 'User', actorName: user.full_name || user.email, actorUserId: user.id };
    }
    const tenants = asList(await base44.asServiceRole.entities.Tenant.list('-created_date', 1000))
      .filter((t) => t.status !== 'Suspended' && isTmEnabled(t, 'tm_core') && (!onlyTenant || t.id === onlyTenant));
    if (onlyTenant && !tenants.length) throw httpError(403, 'Feature tm_core is not enabled');

    const xml = new TextDecoder().decode(await fetchBytes(ECB_DAILY_URL));
    const file = parseEcbDailyXml(xml);
    const rows = buildRows(file.date, file.eur);

    const results = [];
    for (const tenant of tenants) {
      try { results.push(await importTenant(base44, tenant, file, rows, auth)); } catch (e) {
        results.push({ tenant_id: tenant.id, error: String(e?.message || e).slice(0, 300) });
      }
    }
    return Response.json({ date: file.date, tenants: results.length, results });
  } catch (error) {
    console.error('fxRateImport error:', error?.message);
    return errorResponse(error);
  }
}