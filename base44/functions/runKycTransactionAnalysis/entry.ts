// runKycTransactionAnalysis — point-in-time analysis of committed statement transactions for a KYC case.
// Auth: user with createRunCase. Tenant scope comes from the authenticated user only.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { isTmEnabled } from '../../shared/tmGuards.js';
import { writeAudit } from '../../shared/tmAudit.js';
import { authenticate, errorResponse, httpError, loadTenant, asList, invokeNext } from '../../shared/tmAuth.js';
import { runTmAgent } from '../../shared/tmAi.js';

const CREATE_RUN_CASE = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin', 'Tenant Admin']; // createRunCase
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n: number) => Math.round(n * 100) / 100;

const SCHEMA = {
  type: 'object',
  properties: {
    conclusion: { type: 'string', description: 'Assessment of the source of funds based on the statements' },
    consistency_with_declared_occupation: { type: 'string', enum: ['consistent', 'partly', 'inconsistent', 'unknown'] },
    risk_indicators: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          label: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          source_refs: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    proposed_profile: {
      type: 'object',
      properties: {
        inbound_max_month: { type: 'number' },
        inbound_max_count_month: { type: 'number' },
        outbound_foreign_max_month: { type: 'number' },
        allowed_countries: { type: 'array', items: { type: 'string' } },
        cash_max_month: { type: 'number' },
      },
    },
    insufficient_evidence: { type: 'boolean' },
    missing: { type: 'array', items: { type: 'string' } },
  },
  required: ['conclusion', 'consistency_with_declared_occupation', 'risk_indicators', 'proposed_profile', 'insufficient_evidence', 'missing'],
};

const SYSTEM_PROMPT = `You are a senior KYC analyst. Assess the client's bank statement activity for the period against their declared purpose, nature of relationship and source of funds. ` +
  `Judge consistency with the declared occupation, flag risk indicators (each citing source_refs from the valid list) and propose conservative monthly expected-profile limits ` +
  `(about 1.3x observed averages unless the evidence says otherwise). Use only the supplied aggregates and evidence. If evidence is thin, set insufficient_evidence=true and list what is missing.`;

function caseText(raw?: string) {
  if (!raw) return '';
  try {
    const p = JSON.parse(raw);
    return [p.narrative, ...(p.sof?.sources || []), p.sof?.explanation].filter(Boolean).join('\n');
  } catch { return raw; }
}

