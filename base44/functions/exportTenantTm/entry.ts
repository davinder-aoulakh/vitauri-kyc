// exportTenantTm — builds a ZIP with one JSON file per TM entity of the caller's tenant, plus goaml_files.json
// (URLs of generated goAML files). The ZIP is stored privately and a time-limited download URL is returned.
// Auth: signed-in user with exportData (Manager, Director, Compliance Officer, Compliance Admin, Tenant Admin); tenant from the user.
// Requires tm_core. Excluded on purpose: TenantApiKey (secrets) and non-TM data (clients, audit events).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { zipSync, strToU8 } from 'npm:fflate@0.8.2';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';
import { writeAudit } from '../../shared/tmAudit.js';

const EXPORT_ROLES = ['Manager', 'Director', 'Compliance Officer', 'Compliance Admin', 'Tenant Admin']; // exportData
const ENTITIES = [
  'Transaction', 'TransactionIngestBatch', 'StatementUpload', 'BankAccount', 'BankConnection', 'CoverageDay', 'Counterparty',
  'ExpectedProfile', 'KycTransactionAnalysis', 'CustomerRiskScore',
  'TmRisk', 'TmScenario', 'TmRule', 'RuleBacktest', 'TmAlert', 'TmCase', 'Decision',
  'FiuProfile', 'FiuReport', 'QualitySample',
];
const CAP = 20000;

async function fetchAll(entity, tenantId) {
  const rows: any[] = [];
  let cursor;
  while (rows.length < CAP) {
    const page = await entity.filter({ tenant_id: tenantId }, { sort: 'created_date', limit: 1000, ...(cursor ? { cursor } : {}) });
    rows.push(...asList(page).filter((r) => r.tenant_id === tenantId));
    if (!page?.has_more || !page.next_cursor) return { rows, truncated: false };
    cursor = page.next_cursor;
  }
  return { rows, truncated: true };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const auth = await authenticate(base44, req, body, { roles: EXPORT_ROLES, allowApiKey: false });
    const tenantId = auth.tenantId;
    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');
    const E = base44.asServiceRole.entities;

    const files: Record<string, Uint8Array> = {};
    const counts: Record<string, number> = {};
    const truncated: string[] = [];
    let reports: any[] = [];
    for (const name of ENTITIES) {
      const { rows, truncated: cut } = await fetchAll(E[name], tenantId);
      files[`${name}.json`] = strToU8(JSON.stringify(rows, null, 2));
      counts[name] = rows.length;
      if (cut) truncated.push(name);
      if (name === 'FiuReport') reports = rows;
    }
    const goaml = reports
      .filter((r) => r.generated?.file_url || r.generated?.pdf_url)
      .map((r) => ({ report_ref: r.report_ref, version: r.version, status: r.status, generated_at: r.generated?.at, xml_url: r.generated?.file_url || null, pdf_url: r.generated?.pdf_url || null, file_hash: r.generated?.file_hash || null }));
    files['goaml_files.json'] = strToU8(JSON.stringify(goaml, null, 2));
    const exportedAt = new Date().toISOString();
    files['manifest.json'] = strToU8(JSON.stringify({ tenant_id: tenantId, exported_at: exportedAt, exported_by: auth.actorName, counts, goaml_files: goaml.length, truncated_entities: truncated, row_cap_per_entity: CAP }, null, 2));

    const bytes = zipSync(files);
    const fileName = `tm-export_${exportedAt.slice(0, 10)}.zip`;
    const up = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: new File([bytes], fileName, { type: 'application/zip' }) });
    const signed = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: up.file_uri, expires_in: 3600 });

    await writeAudit(base44, auth, {
      tenantId, eventType: 'tm_export_created', before: {},
      after: { file_name: fileName, file_uri: up.file_uri, entity_counts: counts, goaml_files: goaml.length, truncated_entities: truncated },
      notes: `${auth.actorName} exported the TM data of the tenant (${Object.values(counts).reduce((a, b) => a + b, 0)} records, ${goaml.length} goAML file URL(s)).`,
    });
    return Response.json({ ok: true, download_url: signed.signed_url, file_name: fileName, counts, goaml_files: goaml.length, truncated_entities: truncated });
  } catch (error) {
    console.error('exportTenantTm error:', error?.message);
    return errorResponse(error);
  }
}