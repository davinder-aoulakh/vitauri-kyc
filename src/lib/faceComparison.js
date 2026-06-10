import * as faceapi from 'face-api.js';

let modelsLoaded = false;

export async function loadFaceModels() {
  if (modelsLoaded) return;
  await Promise.all([
    faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
    faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
    faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
  ]);
  modelsLoaded = true;
}

export async function getFaceDescriptor(imageUrl) {
  await loadFaceModels();
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