export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: CREATE_RUN_CASE, allowApiKey: false });
    const tenantId = auth.tenantId;
    const E = base44.asServiceRole.entities;

    const uploadIds: string[] = Array.isArray(body.statement_upload_ids) ? body.statement_upload_ids : [];
    if (!body.case_id) throw httpError(400, 'case_id is required');
    if (!uploadIds.length) throw httpError(400, 'Select at least one statement');
    if (!DATE.test(body.period_from || '') || !DATE.test(body.period_to || '') || body.period_from > body.period_to) {
      throw httpError(400, 'A valid period (period_from <= period_to) is required');
    }
    const from = body.period_from, to = body.period_to;

    const tenant = await loadTenant(base44, tenantId);
    if (!isTmEnabled(tenant, 'tm_kyc_analysis')) throw httpError(403, 'Feature tm_kyc_analysis is not enabled');

    const kycCase = asList(await E.KycCase.filter({ tenant_id: tenantId, id: body.case_id }))[0];
    if (!kycCase) throw httpError(404, 'Case not found');
    const clientId = kycCase.client_id;
    const client = asList(await E.Client.filter({ tenant_id: tenantId, id: clientId }))[0];
    if (!client) throw httpError(404, 'Client not found');

    const uploads = asList(await E.StatementUpload.filter({ tenant_id: tenantId, client_id: clientId, id: { $in: uploadIds } }));
    if (uploads.length !== new Set(uploadIds).size) throw httpError(404, 'One or more statements were not found for this client');
    if (uploads.some((u: any) => u.status !== 'committed')) throw httpError(400, 'Only committed statements can be analysed');

    const all = asList(await E.Transaction.filter(
      { tenant_id: tenantId, client_id: clientId, source_file_id: { $in: uploadIds } }, undefined, 5000,
    ));
    const txns = all.filter((t: any) => {
      const d = String(t.coverage_date || t.executed_at || '').slice(0, 10);
      const life = t.lifecycle || 'booked';
      return d >= from && d <= to && !t.own_transfer && (life === 'booked' || life === 'corrected');
    });
    if (!txns.length) throw httpError(400, 'No committed transactions in the selected period');

    // ── Aggregates ──
    const currency = tenant.tm_reporting_currency || uploads[0]?.currency || 'USD';
    const days = (new Date(to).getTime() - new Date(from).getTime()) / 86400000 + 1;
    const months = Math.max(1, days / 30.4375);
    const amt = (t: any) => Math.abs(Number(t.fx?.amount_reporting ?? t.amount ?? 0));
    const income: Record<string, number> = {}, spend: Record<string, number> = {};
    const countries = new Set<string>();
    let inTotal = 0, outTotal = 0, inCount = 0, cashTotal = 0, foreignOut = 0;
    for (const t of txns) {
      const a = amt(t);
      const cat = t.category || 'uncategorised';
      if (t.counterparty_country) countries.add(t.counterparty_country);
      if (/cash/i.test(cat)) cashTotal += a;
      if (t.direction === 'inbound') { inTotal += a; inCount++; income[cat] = round2((income[cat] || 0) + a); }
      else { outTotal += a; spend[cat] = round2((spend[cat] || 0) + a); if (t.counterparty_country && t.counterparty_country !== client.country_of_residence) foreignOut += a; }
    }
    const volume = inTotal + outTotal;
    const gapCount = uploads.reduce((s: number, u: any) => s + (u.gaps?.length || 0), 0);
    const tamper = uploads.flatMap((u: any) => u.tamper_signals || []);
    const reconciles = uploads.every((u: any) => u.reconciles !== false);
    const integritySummary = `${uploads.length} statement(s); ${reconciles ? 'all reconcile' : 'reconciliation differences found'}; ${gapCount} gap(s); ${tamper.length} tamper signal(s).`;

    const aggregates = {
      period: { from, to, months: round2(months) }, currency, txn_count: txns.length,
      avg_inbound_month: round2(inTotal / months), avg_outbound_month: round2(outTotal / months),
      avg_inbound_count_month: Math.ceil(inCount / months),
      avg_outbound_foreign_month: round2(foreignOut / months),
      cash_share: volume ? round2(cashTotal / volume) : 0, avg_cash_month: round2(cashTotal / months),
      countries: [...countries], income_by_category: income, spend_by_category: spend, integrity: integritySummary,
    };

    // ── AI ──
    const topTxnIds = [...txns].sort((a: any, b: any) => amt(b) - amt(a)).slice(0, 100).map((t: any) => t.id);
    const caseRefs: string[] = [];
    const docText: string[] = [];
    if (kycCase.purpose_nature_text) { caseRefs.push('case:purpose_nature_text'); docText.push(`[case:purpose_nature_text] ${kycCase.purpose_nature_text}`); }
    const sofText = caseText(kycCase.sof_narrative);
    if (sofText) { caseRefs.push('case:sof_narrative'); docText.push(`[case:sof_narrative] ${sofText}`); }

    const { output, ai_run_id } = await runTmAgent(base44, {
      tenantId, agent: 'KycTxnAnalysis', caseId: kycCase.id, schema: SCHEMA, systemPrompt: SYSTEM_PROMPT,
      input: {
        client: { type: client.client_type, occupation_context: 'see case text', country_of_residence: client.country_of_residence },
        aggregates, note: 'Transaction ids listed in sources are the 100 largest in the period.',
        document_text: docText,
      },
      sources: [...topTxnIds, ...uploadIds, ...caseRefs],
    });

    const limits: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(output.proposed_profile || {})) if (v !== null && v !== undefined) limits[k] = v;

    const created = await E.KycTransactionAnalysis.create({
      tenant_id: tenantId, client_id: clientId, case_id: kycCase.id,
      period_from: from, period_to: to, statement_upload_ids: uploadIds,
      income_by_category: income, spend_by_category: spend,
      avg_inbound_month: aggregates.avg_inbound_month, avg_outbound_month: aggregates.avg_outbound_month,
      avg_inbound_count_month: aggregates.avg_inbound_count_month, txn_count: txns.length, currency,
      cash_share: aggregates.cash_share, countries: aggregates.countries,
      integrity_summary: integritySummary, integrity: { reconciles, gap_count: gapCount, tamper_signals: tamper },
      risk_indicators: output.risk_indicators || [], ai_conclusion: output.conclusion || '',
      consistency_with_occupation: output.consistency_with_declared_occupation || 'unknown',
      insufficient_evidence: output.insufficient_evidence, missing: output.missing,
      proposed_profile_limits: limits, ai_run_id, status: 'draft',
      run_by_user_id: auth.actorUserId, run_by_name: auth.actorName,
    });

    const previousId = kycCase.kyc_txn_analysis_id || null;
    await E.KycCase.update(kycCase.id, { kyc_txn_analysis_id: created.id });

    await writeAudit(base44, auth, {
      tenantId, clientId, eventType: 'kyc_txn_analysis_run',
      before: { kyc_txn_analysis_id: previousId }, after: { kyc_txn_analysis_id: created.id, status: 'draft', txn_count: txns.length },
      notes: `KYC transaction analysis run for case ${kycCase.id}, ${from} to ${to}, ${uploadIds.length} statement(s).`,
    });

    // Propose an expected profile; a failure here must not lose the analysis.
    let proposalError: string | null = null;
    let profile: any = null;
    try {
      const res: any = await invokeNext(base44, auth, 'proposeExpectedProfile', {
        client_id: clientId, case_id: kycCase.id, source: 'kyc_txn_analysis', source_id: created.id, overrides: limits,
      });
      profile = res?.profile || null;
      if (profile) {
        await E.KycTransactionAnalysis.update(created.id, { proposed_profile_id: profile.id, proposed_profile_version: profile.version });
        created.proposed_profile_id = profile.id;
        created.proposed_profile_version = profile.version;
      }
    } catch (e: any) {
      proposalError = e?.response?.data?.error || e?.message || 'Profile proposal failed';
      console.warn('proposeExpectedProfile failed:', proposalError);
    }

    return Response.json({ ok: true, analysis: created, profile, proposal_error: proposalError });
  } catch (error: any) {
    console.error('runKycTransactionAnalysis error:', error?.message);
    return errorResponse(error);
  }
}