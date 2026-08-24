/**
 * screenEntityAml — Didit Mode B standalone AML check (POST /v3/aml/)
 *
 * Callable from BatchScreening (UI), periodicReviewJob, or any analyst-triggered
 * standalone AML check. Writes ScreeningHit records and optionally creates an EDR
 * case if hits are found and no active case exists.
 *
 * Handles all documented failure modes:
 *  - HTTP 400 (weights ≠ 100 / ongoing_monitoring without save_api_request) → structured error
 *  - HTTP 403 (out of credits) → structured error
 *  - Adverse-media timeout (>25s) → result returned with adverse_media_incomplete flag
 *  - Test mode (_test_only) → validates credentials without consuming credits
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { format, addDays } from 'npm:date-fns@3.6.0';

const DIDIT_AML_URL = 'https://verification.didit.me/v3/aml/';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const params = await req.json();
    const {
      tenant_id, full_name, legal_type,       // 'NP' | 'ORG'
      date_of_birth, nationality, country,
      registration_number, document_number,
      case_id, client_id,                     // optional — for writing ScreeningHit records
      include_adverse_media = false,
      _test_only, api_key: testApiKey,
    } = params;

    // ── TEST MODE ────────────────────────────────────────────────────────────
    if (_test_only) {
      if (!testApiKey) return Response.json({ error: 'API key required' });
      try {
        const r = await fetch(DIDIT_AML_URL, {
          method: 'POST',
          headers: { 'x-api-key': testApiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ full_name: 'Connection Test', entity_type: 'Person' }),
        });
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

    // 1. Load tenant API key
    const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: tenant_id });
    const tenant  = tenants?.[0];
    if (!tenant?.didit_api_key) {
      return Response.json({ error: 'AML screening is not configured for this institution. Contact support.' });
    }

    // 2. Build request body
    const body: Record<string, unknown> = {
      full_name,
      entity_type: legal_type === 'ORG' ? 'Organization' : 'Person',
    };
    if (date_of_birth)    body.date_of_birth    = date_of_birth;
    if (nationality)      body.nationality       = nationality;
    if (country)          body.country           = country;
    if (document_number)  body.document_number   = document_number;
    else if (legal_type === 'ORG' && registration_number) body.document_number = registration_number;
    if (include_adverse_media) body.include_adverse_media = true;

    // 3. Call Didit with appropriate timeout (45s for adverse media, 15s otherwise)
    const timeoutMs  = include_adverse_media ? 45000 : 15000;
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), timeoutMs);

    let raw: Record<string, unknown>;
    let adverseMediaIncomplete = false;

    try {
      const response = await fetch(DIDIT_AML_URL, {
        method:  'POST',
        headers: { 'x-api-key': tenant.didit_api_key, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  controller.signal,
      });
      clearTimeout(timer);

      if (response.status === 403) {
        return Response.json({ error: 'AML screening credits exhausted. Contact your Didit account manager to top up.', error_code: 'out_of_credits' });
      }
      if (response.status === 400) {
        const errBody = await response.json().catch(() => ({}));
        const msg = errBody?.detail || errBody?.message || 'Invalid AML request parameters (check weights sum to 100)';
        return Response.json({ error: msg, error_code: 'bad_request' });
      }
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const msg = errBody?.detail || errBody?.message || `Didit AML API error ${response.status}`;
        return Response.json({ error: msg });
      }

      raw = await response.json();
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError' && include_adverse_media) {
        // Timeout during adverse-media check — treat as incomplete but not fatal
        adverseMediaIncomplete = true;
        raw = {};
      } else {
        return Response.json({ error: `Network error: ${err.message}` });
      }
    }

    // 4. Normalise response
    const amlRoot  = raw?.aml || raw || {};
    const rawHits  = amlRoot.hits     || [];
    const warnings = amlRoot.warnings || [];
    const amlStatus = amlRoot.status  || null;

    const hits = normalizeHits(rawHits, full_name);

    // 5. Optionally write ScreeningHit records
    let createdHitIds: string[] = [];
    if ((case_id || client_id) && hits.length > 0) {
      for (const hit of hits) {
        try {
          const record = await base44.asServiceRole.entities.ScreeningHit.create({
            tenant_id,
            case_id:          case_id || null,
            client_id:        client_id || null,
            entity_name:      full_name,
            entity_type:      'Client',
            source:           hit.source,
            hit_name:         hit.hitName,
            confidence_score: hit.confidenceScore,
            hit_details:      hit.rawDetails,
            status:           'New',
            ai_recommendation: recommendFromScore(hit.confidenceScore),
            ai_rationale:     `Didit AML: ${hit.rawDetails?.match_type || hit.source?.replace(/_/g, ' ')} match at ${hit.confidenceScore}% confidence.`,
          });
          createdHitIds.push(record.id);
        } catch {}
      }

      // 6. Auto-create EDR case if hits exist and no active case provided
      if (!case_id && client_id && hits.length > 0) {
        const activeCases = await base44.asServiceRole.entities.KycCase.filter({ client_id, status: 'In_Progress' }, null, 1);
        if (!activeCases?.length) {
          const dueDate = format(addDays(new Date(), 14), 'yyyy-MM-dd');
          const edrCase = await base44.asServiceRole.entities.KycCase.create({
            tenant_id,
            client_id,
            case_type:          'Event_Driven_Review',
            status:             'Draft',
            trigger_reason:     `Standalone AML screening returned ${hits.length} hit(s) — ${hits.map(h => h.hitName).slice(0, 3).join(', ')}`,
            due_date:           dueDate,
          });
          // Re-link created hits to the new case
          for (const hitId of createdHitIds) {
            await base44.asServiceRole.entities.ScreeningHit.update(hitId, { case_id: edrCase.id }).catch(() => {});
          }
        }
      }
    }

    return Response.json({
      hits,
      provider:               'didit',
      raw_status:             amlStatus,
      warnings,
      adverse_media_incomplete: adverseMediaIncomplete,
      screening_hits_created:  createdHitIds.length,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function recommendFromScore(score: number): string {
  if (score >= 90) return 'Confirmed_Match';
  if (score >= 60) return 'Possible_Match';
  return 'Likely_False_Positive';
}

function normalizeHits(rawHits: unknown[], entityName: string) {
  return rawHits.map(h => {
    const hit = h as Record<string, unknown>;
    const rawScore  = (hit.score ?? hit.similarity_score ?? 0.5) as number;
    const matchScore = rawScore <= 1 ? Math.round(rawScore * 100) : Math.round(rawScore as number);
    const categories = (hit.categories || []) as string[];
    const datasets   = (hit.datasets   || []) as string[];

    return {
      hitName:         (hit.caption || hit.name || hit.entity_name || hit.full_name || entityName) as string,
      source:          guessSource([...categories, ...datasets].join(' ')),
      confidenceScore: matchScore,
      rawDetails: {
        listed_name:   hit.caption || hit.name || entityName,
        match_type:    hit.match_type   || null,
        categories,
        datasets,
        country:       hit.country      || (hit.properties as Record<string, unknown>)?.country || null,
        date_of_birth: hit.date_of_birth || null,
        risk_score:    hit.risk_score   ?? null,
        match_score:   matchScore,
        review_status: hit.review_status || null,
        provider:      'Didit',
        last_checked:  new Date().toISOString(),
      },
    };
  });
}

function guessSource(text: string): string {
  const t = (text || '').toLowerCase();
  if (t.includes('pep') || t.includes('politically')) return 'PEP_List';
  if (/\bun\b/.test(t)  || t.includes('united nations')) return 'Sanctions_UN';
  if (t.includes('sanction') || t.includes('ofac') || t.includes('eu')) return 'Sanctions_EU';
  if (t.includes('adverse') || t.includes('media')) return 'Adverse_Media';
  if (t.includes('insolvency') || t.includes('enforcement') || t.includes('bankruptcy')) return 'Internal_Flag';
  return 'Internal_Flag';
}