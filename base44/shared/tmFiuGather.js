// Loads the tenant-scoped evidence for an FIU report. Every query filters by tenant_id.
import { asList, httpError } from './tmAuth.js';
import { distinct } from './tmFiuMap.js';

const byIds = (E, entity, tenantId, ids, limit) => (ids.length ? E[entity].filter({ tenant_id: tenantId, id: { $in: ids } }, undefined, limit).then(asList) : Promise.resolve([]));

export async function gatherReportData(ctx, tmCase) {
  const { E, tenantId } = ctx;
  const clientId = tmCase.primary_client_id;
  const alerts = asList(await E.TmAlert.filter({ tenant_id: tenantId, id: { $in: tmCase.alert_ids || [] } }, undefined, 100));
  const txnIds = distinct(alerts.flatMap((a) => a.transaction_ids || [])).slice(0, 200);
  const scope = { tenant_id: tenantId, client_id: clientId };

  const [scenarios, client, txns, accounts, approved, links] = await Promise.all([
    byIds(E, 'TmScenario', tenantId, distinct(alerts.map((a) => a.scenario_id)), 100),
    E.Client.filter({ tenant_id: tenantId, id: clientId }).then((r) => asList(r)[0]),
    byIds(E, 'Transaction', tenantId, txnIds, 200),
    E.BankAccount.filter(scope, undefined, 50).then(asList),
    E.ExpectedProfile.filter({ ...scope, status: 'approved' }, '-version', 1).then((r) => asList(r)[0] || null),
    E.ClientRelatedPartyLink.filter(scope, undefined, 100).then(asList),
  ]);
  if (!client) throw httpError(404, 'Client not found');

  const [counterparties, partyRecords, docs, statements, analyses, outreach] = await Promise.all([
    byIds(E, 'Counterparty', tenantId, distinct(txns.map((t) => t.counterparty_id)), 100),
    byIds(E, 'RelatedParty', tenantId, distinct(links.map((l) => l.related_party_id)), 100),
    E.Document.filter(scope, '-created_date', 50).then((r) => asList(r).filter((d) => !d.is_deleted)),
    E.StatementUpload.filter({ ...scope, status: 'committed' }, '-created_date', 20).then(asList),
    E.KycTransactionAnalysis.filter({ ...scope, status: 'signed_off' }, '-created_date', 5).then(asList),
    E.OutreachRequest.filter(scope, '-created_date', 20).then(asList),
  ]);
  const parties = links.map((l) => {
    const p = partyRecords.find((r) => r.id === l.related_party_id);
    return p ? { ...p, role: l.role || p.role_in_relationship, ownership_percentage: l.ownership_percentage ?? p.ownership_percentage } : null;
  }).filter(Boolean);

  return { alerts, scenarios, client, txns, accounts, approved, counterparties, parties, docs, statements, analyses, outreach };
}