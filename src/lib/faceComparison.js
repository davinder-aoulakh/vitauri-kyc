import { base44 } from '@/api/base44Client';

// ── Helpers ─────────────────────────────────────────────────────────────────

export function scoreToLabel(similarity) {
  if (similarity >= 88) return 'Very High';
  if (similarity >= 75) return 'High';
  if (similarity >= 60) return 'Medium';
  return 'Low';
}

// No-op — kept so existing useEffect(() => { loadFaceModels() }) calls don't break
export async function loadFaceModels() { return true; }

// ── Step 1: Verify a face exists in an image ─────────────────────────────────
// Called with document image — confirms face is present before asking for selfie.

export async function getFaceDescriptor(imageUrl) {
  try {
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are an identity document analyser.
Look at this image. It may be a passport, driving licence, or national ID card.

Answer these questions:
1. Is there a human face visible in the image?
2. If it is an identity document, focus only on the portrait/photo section.
3. Describe the face in detail: face shape, skin tone, approximate age range,
   eye shape and colour, nose shape, lip shape, any distinctive features
   (facial hair, scars, glasses, etc.).

Return ONLY valid JSON:
{
  "face_present": boolean,
  "is_identity_document": boolean,
  "confidence": "High" | "Medium" | "Low",
  "face_description": string
}`,
      file_urls: [imageUrl],
      model: 'gemini_3_1_pro',
      response_json_schema: {
        type: 'object',
        properties: {
          face_present:          { type: 'boolean' },
          is_identity_document:  { type: 'boolean' },
          confidence:            { type: 'string' },
          face_description:      { type: 'string' },
        }
      }
    });

    if (!result?.face_present) return null;

    return {
      face_present:     true,
      confidence:       result.confidence,
      face_description: result.face_description || '',
      imageUrl,
    };
  } catch {
    return null;
  }
}

// ── Step 2: Compare document face against a selfie ───────────────────────────
// Uses the face description from Step 1 to compare with the selfie image.
// Gemini sees the selfie image + the text description of the document face.

export async function compareFaces(documentImageUrl, selfieImageUrl, minMatchScore = 75) {

  // Step 1 — verify and describe the document face
  let docFace = null;
  try {
    docFace = await getFaceDescriptor(documentImageUrl);
  } catch { /* handled below */ }

  if (!docFace) return {
    matched: false, similarity: 0, confidence: 'Error',
    face_in_doc_detected:    false,
    face_in_selfie_detected: false,
    reason: 'No face detected in the document. Please upload a clear, '
          + 'well-lit photo of your identity document with all four corners visible.',
    provider: 'gemini_vision',
  };

  // Step 2 — compare selfie against the document face description
  try {
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a biometric identity verification assistant.

The identity document shows a person with these facial features:
"${docFace.face_description}"

Now look at this selfie photo.

Compare the selfie carefully against the description above:
- Overall face shape and proportions
- Eye shape, spacing, and colour
- Nose shape and width  
- Mouth and lip shape
- Skin tone
- Any distinctive features (facial hair, scars, marks, glasses)
- Approximate age consistency

Give a similarity score from 0 to 100:
  90-100 = Almost certainly the same person
  75-89  = Very likely the same person  
  60-74  = Possibly the same person, some differences
  40-59  = Uncertain, significant differences
  0-39   = Likely different people

Return ONLY valid JSON:
{
  "face_present_in_selfie": boolean,
  "same_person": boolean,
  "similarity_score": number,
  "confidence": "High" | "Medium" | "Low",
  "matching_features": [string],
  "concerns": [string],
  "summary": string
}`,
      file_urls: [selfieImageUrl],
      model: 'gemini_3_1_pro',
      response_json_schema: {
        type: 'object',
        properties: {
          face_present_in_selfie: { type: 'boolean' },
          same_person:            { type: 'boolean' },
          similarity_score:       { type: 'number'  },
          confidence:             { type: 'string'  },
          matching_features:      { type: 'array', items: { type: 'string' } },
          concerns:               { type: 'array', items: { type: 'string' } },
          summary:                { type: 'string'  },
        }
      }
    });

    if (!result?.face_present_in_selfie) return {
      matched: false, similarity: 0, confidence: 'Error',
      face_in_doc_detected:    true,
      face_in_selfie_detected: false,
      reason: 'No face detected in the selfie. Please retake the photo '
            + 'with your full face clearly visible in good lighting.',
      provider: 'gemini_vision',
    };

    const score   = Math.round(result?.similarity_score ?? 0);
    const matched = score >= minMatchScore;

    return {
      matched,
      similarity:              score,
      confidence:              result?.confidence || scoreToLabel(score),
      face_in_doc_detected:    true,
      face_in_selfie_detected: true,
      matched_features:        result?.matching_features || [],
      concerns:                result?.concerns          || [],
      summary:                 result?.summary           || '',
      reason: matched
        ? null
        : `Match score ${score}% is below the required threshold of ${minMatchScore}%.`,
      provider:    'gemini_vision',
      checked_at:  new Date().toISOString(),
    };

  } catch (err) {
    return {
      matched: false, similarity: 0, confidence: 'Error',
      face_in_doc_detected:    true,
      face_in_selfie_detected: false,
      reason: 'Comparison failed. Please try again.',
      provider: 'gemini_vision',
    };
  }
}