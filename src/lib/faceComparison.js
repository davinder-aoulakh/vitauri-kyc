import * as faceapi from 'face-api.js';

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights';

let modelsLoaded   = false;
let tinyLoaded     = false;

// ── Model loading ──────────────────────────────────────────────────────────

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
    throw new Error('Face models failed to load. Please check your internet connection and try again.');
  }
}

async function loadTinyDetector() {
  if (tinyLoaded) return;
  await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
  tinyLoaded = true;
}

// ── CORS-safe image loader ─────────────────────────────────────────────────
// faceapi.fetchImage fails on CORS-restricted storage URLs.
// This loads via HTMLImageElement (no CORS request) and draws to canvas
// so face-api can use it as input.

async function loadImageForDetection(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Try with crossOrigin first (works if server sends CORS headers)
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => {
      // Retry without crossOrigin (works if server blocks CORS but allows direct load)
      const img2 = new Image();
      img2.onload = () => resolve(img2);
      img2.onerror = () => reject(new Error('Could not load image'));
      img2.src = url + (url.includes('?') ? '&' : '?') + '_nc=' + Date.now();
    };
    img.src = url;
  });
}

// ── Resize helper ─────────────────────────────────────────────────────────
// Passport scans are often 2000-3500px wide. The face occupies ~10-15% of
// the image, making it too small for reliable detection at full resolution.
// Resize to max 800px so the face region fills more of the detection window.

function resizeImageToCanvas(img, maxSize = 800) {
  const canvas = document.createElement('canvas');
  const scale  = Math.min(1, maxSize / Math.max(img.width || img.naturalWidth, img.height || img.naturalHeight));
  canvas.width  = (img.width  || img.naturalWidth)  * scale;
  canvas.height = (img.height || img.naturalHeight) * scale;
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// ── Core face descriptor extraction ───────────────────────────────────────

export async function getFaceDescriptor(imageUrl) {
  try { await loadFaceModels(); } catch { return null; }

  let rawImg;
  try {
    rawImg = await loadImageForDetection(imageUrl);
  } catch {
    // Last resort: try faceapi's own fetcher
    try { rawImg = await faceapi.fetchImage(imageUrl); } catch { return null; }
  }

  // Resize to 800px max — critical for passport/ID document scans
  const img = resizeImageToCanvas(rawImg, 800);

  // ── Attempt 1: SSD at low threshold (0.2) — good for frontal passport faces
  try {
    const det = await faceapi
      .detectSingleFace(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (det) {
      return { descriptor: det.descriptor, confidence: det.detection.score, boundingBox: det.detection.box };
    }
  } catch { /* fall through */ }

  // ── Attempt 2: SSD at even lower threshold (0.1) with larger image
  try {
    const bigImg = resizeImageToCanvas(rawImg, 1200);
    const det = await faceapi
      .detectSingleFace(bigImg, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.1 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (det) {
      return { descriptor: det.descriptor, confidence: det.detection.score, boundingBox: det.detection.box };
    }
  } catch { /* fall through */ }

  // ── Attempt 3: TinyFaceDetector — faster, often better for small faces in documents
  try {
    await loadTinyDetector();
    // Try two input sizes — 416 and 608 catch faces at different scales
    for (const inputSize of [416, 608]) {
      const det = await faceapi
        .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold: 0.3 }))
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (det) {
        return { descriptor: det.descriptor, confidence: det.detection.score, boundingBox: det.detection.box };
      }
    }
  } catch { /* fall through */ }

  // All attempts failed
  return null;
}

// ── Face comparison ────────────────────────────────────────────────────────

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
    reason: 'No face detected in the document. Please upload a clear, well-lit photo ' +
            'of your document with no glare. Ensure all four corners are visible.',
    provider: 'face_api_js_browser',
  };

  if (!selfieFace) return {
    matched: false, similarity: 0, confidence: 'Error',
    face_in_doc_detected: true, face_in_selfie_detected: false,
    reason: 'No face detected in the selfie. Please retake in good lighting with ' +
            'your full face clearly visible.',
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
    reason: matched
      ? null
      : `Match score ${similarity}% is below the required threshold of ${minMatchScore}%.`,
    provider: 'face_api_js_browser',
    checked_at: new Date().toISOString(),
  };
}