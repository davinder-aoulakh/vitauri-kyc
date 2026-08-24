import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { file_url, doc_type, client_type } = await req.json();
  if (!file_url || !doc_type) return Response.json({ error: 'file_url and doc_type are required' }, { status: 400 });

  const isOrg = client_type === 'ORG';

  // ── ORG document path ─────────────────────────────────────────────────────────
  if (isOrg) {
    const orgPrompt = `You are a KYC document analyst. Extract structured data from this ${doc_type} document for an ORGANISATION / LEGAL ENTITY.

Return ONLY valid JSON with no markdown, no explanation:
{
  "full_name": string or null (legal entity name),
  "registration_number": string or null (KvK, Companies House, etc.),
  "legal_form": string or null (BV, NV, Ltd, LLC, GmbH, etc.),
  "registered_country": string or null (ISO country name),
  "registered_address": string or null,
  "sector": string or null (industry/sector),
  "lei_code": string or null (20-char LEI if present),
  "incorporation_date": "YYYY-MM-DD" or null,
  "related_parties": [
    {
      "full_name": string,
      "role": string (Director / UBO / Shareholder / Beneficiary / etc.),
      "ownership_percentage": number or null,
      "nationality": string or null,
      "confidence": number (0-100)
    }
  ],
  "field_confidence": {
    "full_name": number (0-100),
    "registration_number": number (0-100),
    "legal_form": number (0-100),
    "registered_country": number (0-100),
    "registered_address": number (0-100),
    "sector": number (0-100),
    "lei_code": number (0-100)
  },
  "confidence": number (0-100, overall extraction quality),
  "warnings": [string],
  "document_signals": string or null
}

Rules:
- Set null for any field not clearly visible in the document
- Do NOT invent or guess values — null is correct for missing data
- For related_parties, only include persons/entities explicitly named with a role
- confidence per field should reflect readability, not certainty of the value`;

    try {
      const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: orgPrompt,
        file_urls: [file_url],
        model: 'gemini_3_1_pro',
        response_json_schema: {
          type: 'object',
          properties: {
            full_name:           { type: ['string','null'] },
            registration_number: { type: ['string','null'] },
            legal_form:          { type: ['string','null'] },
            registered_country:  { type: ['string','null'] },
            registered_address:  { type: ['string','null'] },
            sector:              { type: ['string','null'] },
            lei_code:            { type: ['string','null'] },
            incorporation_date:  { type: ['string','null'] },
            related_parties: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  full_name:            { type: 'string' },
                  role:                 { type: 'string' },
                  ownership_percentage: { type: ['number','null'] },
                  nationality:          { type: ['string','null'] },
                  confidence:           { type: 'number' },
                }
              }
            },
            field_confidence:  { type: 'object' },
            confidence:        { type: 'number' },
            warnings:          { type: 'array', items: { type: 'string' } },
            document_signals:  { type: ['string','null'] },
          }
        }
      });

      const extracted = typeof result === 'object' && result !== null ? result : {};
      const { confidence, warnings, document_signals, field_confidence, related_parties, ...fields } = extracted as any;

      // Strip null/empty values from top-level fields
      const cleaned: Record<string, any> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v !== null && v !== undefined && v !== '') cleaned[k] = v;
      }

      return Response.json({
        extracted: cleaned,
        related_parties: related_parties || [],
        field_confidence: field_confidence || {},
        confidence: confidence ?? 0,
        warnings: warnings ?? [],
        document_signals: document_signals ?? '',
        doc_type,
        client_type: 'ORG',
      });

    } catch (err) {
      return Response.json({
        extracted: {},
        related_parties: [],
        field_confidence: {},
        confidence: 0,
        warnings: ['OCR failed — please upload a clearer image or PDF of the document'],
        document_signals: '',
        doc_type,
        client_type: 'ORG',
      });
    }
  }

  // ── NP document path (unchanged) ─────────────────────────────────────────────
  const npPrompt = `Extract all identity fields from this ${doc_type} document.
Client type: ${client_type || 'NP'}.

Return ONLY valid JSON with no markdown, no explanation:
{
  "full_name": string or null,
  "date_of_birth": "YYYY-MM-DD" or null,
  "nationality": string or null,
  "id_number": string or null,
  "id_type": string or null,
  "id_expiry_date": "YYYY-MM-DD" or null,
  "id_issue_date": "YYYY-MM-DD" or null,
  "country_of_issue": string or null,
  "mrz_line1": string or null,
  "mrz_line2": string or null,
  "gender": string or null,
  "address": string or null,
  "field_confidence": {
    "full_name": number (0-100),
    "date_of_birth": number (0-100),
    "nationality": number (0-100),
    "id_number": number (0-100),
    "id_type": number (0-100),
    "country_of_issue": number (0-100)
  },
  "confidence": number (0-100, your confidence in the extraction quality),
  "warnings": [string] (e.g. "Image blurred", "Document appears expired", "Glare detected"),
  "document_signals": string (visible security features, holograms, or authenticity signals you can observe)
}`;

  try {
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: npPrompt,
      file_urls: [file_url],
      model: 'gemini_3_1_pro',
      response_json_schema: {
        type: 'object',
        properties: {
          full_name:        { type: ['string', 'null'] },
          date_of_birth:    { type: ['string', 'null'] },
          nationality:      { type: ['string', 'null'] },
          id_number:        { type: ['string', 'null'] },
          id_type:          { type: ['string', 'null'] },
          id_expiry_date:   { type: ['string', 'null'] },
          id_issue_date:    { type: ['string', 'null'] },
          country_of_issue: { type: ['string', 'null'] },
          mrz_line1:        { type: ['string', 'null'] },
          mrz_line2:        { type: ['string', 'null'] },
          gender:           { type: ['string', 'null'] },
          address:          { type: ['string', 'null'] },
          field_confidence: { type: 'object' },
          confidence:       { type: 'number' },
          warnings:         { type: 'array', items: { type: 'string' } },
          document_signals: { type: ['string', 'null'] },
        }
      }
    });

    const extracted = typeof result === 'object' && result !== null ? result : {};
    const { confidence, warnings, document_signals, field_confidence, ...fields } = extracted as any;

    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v !== null && v !== undefined && v !== '') cleaned[k] = v;
    }

    return Response.json({
      extracted: cleaned,
      related_parties: [],
      field_confidence: field_confidence || {},
      confidence: confidence ?? 0,
      warnings: warnings ?? [],
      document_signals: document_signals ?? '',
      doc_type,
      client_type: 'NP',
    });

  } catch (err) {
    return Response.json({
      extracted: {},
      related_parties: [],
      field_confidence: {},
      confidence: 0,
      warnings: ['OCR failed — please upload a clearer image of the document'],
      document_signals: '',
      doc_type,
      client_type: 'NP',
    });
  }
});