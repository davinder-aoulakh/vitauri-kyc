import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { file_url, doc_type, client_type } = await req.json();
  if (!file_url || !doc_type) return Response.json({ error: 'file_url and doc_type are required' }, { status: 400 });

  const prompt = `Extract all identity fields from this ${doc_type} document.
Client type: ${client_type || 'unknown'}.

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
  "confidence": number (0-100, your confidence in the extraction quality),
  "warnings": [string] (e.g. "Image blurred", "Document appears expired", "Glare detected"),
  "document_signals": string (visible security features, holograms, or authenticity signals you can observe)
}`;

  try {
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
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
          confidence:       { type: 'number' },
          warnings:         { type: 'array', items: { type: 'string' } },
          document_signals: { type: ['string', 'null'] },
        }
      }
    });

    const extracted = typeof result === 'object' && result !== null ? result : {};
    const { confidence, warnings, document_signals, ...fields } = extracted;

    // Strip null/empty values from fields
    const cleaned = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v !== null && v !== undefined && v !== '') cleaned[k] = v;
    }

    return Response.json({
      extracted: cleaned,
      confidence: confidence ?? 0,
      warnings:   warnings  ?? [],
      document_signals: document_signals ?? '',
      doc_type,
    });

  } catch (err) {
    return Response.json({
      extracted: {},
      confidence: 0,
      warnings: ['OCR failed — please upload a clearer image of the document'],
      document_signals: '',
      doc_type,
    });
  }
});