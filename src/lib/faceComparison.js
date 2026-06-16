import * as faceapi from 'face-api.js';

let modelsLoaded = false;

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights';

export async function loadFaceModels() {
  if (modelsLoaded) return;
  try {
    await Promise.all([
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
    ]);
    modelsLoaded = true;
  } catch (err) {
    modelsLoaded = false;
    throw new Error('Face recognition models failed to load. Please check your internet connection and try again.');
  }
}

export async function getFaceDescriptor(imageUrl) {
  try {
    await loadFaceModels();
  } catch (err) {
    return null; // caller handles null as "no face detected"
  }
  try {
    const img = await faceapi.fetchImage(imageUrl);
    const detection = await faceapi
      .detectSingleFace(img)
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (!detection) return null;
    return {
      descriptor: detection.descriptor,
      confidence: detection.detection.score,
      boundingBox: detection.detection.box,
    };
  } catch {
    return null;
  }
}

export function scoreToLabel(similarity) {
  if (similarity >= 88) return 'Very High';
  if (similarity >= 75) return 'High';
  if (similarity >= 60) return 'Medium';
  return 'Low';
}

export async function compareFaces(documentImageUrl, selfieImageUrl, minMatchScore = 75) {
  await loadFaceModels();

  const [docResult, selfieResult] = await Promise.allSettled([
    getFaceDescriptor(documentImageUrl),
    getFaceDescriptor(selfieImageUrl),
  ]);

  const docFace    = docResult.status    === 'fulfilled' ? docResult.value    : null;
  const selfieFace = selfieResult.status === 'fulfilled' ? selfieResult.value : null;

  if (!docFace) return {
    matched: false, similarity: 0, confidence: 'Error',
    face_in_doc_detected: false, face_in_selfie_detected: !!selfieFace,
    reason: 'No face detected in the document. Please ensure the document photo is clear and try again.',
    provider: 'face_api_js_browser',
  };

  if (!selfieFace) return {
    matched: false, similarity: 0, confidence: 'Error',
    face_in_doc_detected: true, face_in_selfie_detected: false,
    reason: 'No face detected in the selfie. Please retake with your full face visible.',
    provider: 'face_api_js_browser',
  };

  const distance   = faceapi.euclideanDistance(docFace.descriptor, selfieFace.descriptor);
  const similarity = Math.round(Math.max(0, (1 - distance / 0.9)) * 100);
  const matched    = similarity >= minMatchScore;

  return {
    matched,
    similarity,
    distance:                Math.round(distance * 1000) / 1000,
    confidence:              scoreToLabel(similarity),
    face_in_doc_detected:    true,
    face_in_selfie_detected: true,
    reason: matched ? null : `Match score ${similarity}% is below the required threshold of ${minMatchScore}%.`,
    provider: 'face_api_js_browser',
    checked_at: new Date().toISOString(),
  };
}