/**
 * AI Orchestrator — central routing layer for all Vitauri KYC AI agents.
 *
 * Responsibilities:
 * - Route by agent_type to the correct sub-agent prompt builder
 * - Load tenant-specific system prompt from AiPromptConfig (S-210 overrides)
 * - Enforce per-case daily token cap (default 50,000; configurable)
 * - Log every invocation as an AiAgentRun record (prompt_hash, model, tokens, summary)
 * - Strict tenant isolation — all DB calls include tenant_id
 * - Never mix data across tenants or cases
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── Token cost guard ───────────────────────────────────────────────────────────
const DEFAULT_DAILY_TOKEN_CAP = 50_000;

async function getDailyTokensUsed(base44, tenantId, caseId) {
  if (!caseId) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const runs = await base44.asServiceRole.entities.AiAgentRun.filter({ tenant_id: tenantId, case_id: caseId });
  return (runs || [])
    .filter(r => r.created_date && new Date(r.created_date) >= today)
    .reduce((sum, r) => sum + (r.tokens_input || 0) + (r.tokens_output || 0), 0);
}

// ── Prompt hash (simple but deterministic) ────────────────────────────────────
function hashPrompt(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// ── Default system prompts (fallback if no S-210 override) ────────────────────
const DEFAULT_SYSTEM_PROMPTS = {
  OrgChart: `You are a KYC compliance expert specialising in corporate ownership analysis. Given the client's legal name, registration number, sector and jurisdiction, identify probable beneficial owners, analyse ownership layers, and flag any complexity or opacity. Return a JSON with "nodes" (array of {id, name, type, role}) and "edges" (array of {from, to, relationship, ownership_pct}).`,

  OutreachCopilot: `You are a KYC analyst drafting professional outreach to clients. Based on the client profile and existing data gaps, produce: (1) a recommended checklist of documents and data points to request with a one-line justification per item, and (2) a draft professional outreach email. Return JSON: {checklist: [{label, item_type, justification}], email_draft: string}.`,

  ClientOutreachCopilot: `You are a helpful assistant for a financial institution's compliance process. A client has a question about the information request they have received. Answer clearly and helpfully in the client's language. Be reassuring, non-technical, and factual. Do not reveal internal compliance processes.`,

  ScreeningTriage: `You are a KYC financial crime screening analyst. You will be given Didit AML screening results for a specific individual or organisation. Provide a structured triage analysis covering: (1) Subject overview and type, (2) Summary of each hit including which lists they appear on and match/risk scores, (3) Your recommended decision per hit (False Positive / Possible Match / Confirmed Match) with justification, (4) Overall risk assessment and recommended next steps. Write professionally in markdown. Return JSON: { narrative: string, key_risks: [string] }.`,

  ClientProfile: `You are a KYC analyst drafting a regulatory-grade client profile. Using all available client data, write a professional profile narrative in markdown format. Sections: Business Overview | Ownership Structure | Geographic Footprint | Products & Services | Notable Risk Factors. Be factual, precise, regulatory-grade.`,

  IdentityVerificationSummary: `You are a KYC compliance analyst writing an internal case note. Using the verification facts provided, write ONLY your professional analyst opinion — do not list, echo, or repeat any raw data fields, scores, names, IDs, dates, or document numbers. Your output must read as a natural paragraph of compliance commentary, not a data summary. Cover: (1) whether the verification was satisfactory, (2) any genuine concerns or anomalies, (3) a clear recommendation (Accept / Flag / Escalate). If all checks passed cleanly, state that in one concise sentence. key_risks: list only real compliance risks — omit if none. Return JSON: { narrative: string, key_risks: [string] }.`,

  SoFSoW: `You are a KYC compliance analyst. Write a Source of Funds (SoF) and Source of Wealth (SoW) assessment. Structure: (1) Stated Sources, (2) Supporting Evidence, (3) Plausibility Assessment, (4) Documentation Gaps, (5) Overall Adequacy. Use FATF-aligned language. Return JSON: {narrative: string, evidence_gaps: [string], adequacy: "Adequate"|"Partial"|"Inadequate"}.`,

  IndicatorApplicability: `You are a KYC risk analyst. Given a client profile and a list of risk indicators, identify which indicators apply to this entity and briefly explain why. Return JSON: {applicable: [{indicator_id: string, indicator_name: string, reason: string}], not_applicable: [string]}.`,

  RiskNarrative: `You are a KYC risk analyst. For a given risk indicator and score, write a pyramidal narrative: (1) Conclusion (one sentence with score), (2) Evidence (2-3 sentences citing specific facts), (3) Mitigants (if any). Return JSON: {narrative: string, conclusion: string, evidence: string, mitigants: string}.`,

  WorkflowOptimisation: `You are a KYC compliance operations advisor. Analyse the case pipeline data and identify bottlenecks, overdue cases, analyst load imbalances, and risk-based prioritisation gaps. Return JSON: {bottlenecks: [{case_id, client_name, issue, recommended_action, urgency: "Critical"|"High"|"Medium"}], capacity_warnings: [string], summary: string}.`,
};

// ── Context builders per agent ─────────────────────────────────────────────────
async function buildContext(base44, agentType, payload, tenantId) {
  const { caseId, clientId, entityData, hitData, indicatorData, caseList } = payload;

  switch (agentType) {
    case 'OrgChart': {
      const client = entityData?.client || {};
      return `Client: ${client.full_name || 'Unknown'}, Type: ${client.client_type}, Registration: ${client.registration_number || 'N/A'}, Country: ${client.registered_country || client.nationality || 'N/A'}, Sector: ${client.sector || 'N/A'}, Legal form: ${client.legal_form || 'N/A'}.`;
    }

    case 'OutreachCopilot': {
      const client = entityData?.client || {};
      const gaps = entityData?.gaps || [];
      return `Client: ${client.full_name} (${client.client_type || 'Unknown type'}). Case type: ${entityData?.caseType || 'Onboarding'}. Existing data gaps: ${gaps.join(', ') || 'None identified'}. Sector: ${client.sector || 'Unknown'}.`;
    }

    case 'ClientOutreachCopilot': {
      return `Client question: "${payload.clientQuestion}". Context — what was requested: ${payload.requestContext || 'General KYC documentation request'}. Client language preference: ${payload.language || 'en'}.`;
    }

    case 'ScreeningTriage': {
      const entity = payload.entityData || {};
      const aml = payload.hitData || {};
      const hits = aml.hits || [];
      const clientType = entity.client_type || 'Unknown';
      const subjectLine = `Subject: ${entity.name || 'Unknown'} | Type: ${clientType} | Country: ${entity.country || 'Unknown'}${entity.date_of_birth ? ` | DOB: ${entity.date_of_birth}` : ''}${entity.nationality ? ` | Nationality: ${entity.nationality}` : ''}${entity.sector ? ` | Sector: ${entity.sector}` : ''}`;
      const amlLine = `AML Status: ${aml.status || 'Unknown'} | Total Hits: ${aml.total_hits ?? 0} | Ongoing Monitoring: ${aml.ongoing_monitoring ? 'Yes' : 'No'}`;
      const warnings = (aml.warnings || []).map(w => w.risk || w.code || String(w)).join(', ');
      const hitsDetail = hits.length > 0
        ? hits.map((h, i) => `Hit ${i+1}: "${h.name}" | Match: ${h.match_score ?? 'N/A'}% | Risk: ${h.risk_score ?? 'N/A'}% | Lists: ${(h.datasets || h.categories || []).join(', ') || 'Unknown'} | Status: ${h.review_status || 'Unreviewed'}`).join('\n')
        : 'No individual hits returned.';
      const customInstructions = payload.instructions || '';
      return `${subjectLine}
${amlLine}
Risk flags: ${warnings || 'None'}

Hit details:
${hitsDetail}

${customInstructions}`;
    }

    case 'ClientProfile': {
      const client = entityData?.client || {};
      const outreachResponses = entityData?.outreachSummary || '';
      return `Client name: ${client.full_name}. Type: ${client.client_type}. Sector: ${client.sector || 'N/A'}. Jurisdiction: ${client.registered_country || client.country_of_residence || 'N/A'}. Legal form: ${client.legal_form || 'N/A'}. Registration: ${client.registration_number || 'N/A'}. Outreach responses: ${outreachResponses}. OSINT: ${entityData?.osintSummary || 'Not yet completed'}.`;
    }

    case 'IdentityVerificationSummary': {
      const client = payload.client || {};
      const idv = payload.idvData || null;
      const clientType = client.client_type || 'NP';

      if (!idv) {
        return `Client type: ${clientType}. IDV not yet completed — no Didit results available.`;
      }

      // Detect mismatches between profile and extracted data
      const nameMismatch = idv.extracted?.full_name && client.full_name &&
        idv.extracted.full_name.toLowerCase().trim() !== client.full_name.toLowerCase().trim();
      const dobMismatch = idv.extracted?.date_of_birth && client.date_of_birth &&
        idv.extracted.date_of_birth !== client.date_of_birth;

      const issues = [];
      if (idv.status !== 'Pass') issues.push(`IDV status: ${idv.status}`);
      if (idv.similarity_score != null && idv.similarity_score < 80) issues.push(`Low face match score: ${idv.similarity_score}%`);
      if (idv.liveness_passed === false) issues.push('Liveness check failed');
      if (idv.aml_hits > 0) issues.push(`${idv.aml_hits} AML hit(s) detected`);
      if (idv.failure_reason) issues.push(`Failure reason: ${idv.failure_reason}`);
      if (nameMismatch) issues.push(`Name mismatch — profile: "${client.full_name}", document: "${idv.extracted.full_name}"`);
      if (dobMismatch) issues.push(`DOB mismatch — profile: ${client.date_of_birth}, document: ${idv.extracted.date_of_birth}`);

      return `Client type: ${clientType}.
IDV outcome: ${idv.status || 'Unknown'}.
Face match: ${idv.similarity_score != null ? idv.similarity_score + '%' : 'N/A'}, Liveness: ${idv.liveness_passed ? 'Passed' : 'Failed'} (${idv.liveness_score != null ? idv.liveness_score + '%' : 'N/A'}).
Document: ${idv.document_type || 'N/A'} issued by ${idv.issuing_country || 'N/A'}.
AML hits: ${idv.aml_hits ?? 0}.
Identity match vs profile: ${issues.length === 0 ? 'No discrepancies found' : issues.join('; ')}.
Provide analyst observations and recommendation only. Do not list out or repeat any of the above data points.`;
    }

    case 'SoFSoW': {
      const client = entityData?.client || {};
      return `Client: ${client.full_name} (${client.client_type}). Sector: ${client.sector || 'N/A'}. SoF stated: ${entityData?.sofStated || 'Not provided'}. SoW stated: ${entityData?.sowStated || 'Not provided'}. Financial docs available: ${entityData?.financialDocs || 'None'}. Outreach response: ${entityData?.outreachResponse || 'Pending'}.`;
    }

    case 'IndicatorApplicability': {
      const client = entityData?.client || {};
      const indicators = entityData?.indicators || [];
      return `Client: ${client.full_name} (${client.client_type}). Sector: ${client.sector || 'N/A'}. Jurisdiction: ${client.registered_country || client.nationality || 'N/A'}. Related party types: ${entityData?.relatedPartyRoles?.join(', ') || 'None'}. Screening summary: ${entityData?.screeningSummary || 'Not yet completed'}. Available indicators: ${JSON.stringify(indicators.map(i => ({ id: i.id, name: i.name, description: i.description })))}.`;
    }

    case 'RiskNarrative': {
      const indicator = indicatorData || {};
      const client = entityData?.client || {};
      return `Entity: ${client.full_name} (${client.client_type}). Indicator: "${indicator.name}" — ${indicator.description}. Score assigned: ${indicator.score}. Evidence attached: ${indicator.evidence || 'None documented'}. Case context: ${indicator.caseContext || 'N/A'}.`;
    }

    case 'WorkflowOptimisation': {
      const cases = caseList || [];
      const summary = cases.slice(0, 30).map(c => `Case ${c.id?.slice(-6)}: client=${c.client_name || 'Unknown'}, status=${c.status}, days_open=${c.days_open || 0}, due=${c.due_date || 'N/A'}, risk=${c.risk_classification || 'Unknown'}, analyst=${c.analyst_name || 'Unassigned'}`).join('\n');
      return `Tenant pipeline — ${cases.length} open cases:\n${summary}`;
    }

    default:
      return JSON.stringify(payload);
  }
}

// ── JSON schema per agent (for structured output) ─────────────────────────────
const OUTPUT_SCHEMAS = {
  OrgChart: {
    type: 'object', properties: {
      nodes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, role: { type: 'string' } } } },
      edges: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, relationship: { type: 'string' }, ownership_pct: { type: 'number' } } } },
      summary: { type: 'string' },
    },
  },
  OutreachCopilot: {
    type: 'object', properties: {
      checklist: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, item_type: { type: 'string' }, justification: { type: 'string' } } } },
      email_draft: { type: 'string' },
    },
  },
  ClientOutreachCopilot: { type: 'object', properties: { answer: { type: 'string' } } },
  ScreeningTriage: {
    type: 'object', properties: {
      narrative: { type: 'string' },
      key_risks: { type: 'array', items: { type: 'string' } },
    },
  },
  ClientProfile: { type: 'object', properties: { narrative: { type: 'string' }, key_risks: { type: 'array', items: { type: 'string' } } } },
  IdentityVerificationSummary: { type: 'object', properties: { narrative: { type: 'string' }, key_risks: { type: 'array', items: { type: 'string' } } } },
  SoFSoW: {
    type: 'object', properties: {
      narrative: { type: 'string' },
      evidence_gaps: { type: 'array', items: { type: 'string' } },
      adequacy: { type: 'string' },
    },
  },
  IndicatorApplicability: {
    type: 'object', properties: {
      applicable: { type: 'array', items: { type: 'object', properties: { indicator_id: { type: 'string' }, indicator_name: { type: 'string' }, reason: { type: 'string' } } } },
      not_applicable: { type: 'array', items: { type: 'string' } },
    },
  },
  RiskNarrative: {
    type: 'object', properties: {
      narrative: { type: 'string' },
      conclusion: { type: 'string' },
      evidence: { type: 'string' },
      mitigants: { type: 'string' },
    },
  },
  WorkflowOptimisation: {
    type: 'object', properties: {
      bottlenecks: { type: 'array', items: { type: 'object', properties: { case_id: { type: 'string' }, client_name: { type: 'string' }, issue: { type: 'string' }, recommended_action: { type: 'string' }, urgency: { type: 'string' } } } },
      capacity_warnings: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string' },
    },
  },
};

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { agent_type, payload = {}, case_id } = body;
  const tenantId = user.tenant_id;

  if (!agent_type) return Response.json({ error: 'agent_type is required' }, { status: 400 });

  // ── 1. Token cost guard ──
  const dailyTokens = await getDailyTokensUsed(base44, tenantId, case_id);
  if (dailyTokens >= DEFAULT_DAILY_TOKEN_CAP) {
    return Response.json({
      error: 'daily_token_cap_exceeded',
      message: `Daily AI token cap (${DEFAULT_DAILY_TOKEN_CAP.toLocaleString()}) reached for this case. Try again tomorrow.`,
    }, { status: 429 });
  }

  // ── 2. Load tenant-specific system prompt (S-210 override or default) ──
  let systemPrompt = DEFAULT_SYSTEM_PROMPTS[agent_type];
  const customConfigs = await base44.asServiceRole.entities.AiPromptConfig.filter({ tenant_id: tenantId, agent_key: agent_type });
  if (customConfigs?.length > 0) {
    systemPrompt = customConfigs[0].system_prompt || systemPrompt;
  }

  // ── 3. Build context string (tenant-isolated) ──
  const contextStr = await buildContext(base44, agent_type, { ...payload, tenantId, caseId: case_id }, tenantId);

  // For summary/observation agents: reinforce at end of prompt that output must not echo raw data
  const observationAgents = ['IdentityVerificationSummary', 'ScreeningTriage', 'ClientProfile', 'RiskNarrative', 'SoFSoW'];
  const closingInstruction = observationAgents.includes(agent_type)
    ? '\n\nIMPORTANT: Your response must contain ONLY analyst observations and conclusions. Do NOT reproduce, list, or paraphrase any of the raw data fields above. Write as a compliance professional, not as a data summariser.'
    : '';

  const fullPrompt = `${systemPrompt}\n\n--- CONTEXT (for reference only — do not echo) ---\n${contextStr}${closingInstruction}`;
  const promptHash = hashPrompt(fullPrompt);

  // ── 4. Call AI ──
  const schema = OUTPUT_SCHEMAS[agent_type];
  const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: fullPrompt,
    response_json_schema: schema || undefined,
  });

  // Estimate tokens (rough: 1 token ≈ 4 chars)
  const tokensInput  = Math.ceil(fullPrompt.length / 4);
  const tokensOutput = Math.ceil(JSON.stringify(result).length / 4);
  const outputSummary = JSON.stringify(result).substring(0, 500);

  // ── 5. Log AiAgentRun ──
  const runRecord = await base44.asServiceRole.entities.AiAgentRun.create({
    tenant_id: tenantId,
    case_id: case_id || null,
    agent_type,
    prompt_hash: promptHash,
    model_used: 'gpt-4o-mini',
    tokens_input: tokensInput,
    tokens_output: tokensOutput,
    output_summary: outputSummary,
  });

  return Response.json({
    output: result,
    run_id: runRecord?.id,
    tokens_used: tokensInput + tokensOutput,
    daily_tokens_remaining: Math.max(0, DEFAULT_DAILY_TOKEN_CAP - dailyTokens - tokensInput - tokensOutput),
  });
});