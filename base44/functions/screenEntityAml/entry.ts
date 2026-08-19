import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * screenEntityAml — real PEP / Sanctions / Adverse Media / Warnings screening
 * via Didit's standalone AML Screening API (https://verification.didit.me/v3/aml/).
 *
 * Replaces the fabricated data previously used for on-demand screening:
 *  - src/lib/screeningVendor.js used a seeded pseudo-random generator against
 *    three hardcoded fake names.
 *  - base44/functions/batchScreening asked a general-purpose LLM to *guess*
 *    whether an entity was likely on a watchlist.
 *
 * NOTE ON FIELD NAMES: this sandbox could not reach docs.didit.me directly
 * (egress-blocked), so the exact request/response contract below is
 * reconstructed from Didit's published standalone-AML documentation via
 * search-indexed summaries, not a first-hand read of the doc page. Before
 * relying on this in production, confirm the request/response shape against
 * your Didit account's live API reference or a sample response from Didit
 * support, and adjust normalizeDiditAmlResponse() if field names differ.
 * The parser is written defensively (handles two plausible response shapes)
 * for exactly this reason — see normalizeDiditAmlResponse below.
 */

const DIDIT_AML_URL = 'https://verification.didit.me/v3/aml/';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const params = await req.json();
    const {
      tenant_id, full_name, legal_type, // 'NP' | 'ORG'
      date_of_birth, nationality, country,
      registration_number, document_number,
      _test_only, api_key: testApiKey,
    } = params;

    // ── TEST MODE: just validate credentials against the AML endpoint ────────
    if (_test_only) {
      if (!testApiKey) return Response.json({ error: 'API key required' });
      try {
        const r = await fetch(DIDIT_AML_URL, {
          method: 'POST',
          headers: { 'x-api-key': testApiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ full_name: 'Connection Test', entity_type: 'Person' }),
        });
        // 401/403 = bad key. Any other response (incl. a well-formed screening
        // result or a validation error on our minimal test payload) means the
        // key itself is accepted.
        if (r.status === 401 || r.status === 403) {
          return Response.json({ error: `Invalid credentials (${r.status})` });
        }
        return Response.json({ ok: true });
      } catch (err) {
        return Response.json({ error: err.message });
      }
    }

    if (!tenant_id || !full_name) {
      return Response.json({ error: 'tenant_id and full_name are required' });
    }

    // 1. Load tenant's Didit API key (service role — batch/analyst callers may
    //    not have direct tenant read access to secrets)
    const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenant_id });
    const tenant  = tenants?.[0];
    if (!tenant?.didit_api_key) {
      return Response.json({ error: 'AML screening is not configured for this institution. Contact support.' });
    }

    // 2. Build request body
    const body = {
      full_name,
      entity_type: legal_type === 'ORG' ? 'Organization' : 'Person',
    };
    if (date_of_birth)   body.date_of_birth = date_of_birth;
    if (nationality)     body.nationality    = nationality;
    if (country)         body.country        = country;
    if (document_number) body.document_number = document_number;
    else if (legal_type === 'ORG' && registration_number) body.document_number = registration_number;

    // 3. Call Didit
    let raw;
    try {
      const response = await fetch(DIDIT_AML_URL, {
        method:  'POST',
        headers: { 'x-api-key': tenant.didit_api_key, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const msg = errBody?.detail || errBody?.message || `Didit AML API error ${response.status}`;
        return Response.json({ error: msg });
      }

      raw = await response.json();
    } catch (err) {
      return Response.json({ error: `Network error: ${err.message}` });
    }

    const hits = normalizeDiditAmlResponse(raw, full_name);
    return Response.json({ hits, provider: 'didit', raw_status: raw?.status || raw?.aml?.status || null });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * Normalizes a Didit standalone-AML response into the hit shape the rest of
 * the app expects: { hitName, source, confidenceScore, rawDetails }.
 *
 * Handles two plausible response shapes defensively, since the live schema
 * couldn't be confirmed first-hand (see module header):
 *   Shape A — categorized match arrays: sanction_matches / pep_matches /
 *             adverse_media_matches / warning_matches, each item scored
 *             0-100 via match_score (or risk_view.categories.score).
 *   Shape B — a flat hits[] array (the same shape Didit embeds in a live IDV
 *             session's aml_screenings[0].hits, already handled elsewhere in
 *             this app — see getDiditSessionDetails), scored 0-1.
 * If neither shape is recognized, returns [] and logs the raw payload so a
 * real example can be captured from production logs and this parser fixed.
 */
function normalizeDiditAmlResponse(data, entityName) {
  const root = data?.aml || data?.decision?.aml || data || {};
  const hits = [];

  const CATEGORY_FIELDS = [
    ['sanction_matches',      'Sanctions_EU'],   // see classifySanctionSource()
    ['pep_matches',           'PEP_List'],
    ['adverse_media_matches', 'Adverse_Media'],
    ['warning_matches',       'Internal_Flag'],  // regulatory enforcement / fitness & probity
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
        rawDetails: {
          listed_name:  m.caption || m.name || entityName,
          list:         m.list_name || m.list || null,
          program:      m.sanction_program || null,
          authority:    m.sanctioning_authority || null,
          url:          m.url || m.source_url || null,
          country:      m.country || null,
          date_of_birth:m.date_of_birth || null,
          match_type:   m.match_type || 'Didit AML match',
          provider:     'Didit',
          last_checked: new Date().toISOString(),
        },
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
        rawDetails: { ...h, provider: 'Didit', last_checked: new Date().toISOString() },
      });
    }
  }

  if (!sawCategorizedShape && hits.length === 0 && (root.total_hits > 0 || root.hit === true)) {
    // Didit reported a hit but in a shape this parser doesn't recognize yet —
    // don't silently report "clear". Log it so the shape can be added above.
    console.error('screenEntityAml: unrecognized AML hit shape, raw payload:', JSON.stringify(data));
    hits.push({
      hitName: `Unparsed AML match for ${entityName}`,
      source: 'Internal_Flag',
      confidenceScore: 50,
      rawDetails: { note: 'Didit reported a hit in a response shape this integration does not yet parse — check function logs for the raw payload.', provider: 'Didit' },
    });
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
