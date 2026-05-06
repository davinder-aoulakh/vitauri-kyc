import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { file_url, doc_type, client_type } = await req.json();
  if (!file_url || !doc_type) return Response.json({ error: 'file_url and doc_type are required' }, { status: 400 });

  // Build extraction prompt based on document type
  const isPassport = doc_type === 'Passport';
  const isIdCard   = doc_type === 'ID_Card';
  const isArticles = doc_type === 'Articles_of_Association';
  const isUBO      = doc_type === 'UBO_Register';
  const isIncorp   = isArticles || isUBO || doc_type === 'KYC_Report';

  let systemContext = '';
  let schema = {};

  if (isPassport || isIdCard) {
    systemContext = `You are a KYC document processing specialist. Extract all readable data from this identity document image. Be precise — only extract what is clearly visible. Use ISO date format (YYYY-MM-DD) for dates. For country fields, output the full country name (e.g. "Netherlands" not "NL").`;
    schema = {
      type: 'object',
      properties: {
        full_name:            { type: 'string', description: 'Full name as shown on document' },
        date_of_birth:        { type: 'string', description: 'Date of birth YYYY-MM-DD' },
        nationality:          { type: 'string', description: 'Nationality/issuing country full name' },
        id_number:            { type: 'string', description: 'Document/passport number' },
        id_expiry_date:       { type: 'string', description: 'Expiry date YYYY-MM-DD' },
        id_type:              { type: 'string', description: 'Passport, National ID Card, Driving Licence, etc.' },
        country_of_residence: { type: 'string', description: 'Country of residence if shown, else null' },
        confidence:           { type: 'number', description: 'Overall extraction confidence 0-100' },
        warnings:             { type: 'array', items: { type: 'string' }, description: 'Any concerns about the document (e.g. expiry, blur)' },
      },
    };
  } else if (isIncorp) {
    systemContext = `You are a KYC compliance specialist. Extract key corporate information from this document. Only extract clearly visible data. For country fields, output the full country name.`;
    schema = {
      type: 'object',
      properties: {
        full_name:            { type: 'string', description: 'Legal entity name' },
        registration_number:  { type: 'string', description: 'Company/Chamber of Commerce registration number' },
        registered_country:   { type: 'string', description: 'Country of registration full name' },
        registered_address:   { type: 'string', description: 'Registered address' },
        legal_form:           { type: 'string', description: 'Legal form e.g. BV, NV, Ltd, GmbH' },
        sector:               { type: 'string', description: 'Business sector/industry' },
        lei_code:             { type: 'string', description: 'LEI code if present, else null' },
        confidence:           { type: 'number', description: 'Overall extraction confidence 0-100' },
        warnings:             { type: 'array', items: { type: 'string' }, description: 'Any concerns about the document' },
      },
    };
  } else {
    // Generic extraction for other document types
    systemContext = `You are a KYC document processing specialist. Extract any KYC-relevant data from this document that could be used to populate a client profile.`;
    schema = {
      type: 'object',
      properties: {
        full_name:           { type: 'string' },
        date_of_birth:       { type: 'string' },
        nationality:         { type: 'string' },
        id_number:           { type: 'string' },
        registration_number: { type: 'string' },
        registered_country:  { type: 'string' },
        registered_address:  { type: 'string' },
        confidence:          { type: 'number', description: 'Overall extraction confidence 0-100' },
        warnings:            { type: 'array', items: { type: 'string' } },
      },
    };
  }

  const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: `${systemContext}\n\nDocument type: ${doc_type.replace(/_/g, ' ')}\nClient type: ${client_type || 'unknown'}\n\nExtract all relevant KYC data fields from the document image provided. For any field you cannot read clearly, return null rather than guessing. Include a confidence score (0-100) for the overall extraction quality.`,
    file_urls: [file_url],
    response_json_schema: { type: 'object', properties: schema.properties },
  });

  // Strip null values so front-end only sees populated fields
  const cleaned = {};
  for (const [k, v] of Object.entries(result)) {
    if (v !== null && v !== undefined && v !== '' && k !== 'warnings' && k !== 'confidence') {
      cleaned[k] = v;
    }
  }

  return Response.json({
    extracted: cleaned,
    confidence: result.confidence ?? null,
    warnings: result.warnings ?? [],
    doc_type,
  });
});