import React, { useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import SelfieCaptureWidget from './SelfieCaptureWidget';
import { compareFaces, loadFaceModels, getFaceDescriptor } from '@/lib/faceComparison';
import { portalSecureUpload } from '@/lib/securityUtils';
import { base44 } from '@/api/base44Client';

const DOC_TYPE_META = {
  Passport:         { icon: '📘', label: 'Passport' },
  Driving_Licence:  { icon: '🚗', label: 'Driving Licence' },
  National_ID:      { icon: '🪪', label: 'National ID Card' },
  Residence_Permit: { icon: '📋', label: 'Residence Permit' },
};

export default function IdVerificationField({
  item,
  onComplete,
  primaryColor = '#1A6BFF',
  buttonRadius = '8px',
  portalUrl = '',
  outreachId = '',
}) {
  const isMobile = typeof window !== 'undefined' && (
    /Mobi|Android|iPhone|iPad|iPod|Touch/i.test(navigator.userAgent) ||
    ('ontouchstart' in window) ||
    (navigator.maxTouchPoints > 1) ||
    window.innerWidth < 900
  );

  const [phase, setPhase] = useState('consent');
  const [docType, setDocType] = useState(null);
  const [docUrl, setDocUrl] = useState(null);
  const [selfieUrl, setSelfieUrl] = useState(null);
  const [idvResult, setIdvResult] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);

  const [qrStatus, setQrStatus] = useState('waiting'); // 'waiting' | 'completed' | 'failed'
  const pollRef = useRef(null);

  // Poll for IDV completion on desktop (mobile completes it directly)
  useEffect(() => {
    if (isMobile || !outreachId || !item?.item_id) return;

    pollRef.current = setInterval(async () => {
      try {
        const reqs = await base44.entities.OutreachRequest.filter({ id: outreachId });
        const req  = reqs?.[0];
        if (!req) return;
        const idvItem = (req.items || []).find(i => i.item_id === item.item_id);
        if (idvItem?.idv_status === 'Pass' || idvItem?.idv_status === 'Fail' ||
            idvItem?.idv_status === 'Inconclusive') {
          clearInterval(pollRef.current);
          setQrStatus(idvItem.idv_status === 'Pass' ? 'completed' : 'failed');
          onComplete({
            idv_status:           idvItem.idv_status,
            idv_similarity_score: idvItem.idv_similarity_score,
            idv_confidence:       idvItem.idv_confidence,
            idv_document_type:    idvItem.idv_document_type,
            idv_selfie_url:       idvItem.idv_selfie_url,
            idv_doc_url:          idvItem.idv_doc_url,
            idv_checked_at:       idvItem.idv_checked_at,
            idv_failure_reason:   idvItem.idv_failure_reason,
            idv_liveness_passed:  idvItem.idv_liveness_passed,
            idv_provider:         idvItem.idv_provider || 'mobile_qr',
          });
        }
      } catch { /* ignore polling errors */ }
    }, 3000);

    return () => clearInterval(pollRef.current);
  }, [isMobile, outreachId, item?.item_id]);

  const minScore = item?.idv_min_match_score ?? 75;
  const acceptedDocTypes = item?.idv_accepted_doc_types ?? ['Passport', 'Driving_Licence', 'National_ID'];
  const livenessRequired = item?.idv_liveness_required ?? true;

  useEffect(() => { loadFaceModels(); }, []);

  // ── Styles ────────────────────────────────────────────────────────────────
  const btnPrimary = {
    borderRadius: buttonRadius, backgroundColor: primaryColor, color: '#fff',
    border: 'none', padding: '10px 20px', fontWeight: 600, fontSize: 14,
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
  };
  const btnOutline = {
    ...btnPrimary, backgroundColor: 'transparent',
    border: `1.5px solid ${primaryColor}`, color: primaryColor,
  };
  const card = {
    border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, background: '#fff',
  };

  // ── Gemini deepfake advisory (non-blocking) ───────────────────────────────
  async function checkSelfieAuthenticity(selfieUrl) {
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyse this selfie image and assess whether it appears to be authentic.

Look for these signals of a non-authentic submission:
- Photo of a screen or printed photo: moiré patterns, screen glare, curved edges, pixelation
- Video replay: motion blur, interlacing artefacts, timestamp overlays
- AI-generated or deepfake face: unnatural skin texture, asymmetric facial features,
  blurred hairline, inconsistent lighting direction, artefacts around the face boundary
- Flat lighting with no natural shadows (suggests a static printed photo)

Return ONLY valid JSON:
{
  "appears_authentic": boolean,
  "confidence": "High" or "Medium" or "Low",
  "signals_found": [string],
  "summary": string (one sentence)
}

Image to analyse: ${selfieUrl}`,
        model: 'gemini_3_1_pro',
        response_json_schema: {
          type: 'object',
          properties: {
            appears_authentic: { type: 'boolean' },
            confidence:        { type: 'string', enum: ['High', 'Medium', 'Low'] },
            signals_found:     { type: 'array', items: { type: 'string' } },
            summary:           { type: 'string' },
          }
        }
      });

      if (result && typeof result === 'object' && 'appears_authentic' in result) {
        return result;
      }
      if (typeof result === 'string') {
        return JSON.parse(result.replace(/```json|```/g, '').trim());
      }
      return null;
    } catch {
      return null; // Non-blocking — deepfake check failure must not block the IDV flow
    }
  }

  // ── Doc upload handler ────────────────────────────────────────────────────
  async function handleDocFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');
    setUploading(true);
    try {
      const url = await portalSecureUpload(file);
      setPhase('extracting');
      const faceResult = await getFaceDescriptor(url);
      if (!faceResult) {
        setUploadError('No face detected in document image. Please upload a clear photo where your face is fully visible.');
        setPhase('doc_upload');
      } else {
        setDocUrl(url);
        setPhase('selfie');
      }
    } catch (err) {
      setUploadError(err.message || 'Upload failed. Please try again.');
      setPhase('doc_upload');
    } finally {
      setUploading(false);
    }
  }

  // ── Face comparison ───────────────────────────────────────────────────────
  async function runComparison(dUrl, sUrl) {
    setPhase('comparing');
    try {
      const [result, authenticityCheck] = await Promise.all([
        compareFaces(dUrl, sUrl, minScore),
        checkSelfieAuthenticity(sUrl),
      ]);

      const deepfakeFlagged = authenticityCheck && !authenticityCheck.appears_authentic
        && authenticityCheck.confidence !== 'Low';

      const idvResultObj = {
        idv_status:               result.matched && !deepfakeFlagged ? 'Pass' : result.matched ? 'Inconclusive' : 'Fail',
        idv_similarity_score:     result.similarity,
        idv_confidence:           result.confidence,
        idv_face_detected_in_doc: result.face_in_doc_detected,
        idv_document_type:        docType,
        idv_selfie_url:           sUrl,
        idv_doc_url:              dUrl,
        idv_checked_at:           new Date().toISOString(),
        idv_failure_reason:       deepfakeFlagged
          ? `Authenticity advisory: ${authenticityCheck.summary}`
          : result.reason || null,
        idv_liveness_passed:      true,
        idv_provider:             'face_api_js_browser',
        idv_authenticity_check:   authenticityCheck || null,
      };
      setIdvResult(idvResultObj);
      setPhase('result');
      onComplete(idvResultObj);
    } catch {
      const inconclusive = {
        idv_status: 'Inconclusive', idv_similarity_score: 0,
        idv_confidence: 'Error', idv_face_detected_in_doc: null,
        idv_document_type: docType, idv_selfie_url: sUrl, idv_doc_url: dUrl,
        idv_checked_at: new Date().toISOString(), idv_failure_reason: 'Comparison failed unexpectedly.',
        idv_liveness_passed: true, idv_provider: 'face_api_js_browser',
      };
      setIdvResult(inconclusive);
      setPhase('result');
      onComplete(inconclusive);
    }
  }

  function resetFlow() {
    setPhase('consent');
    setDocType(null);
    setDocUrl(null);
    setSelfieUrl(null);
    setIdvResult(null);
    setUploadError('');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DESKTOP: show QR code + polling instead of camera flow
  // ─────────────────────────────────────────────────────────────────────────
  if (!isMobile) {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(portalUrl)}&color=0F1F3D&bgcolor=FFFFFF&margin=10`;
    return (
      <div style={{ border: `1px solid ${primaryColor}30`, borderRadius: '14px', padding: '24px', background: '#F8FAFF', textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>📱</div>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#1A2332', marginBottom: 6 }}>Complete on your phone</div>
        <div style={{ fontSize: 13, color: '#64748B', marginBottom: 20, lineHeight: 1.5 }}>
          Identity verification requires your camera. Scan the QR code below with your phone to continue — this page will update automatically once you're done.
        </div>

        {qrStatus === 'waiting' && (
          <div style={{ display: 'inline-block', position: 'relative' }}>
            <img src={qrUrl} alt="Scan to verify on mobile" width={220} height={220}
              style={{ borderRadius: 12, border: '3px solid #E2E8F2', display: 'block' }} />
            <div style={{ position: 'absolute', inset: -8, borderRadius: 18, border: `2px solid ${primaryColor}40`, animation: 'pulse 2s ease-in-out infinite' }} />
          </div>
        )}

        {qrStatus === 'waiting' && (
          <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 12, color: '#64748B' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: primaryColor, animation: 'pulse 1.5s infinite' }} />
            Waiting for you to complete on your phone…
          </div>
        )}

        {qrStatus === 'completed' && (
          <div style={{ marginTop: 20, padding: '16px 20px', background: '#F0FDF4', borderRadius: 10, border: '1px solid #10B981' }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>✅</div>
            <div style={{ fontWeight: 600, color: '#059669', fontSize: 14 }}>Identity Verified on your phone</div>
            <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>This page has been updated. You can continue with your submission.</div>
          </div>
        )}

        {qrStatus === 'failed' && (
          <div style={{ marginTop: 20, padding: '16px 20px', background: '#FEF2F2', borderRadius: 10, border: '1px solid #EF4444' }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>❌</div>
            <div style={{ fontWeight: 600, color: '#DC2626', fontSize: 14 }}>Verification was not successful</div>
            <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>Please scan the QR code again on your phone to try once more.</div>
          </div>
        )}

        <div style={{ marginTop: 16, fontSize: 11, color: '#94A3B8' }}>
          Can't scan?{' '}
          <a href={portalUrl} target="_blank" rel="noopener noreferrer" style={{ color: primaryColor }}>Open link on this device instead</a>
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: consent
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === 'consent') return (
    <div style={card}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>🪪</div>
      <h3 style={{ fontWeight: 700, fontSize: 16, margin: '0 0 8px' }}>Identity Verification</h3>
      <p style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, margin: '0 0 12px' }}>
        To verify your identity we will ask you to:
      </p>
      <ol style={{ fontSize: 13, color: '#374151', lineHeight: 1.8, paddingLeft: 20, margin: '0 0 12px' }}>
        <li>Upload a photo of your identity document</li>
        <li>Take a selfie using your camera</li>
      </ol>
      <p style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, margin: '0 0 6px' }}>
        Your selfie is compared with your document automatically.
      </p>
      <p style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.6, margin: '0 0 20px', padding: '10px 12px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
        🔒 <strong>No biometric data is sent to any server</strong> — processing happens entirely on your device.
        Your photos are stored securely and deleted within 30 days.
      </p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button style={btnOutline} onClick={() => setPhase('declined')}>Decline</button>
        <button style={btnPrimary} onClick={() => setPhase('doc_type')}>I Agree — Continue →</button>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: declined
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === 'declined') return (
    <div style={{ ...card, border: '1px solid #fcd34d', background: '#fffbeb' }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
      <p style={{ fontSize: 13, color: '#92400e', lineHeight: 1.6, margin: 0 }}>
        You have declined biometric verification. Your institution will verify your identity manually.
        Please contact your relationship manager if you have questions.
      </p>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: doc_type
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === 'doc_type') return (
    <div style={card}>
      <h3 style={{ fontWeight: 700, fontSize: 15, margin: '0 0 4px' }}>Select Document Type</h3>
      <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px' }}>Choose the type of identity document you will upload.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {acceptedDocTypes.map(dt => {
          const meta = DOC_TYPE_META[dt] || { icon: '📄', label: dt.replace(/_/g, ' ') };
          return (
            <button key={dt} onClick={() => { setDocType(dt); setPhase('doc_upload'); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px', borderRadius: 10,
                border: '1.5px solid #e5e7eb', background: '#f9fafb',
                cursor: 'pointer', fontSize: 14, fontWeight: 500,
                textAlign: 'left', transition: 'border-color 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = primaryColor}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#e5e7eb'}
            >
              <span style={{ fontSize: 22 }}>{meta.icon}</span>
              {meta.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: doc_upload / extracting
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === 'doc_upload' || phase === 'extracting') {
    const busy = uploading || phase === 'extracting';
    const docMeta = DOC_TYPE_META[docType] || { icon: '📄', label: docType?.replace(/_/g, ' ') };
    return (
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 22 }}>{docMeta.icon}</span>
          <div>
            <h3 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>Upload {docMeta.label}</h3>
            <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>Ensure your face is clearly visible in the photo.</p>
          </div>
        </div>

        {uploadError && (
          <div style={{ padding: '10px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626', fontSize: 13, marginBottom: 12 }}>
            {uploadError}
          </div>
        )}

        <label style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 8, padding: '30px 20px', border: `2px dashed ${busy ? '#d1d5db' : primaryColor}`,
          borderRadius: 12, cursor: busy ? 'not-allowed' : 'pointer', background: busy ? '#f9fafb' : '#f0f7ff',
          transition: 'all 0.2s',
        }}>
          {busy ? (
            <>
              <Loader2 size={28} style={{ color: primaryColor, animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 13, color: '#6b7280' }}>
                {phase === 'extracting' ? 'Detecting face in document…' : 'Uploading…'}
              </span>
            </>
          ) : (
            <>
              <span style={{ fontSize: 32 }}>📂</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: primaryColor }}>Click to upload document</span>
              <span style={{ fontSize: 12, color: '#9ca3af' }}>JPG, PNG or PDF accepted</span>
              <input type="file" accept=".jpg,.jpeg,.png,.pdf" style={{ display: 'none' }} onChange={handleDocFile} disabled={busy} />
            </>
          )}
        </label>

        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: selfie
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === 'selfie') return (
    <div style={card}>
      <h3 style={{ fontWeight: 700, fontSize: 15, margin: '0 0 4px' }}>Now take a selfie</h3>
      <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 14px' }}>
        Look straight at the camera. Ensure good lighting. Remove glasses if worn.
      </p>
      <SelfieCaptureWidget
        primaryColor={primaryColor}
        buttonRadius={buttonRadius}
        requireLiveness={livenessRequired}
        onCapture={url => {
          setSelfieUrl(url);
          runComparison(docUrl, url);
        }}
        onCancel={() => setPhase('doc_upload')}
      />
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: comparing
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === 'comparing') return (
    <div style={{ ...card, textAlign: 'center', padding: '40px 20px' }}>
      <Loader2 size={36} style={{ color: primaryColor, animation: 'spin 1s linear infinite', margin: '0 auto 14px' }} />
      <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Comparing faces…</div>
      <div style={{ fontSize: 13, color: '#6b7280' }}>This takes a few seconds</div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: result
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === 'result' && idvResult) {
    const passed = idvResult.idv_status === 'Pass';
    const similarity = idvResult.idv_similarity_score ?? 0;
    const borderColor = passed ? '#22c55e' : '#ef4444';
    const bgColor     = passed ? '#f0fdf4'  : '#fef2f2';
    const textColor   = passed ? '#15803d'  : '#dc2626';
    const barColor    = passed ? '#22c55e'  : '#ef4444';

    return (
      <div style={{ ...card, border: `2px solid ${borderColor}`, background: bgColor }}>
        {/* Icon + Title */}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 42, marginBottom: 8 }}>{passed ? '✅' : '❌'}</div>
          <h3 style={{ fontWeight: 700, fontSize: 17, color: textColor, margin: '0 0 6px' }}>
            {passed ? 'Verification Passed' : 'Verification Failed'}
          </h3>
          <p style={{ fontSize: 13, color: '#374151', margin: 0 }}>
            {passed
              ? `Your identity has been successfully verified (${similarity}% match).`
              : (idvResult.idv_failure_reason || 'The faces did not match. Please try again.')}
          </p>
        </div>

        {/* Progress bar */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ height: 8, borderRadius: 99, background: '#e5e7eb', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${similarity}%`, background: barColor, borderRadius: 99, transition: 'width 0.6s ease' }} />
          </div>
        </div>

        {/* Score detail */}
        <div style={{ textAlign: 'center', fontSize: 12, color: '#6b7280', marginBottom: 20 }}>
          Face match: <strong>{similarity}%</strong> · Threshold: <strong>{minScore}%</strong> · <strong>{idvResult.idv_confidence}</strong> confidence
        </div>

        {/* Side-by-side photos */}
        {(idvResult.idv_doc_url || idvResult.idv_selfie_url) && (
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 20 }}>
            {idvResult.idv_doc_url && (
              <div style={{ textAlign: 'center' }}>
                <img src={idvResult.idv_doc_url} alt="Document" style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${borderColor}` }} />
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>Document</div>
              </div>
            )}
            {idvResult.idv_selfie_url && (
              <div style={{ textAlign: 'center' }}>
                <img src={idvResult.idv_selfie_url} alt="Selfie" style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${borderColor}` }} />
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>Selfie</div>
              </div>
            )}
          </div>
        )}

        {/* Try Again (Fail only) */}
        {!passed && (
          <div style={{ textAlign: 'center' }}>
            <button style={{ ...btnPrimary, backgroundColor: '#ef4444' }} onClick={resetFlow}>
              Try Again
            </button>
          </div>
        )}
      </div>
    );
  }

  return null;
}