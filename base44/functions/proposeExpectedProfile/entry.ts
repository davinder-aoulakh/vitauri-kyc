// proposeExpectedProfile — create a new 'proposed' ExpectedProfile version for a client.
// Auth: user with createRunCase. Tenant scope comes from the authenticated user only.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { authenticate, errorResponse, httpError, loadTenant, asList } from '../../shared/tmAuth.js';
import { parseBehavior, buildProfileFields } from '../../shared/tmProfileMap.js';

const CREATE_RUN_CASE = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin']; // createRunCase
const SOURCES = ['kyc_case', 'kyc_txn_analysis', 'manual', 'tm_review'];
const OVERRIDABLE = [
  'currency', 'inbound_max_month', 'inbound_max_count_month', 'outbound_max_month', 'outbound_foreign_max_month',
  'allowed_countries', 'cash_max_month', 'expected_categories', 'notes',
];

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: CREATE_RUN_CASE, allowApiKey: false });
    const tenantId = auth.tenantId;
    const E = base44.asServiceRole.entities;

    if (!body.client_id) throw httpError(400, 'client_id is required');
    const source = body.source || 'manual';
    if (!SOURCES.includes(source)) throw httpError(400, 'Invalid source');

    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_core')) throw httpError(403, 'Feature tm_core is not enabled');

    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: body.client_id }))[0];
    if (!client) throw httpError(404, 'Client not found');

    let kycCase = null;
    if (body.case_id) {
      kycCase = asList(await E.KycCase.filter({ tenant_id: tenantId, id: body.case_id }))[0];
      if (!kycCase || kycCase.client_id !== client.id) throw httpError(404, 'Case not found');
    }

    // Optional transaction analysis (preferred when present).
    let analysis = null;
    let observedCountries = [];
    const analysisId = source === 'kyc_txn_analysis' ? body.source_id : (kycCase?.kyc_txn_analysis_id || null);
    if (analysisId) {
      analysis = asList(await E.KycTransactionAnalysis.filter({ tenant_id: tenantId, id: analysisId }))[0] || null;
      if (analysis && analysis.client_id !== client.id) analysis = null;
      if (analysis?.statement_upload_ids?.length) {
        const txns = asList(await E.Transaction.filter(
          { tenant_id: tenantId, client_id: client.id, source_file_id: { $in: analysis.statement_upload_ids } }, undefined, 1000,
        ));
        observedCountries = [...new Set(txns.map((t) => t.counterparty_country).filter(Boolean))];
      }
    }

    const behavior = parseBehavior(kycCase?.expected_transaction_behavior);
    const { fields, notes } = buildProfileFields({
      behavior, analysis, observedCountries, reportingCurrency: tenant.tm_reporting_currency,
    });

    // Caller overrides (whitelisted fields only).
    const overrides = {};
    for (const k of OVERRIDABLE) if (body.overrides && body.overrides[k] !== undefined) overrides[k] = body.overrides[k];

    const existing = asList(await E.ExpectedProfile.filter({ tenant_id: tenantId, client_id: client.id }, '-version', 1));
    const version = (existing[0]?.version || 0) + 1;

    const extraNotes = [overrides.notes, ...notes].filter(Boolean).join('\n');
    const record = {
      ...fields,
      ...overrides,
      tenant_id: tenantId,
      client_id: client.id,
      version,
      status: 'proposed',
      source,
      source_id: body.source_id || analysis?.id || kycCase?.id || undefined,
      case_id: kycCase?.id || undefined,
      notes: extraNotes || undefined,
      proposed_by_user_id: auth.actorUserId,
      proposed_by_name: auth.actorName,
    };
    Object.keys(record).forEach((k) => record[k] === undefined && delete record[k]);

    const created = await E.ExpectedProfile.create(record);

    if (kycCase) await E.KycCase.update(kycCase.id, { profile_proposal_id: created.id });

    await writeAudit(base44, auth, {
      tenantId, clientId: client.id, eventType: 'expected_profile_proposed',
      before: {}, after: { profile_id: created.id, version, status: 'proposed', source },
      notes: `Expected profile v${version} proposed${kycCase ? ` for case ${kycCase.id}` : ''}.${notes.length ? ' ' + notes.join(' ') : ''}`,
    });

    return Response.json({ ok: true, profile: created });
  } catch (error) {
    console.error('proposeExpectedProfile error:', error?.message);
    return errorResponse(error);
  }
}