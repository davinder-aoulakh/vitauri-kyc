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

  ScreeningTriage: `You are a financial crime screening analyst. Given a screening hit with entity name, source list, confidence score and raw details, determine whether this is a true match or a false positive. Return JSON: {recommendation: "Likely_False_Positive"|"Possible_Match"|"Confirmed_Match", confidence_score: number, rationale: string (2-3 sentences)}.`,

  ClientProfile: `You are a KYC analyst drafting a regulatory-grade client profile. Using all available client data, write a professional profile narrative in markdown format. Sections: Business Overview | Ownership Structure | Geographic Footprint | Products & Services | Notable Risk Factors. Be factual, precise, regulatory-grade.`,

  IdentityVerificationSummary: `You are a KYC compliance analyst reviewing identity verification results from Didit. You will be given the client type (NP = Natural Person, ORG = Organisation), client profile data, and Didit IDV results. Provide a concise structured analysis: 1) Verification Outcome — Pass/Fail and key scores (face match, liveness). 2) Identity Data Match — confirm whether the Didit-extracted name, DOB, nationality and document match the client profile on file. 3) Concerns — flag any issues such as low scores, liveness failure, expiring document, AML hits, or mismatches. 4) Recommendation — Accept / Flag / Escalate with a one-line justification. For ORG clients where IDV is waived, note that clearly. Return JSON: { narrative: string, key_risks: [string] }.`,

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
      const hit = hitData || {};
      return `Entity: ${hit.entity_name || 'Unknown'} (${hit.entity_type || 'Client'}). Hit source: ${hit.source}. Confidence: ${hit.confidence_score}%. Raw details: ${JSON.stringify(hit.hit_details || {})}. Entity sector: ${entityData?.sector || 'Unknown'}, country: ${entityData?.country || 'Unknown'}.`;
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
      const profileLine = clientType === 'NP'
        ? `Natural Person — Name: ${client.full_name || 'N/A'}, DOB: ${client.date_of_birth || 'N/A'}, Nationality: ${client.nationality || 'N/A'}, ID Type: ${client.id_type || 'N/A'}, ID Number: ${client.id_number || 'N/A'}`
        : `Organisation — Name: ${client.full_name || 'N/A'}, Registration: ${client.registration_number || 'N/A'}, Country: ${client.registered_country || 'N/A'}, Legal Form: ${client.legal_form || 'N/A'}`;

      if (!idv) {
        return `Client type: ${clientType}. ${profileLine}. IDV Status: No Didit verification results available yet — identity verification has not been completed or results are pending.`;
      }

      const extractedLine = idv.extracted
        ? `Extracted from document — Name: ${idv.extracted.full_name || 'N/A'}, DOB: ${idv.extracted.date_of_birth || 'N/A'}, Nationality: ${idv.extracted.nationality || 'N/A'}, Doc Number: ${idv.extracted.document_number || 'N/A'}, Expiry: ${idv.extracted.expiry_date || 'N/A'}`
        : 'No extracted data available';

      return `Client type: ${clientType}. ${profileLine}.

Didit IDV Result:
- Status: ${idv.status || 'Unknown'}
- Document Type: ${idv.document_type || 'N/A'}, Issuing Country: ${idv.issuing_country || 'N/A'}
- Face Match Score: ${idv.similarity_score != null ? idv.similarity_score + '%' : 'N/A'}
- Liveness Score: ${idv.liveness_score != null ? idv.liveness_score + '%' : 'N/A'}, Liveness Passed: ${idv.liveness_passed != null ? idv.liveness_passed : 'N/A'}
- AML Hits: ${idv.aml_hits != null ? idv.aml_hits : 'N/A'}
- Failure Reason: ${idv.failure_reason || 'None'}
- ${extractedLine}
- Total sessions reviewed: ${idv.total_sessions || 1}`;
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
      recommendation: { type: 'string' },
      confidence_score: { type: 'number' },
      rationale: { type: 'string' },
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
  const fullPrompt = `${systemPrompt}\n\n--- CONTEXT ---\n${contextStr}`;
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