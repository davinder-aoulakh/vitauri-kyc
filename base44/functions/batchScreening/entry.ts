import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Batch Screening Function
 * Accepts an array of entities (name, type, country, dob/reg) and runs
 * AI-powered screening against conceptual global sanction lists (PEP, EU/UN sanctions,
 * adverse media). Returns a hits array per entity.
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { entities, tenant_id } = await req.json();
  if (!entities || !Array.isArray(entities) || entities.length === 0) {
    return Response.json({ error: 'entities array is required' }, { status: 400 });
  }

  // Chunk into batches of 10 to stay within prompt limits
  const CHUNK = 10;
  const allResults = [];

  for (let i = 0; i < entities.length; i += CHUNK) {
    const chunk = entities.slice(i, i + CHUNK);

    const entitiesJson = JSON.stringify(chunk.map((e, idx) => ({
      index: i + idx,
      name: e.name,
      type: e.type,           // NP or ORG
      country: e.country || '',
      dob: e.dob || '',
      registration_number: e.registration_number || '',
    })), null, 2);

    const prompt = `You are a financial crime compliance specialist performing batch AML/KYC screening against global sanction lists and adverse media.

For each entity below, assess whether it is likely to appear on any of these lists:
- OFAC SDN (US Treasury sanctions)
- EU Consolidated Sanctions List
- UN Security Council Sanctions List
- UK OFSI Sanctions List
- PEP (Politically Exposed Persons) databases
- Adverse media / financial crime news

Entities to screen:
${entitiesJson}

For each entity, respond with a screening result. Be conservative — flag anything that could plausibly be a match. Consider fuzzy name matching, similar entities from the same country, and known aliases.

Return a JSON object with a "results" array. Each item must have:
{
  "index": number,            // same index from input
  "name": string,             // entity name echoed back
  "hit": boolean,             // true if any potential match found
  "risk_level": "Low" | "Medium" | "High" | "Unacceptable",
  "hits": [                   // array of hits (empty if none)
    {
      "source": "Sanctions_EU" | "Sanctions_UN" | "PEP_List" | "Adverse_Media" | "Internal_Flag",
      "hit_name": string,     // name of the matched entry
      "confidence_score": number,  // 0-100
      "ai_recommendation": "Likely_False_Positive" | "Possible_Match" | "Confirmed_Match",
      "ai_rationale": string  // brief explanation (1-2 sentences)
    }
  ],
  "summary": string           // brief overall assessment (1 sentence)
}`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'number' },
                name: { type: 'string' },
                hit: { type: 'boolean' },
                risk_level: { type: 'string' },
                hits: { type: 'array', items: { type: 'object' } },
                summary: { type: 'string' },
              },
            },
          },
        },
      },
    });

    if (result?.results) {
      allResults.push(...result.results);
    }
  }

  return Response.json({ results: allResults });
});