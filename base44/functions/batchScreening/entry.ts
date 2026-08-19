import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Batch Screening Function
 * Accepts an array of entities (name, type, country, dob/reg) and runs each
 * one through Didit's standalone AML Screening API — the same real
 * PEP/Sanctions/Adverse Media/Warnings check used by screenEntityAml for
 * single-entity, in-case screening. Returns a hits array per entity.
 *
 * Previously this asked a general-purpose LLM (InvokeLLM) to guess whether
 * each entity was "likely" to appear on a sanctions/PEP list from its name
 * and country alone — a hallucination risk for a compliance decision. That
 * has been replaced with real screening calls; see screenEntityAml for notes
 * on the AML response shape and why it's parsed defensively.
 */

const DIDIT_AML_URL = 'https://verification.didit.me/v3/aml/';
const CONCURRENCY = 5;

const SOURCE_LABEL = {
  Sanctions_EU:  'EU Sanctions',
  Sanctions_UN:  'UN Sanctions',
  PEP_List:      'PEP List',
  Adverse_Media: 'Adverse Media',
  Internal_Flag: 'Warnings / Regulatory',
};

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { entities, tenant_id } = await req.json();
  if (!entities || !Array.isArray(entities) || entities.length === 0) {
    return Response.json({ error: 'entities array is required' }, { status: 400 });
  }
  if (!tenant_id) {
    return Response.json({ error: 'tenant_id is required' }, { status: 400 });
  }

  const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenant_id });
  const tenant  = tenants?.[0];
  if (!tenant?.didit_api_key) {
    return Response.json({ error: 'AML screening is not configured for this institution. Contact support.' }, { status: 400 });
  }

  const results = new Array(entities.length);

  // Small fixed-size worker pool — sequential per worker, CONCURRENCY workers
  // in parallel, so a large CSV doesn't fire dozens of simultaneous requests.
  let cursor = 0;
  async function worker() {
    while (cursor < entities.length) {
      const idx = cursor++;
      const e = entities[idx];
      results[idx] = await screenOne(tenant.didit_api_key, e, idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entities.length) }, worker));

  return Response.json({ results });
});

async function screenOne(apiKey, entity, index) {
  const body = {
    full_name:   entity.name,
    entity_type: (entity.type || 'NP').toUpperCase() === 'ORG' ? 'Organization' : 'Person',
  };
  if (entity.dob)                  body.date_of_birth = entity.dob;
  if (entity.country)              body.country = entity.country;
  if (entity.registration_number)  body.document_number = entity.registration_number;

  let raw;
  try {
    const response = await fetch(DIDIT_AML_URL, {
      method:  'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      return {
        index, name: entity.name, hit: false, risk_level: null, hits: [],
        summary: `Could not be screened: ${errBody?.detail || `Didit AML API error ${response.status}`}`,
        screening_error: true,
      };
    }
    raw = await response.json();
  } catch (err) {
    return {
      index, name: entity.name, hit: false, risk_level: null, hits: [],
      summary: `Could not be screened: ${err.message}`,
      screening_error: true,
    };
  }

  const hits = normalizeDiditAmlResponse(raw, entity.name);
  const riskLevel = hits.length === 0 ? 'Low' : deriveRiskLevel(hits);

  return {
    index,
    name: entity.name,
    hit: hits.length > 0,
    risk_level: riskLevel,
    hits: hits.map(h => ({
      source:             h.source,
      hit_name:           h.hitName,
      confidence_score:   h.confidenceScore,
      ai_recommendation:  triageRecommendation(h.confidenceScore),
      ai_rationale:       `${h.confidenceScore}% confidence Didit AML match against ${SOURCE_LABEL[h.source] || h.source}.`,
    })),
    summary: hits.length === 0
      ? 'No matches found.'
      : `${hits.length} match${hits.length !== 1 ? 'es' : ''} found — ${hits.map(h => SOURCE_LABEL[h.source] || h.source).join(', ')}.`,
  };
}

function deriveRiskLevel(hits) {
  const maxScore = Math.max(...hits.map(h => h.confidenceScore));
  if (maxScore >= 80) return 'High';
  if (maxScore >= 50) return 'Medium';
  return 'Low';
}

function triageRecommendation(score) {
  if (score >= 80) return 'Confirmed_Match';
  if (score >= 50) return 'Possible_Match';
  return 'Likely_False_Positive';
}

// ── Response normalization — kept in sync with screenEntityAml/entry.ts ────
// (see that file's header comment for why this is defensive/dual-shape)
function normalizeDiditAmlResponse(data, entityName) {
  const root = data?.aml || data?.decision?.aml || data || {};
  const hits = [];

  const CATEGORY_FIELDS = [
    ['sanction_matches',      'Sanctions_EU'],
    ['pep_matches',           'PEP_List'],
    ['adverse_media_matches', 'Adverse_Media'],
    ['warning_matches',       'Internal_Flag'],
  ];

  let sawCategorizedShape = false;
  for (const [field, defaultSource] of CATEGORY_FIELDS) {
    const arr = root[field];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    sawCategorizedShape = true;
    for (const m of arr) {
      hits.push({
        hitName: m.caption || m.name || m.entity_name || m.full_name || entityName,
        source: field === 'sanction_matches' ? classifySanctionSource(m) : defaultSource,
        confidenceScore: Math.round(m.match_score ?? m.score ?? m?.risk_view?.categories?.score ?? 50),
      });
    }
  }

  if (!sawCategorizedShape && Array.isArray(root.hits)) {
    for (const h of root.hits) {
      const rawScore = h.score ?? h.similarity_score ?? 0.5;
      hits.push({
        hitName: h.entity_name || h.name || h.full_name || entityName,
        source: guessSourceFromText([...(h.categories || []), ...(h.datasets || [])].join(' ')),
        confidenceScore: Math.round(rawScore <= 1 ? rawScore * 100 : rawScore),
      });
    }
  }

  if (!sawCategorizedShape && hits.length === 0 && (root.total_hits > 0 || root.hit === true)) {
    console.error('batchScreening: unrecognized AML hit shape, raw payload:', JSON.stringify(data));
    hits.push({ hitName: `Unparsed AML match for ${entityName}`, source: 'Internal_Flag', confidenceScore: 50 });
  }

  return hits;
}

function classifySanctionSource(match) {
  const text = [match.list_name, match.list, match.sanction_program, match.sanctioning_authority]
    .filter(Boolean).join(' ').toLowerCase();
  if (text.includes('united nations') || /\bun\b/.test(text)) return 'Sanctions_UN';
  return 'Sanctions_EU';
}

function guessSourceFromText(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('pep')) return 'PEP_List';
  if (text.match(/\bun\b/i) || t.includes('united nations')) return 'Sanctions_UN';
  if (t.includes('sanction')) return 'Sanctions_EU';
  if (t.includes('adverse') || t.includes('media')) return 'Adverse_Media';
  return 'Internal_Flag';
}
