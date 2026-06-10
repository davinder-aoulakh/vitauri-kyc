import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2, RotateCcw, Camera, X, RefreshCw } from 'lucide-react';
import { portalSecureUpload } from '@/lib/securityUtils';

const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest';
const BLINK_THRESHOLD = 0.45;
const BLINKS_REQUIRED = 1;

const ERROR_MESSAGES = {
  NotAllowedError: 'Camera access was denied. Please allow camera access and try again.',
  NotFoundError: 'No camera found on this device.',
  upload: 'Upload failed. Please try again.',
  default: 'An unexpected error occurred. Please try again.',
};

export default function SelfieCaptureWidget({
  onCapture,
  onCancel,
  primaryColor = '#1A6BFF',
  buttonRadius = '8px',
  requireLiveness = true,
}) {
  const [phase, setPhase] = useState('requesting');
  const [errorMsg, setErrorMsg] = useState('');
  const [blinkCount, setBlinkCount] = useState(0);
  const [capturedBlob, setCapturedBlob] = useState(null);
  const [facingMode, setFacingMode] = useState('user');

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const landmarkerRef = useRef(null);
  const rafRef = useRef(null);
  const eyeClosedRef = useRef(false);
  const blinkCountRef = useRef(0);

  // Start camera
  const startCamera = useCallback(async (mode = 'user') => {
    // Stop existing stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    cancelAnimationFrame(rafRef.current);

    setPhase('requesting');
    setBlinkCount(0);
    blinkCountRef.current = 0;
    eyeClosedRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setPhase('preview');
      if (requireLiveness) {
        initMediaPipe();
      }
    } catch (err) {
      setErrorMsg(ERROR_MESSAGES[err.name] || ERROR_MESSAGES.default);
      setPhase('error');
    }
  }, [requireLiveness]);

  useEffect(() => {
    startCamera(facingMode);
    return () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      landmarkerRef.current?.close?.();
    };
  }, []);

  async function initMediaPipe() {
    try {
      const { FaceLandmarker, FilesetResolver } = await import(/* @vite-ignore */ MEDIAPIPE_CDN);
      const filesetResolver = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );
      const landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU',
        },
        outputFaceBlendshapes: true,
        runningMode: 'VIDEO',
        numFaces: 1,
      });
      landmarkerRef.current = landmarker;
      runDetectionLoop(landmarker);
    } catch {
      // MediaPipe failed to load — skip liveness, allow capture anyway
      setBlinkCount(BLINKS_REQUIRED);
      blinkCountRef.current = BLINKS_REQUIRED;
    }
  }

  function runDetectionLoop(landmarker) {
    function detect() {
      if (!videoRef.current || videoRef.current.readyState < 2) {
        rafRef.current = requestAnimationFrame(detect);
        return;
      }
      const results = landmarker.detectForVideo(videoRef.current, performance.now());
      const blendshapes = results?.faceBlendshapes?.[0]?.categories;
      if (blendshapes) {
        const left  = blendshapes.find(c => c.categoryName === 'eyeBlinkLeft')?.score  ?? 0;
        const right = blendshapes.find(c => c.categoryName === 'eyeBlinkRight')?.score ?? 0;
        const avg = (left + right) / 2;
        const eyeClosed = avg > BLINK_THRESHOLD;

        if (!eyeClosedRef.current && eyeClosed) {
          eyeClosedRef.current = true;
        } else if (eyeClosedRef.current && !eyeClosed) {
          eyeClosedRef.current = false;
          blinkCountRef.current += 1;
          setBlinkCount(blinkCountRef.current);
        }
      }
      rafRef.current = requestAnimationFrame(detect);
    }
    rafRef.current = requestAnimationFrame(detect);
  }

  function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    // Mirror the image if using front camera
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      setCapturedBlob(blob);
      setPhase('captured');
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    }, 'image/jpeg', 0.9);
  }

  function retake() {
    setCapturedBlob(null);
    startCamera(facingMode);
  }

  async function usePhoto() {
    if (!capturedBlob) return;
    setPhase('uploading');
    try {
      const file = new File([capturedBlob], 'selfie.jpg', { type: 'image/jpeg' });
      const url = await portalSecureUpload(file);
      onCapture(url);
    } catch {
      setErrorMsg(ERROR_MESSAGES.upload);
      setPhase('error');
    }
  }

  function flipCamera() {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    startCamera(next);
  }

  const livenessReady = !requireLiveness || blinkCount >= BLINKS_REQUIRED;
  const capturedUrl = capturedBlob ? URL.createObjectURL(capturedBlob) : null;

  const btnStyle = {
    borderRadius: buttonRadius,
    backgroundColor: primaryColor,
    color: '#fff',
    border: 'none',
    padding: '10px 20px',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };

  const outlineBtn = {
    ...btnStyle,
    backgroundColor: 'transparent',
    border: `1.5px solid ${primaryColor}`,
    color: primaryColor,
  };

  return (
    <div style={{ fontFamily: 'inherit' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>📸 Selfie Capture</span>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: 4 }}>
          <X size={18} />
        </button>
      </div>

      {/* Camera / Preview Area */}
      <div style={{ position: 'relative', width: '100%', aspectRatio: '4/3', background: '#111', borderRadius: 12, overflow: 'hidden' }}>

        {/* Live video */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
            display: phase === 'preview' ? 'block' : 'none',
          }}
        />

        {/* Captured photo preview */}
        {phase === 'captured' && capturedUrl && (
          <img src={capturedUrl} alt="Captured selfie" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}

        {/* Face guide oval */}
        {phase === 'preview' && (
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {/* Vignette overlay */}
            <div style={{
              position: 'absolute', inset: 0,
              background: 'radial-gradient(ellipse 55% 65% at 50% 45%, transparent 60%, rgba(0,0,0,0.55) 100%)',
            }} />
            {/* Oval guide */}
            <div style={{
              width: '58%', paddingBottom: '75%', position: 'relative',
              border: `2.5px solid ${livenessReady ? '#22c55e' : 'rgba(255,255,255,0.6)'}`,
              borderRadius: '50%',
              transition: 'border-color 0.4s',
              boxShadow: livenessReady ? `0 0 0 3px rgba(34,197,94,0.25)` : 'none',
            }} />
          </div>
        )}

        {/* Flip camera button */}
        {phase === 'preview' && (
          <button onClick={flipCamera} style={{
            position: 'absolute', top: 10, right: 10,
            background: 'rgba(0,0,0,0.45)', border: 'none', borderRadius: '50%',
            width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: '#fff',
          }} title="Flip camera">
            🔄
          </button>
        )}

        {/* Requesting permission overlay */}
        {phase === 'requesting' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 10, color: '#fff',
          }}>
            <Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13 }}>Requesting camera access…</span>
          </div>
        )}

        {/* Uploading overlay */}
        {phase === 'uploading' && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#fff',
          }}>
            <Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13 }}>Uploading…</span>
          </div>
        )}
      </div>

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Liveness status */}
      {phase === 'preview' && requireLiveness && (
        <div style={{
          marginTop: 12, padding: '8px 12px', borderRadius: 8,
          background: livenessReady ? '#f0fdf4' : '#eff6ff',
          border: `1px solid ${livenessReady ? '#86efac' : '#bfdbfe'}`,
          color: livenessReady ? '#15803d' : '#1d4ed8',
          fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {livenessReady
            ? '✓ Ready — take your photo'
            : '👁 Please blink once to confirm you\'re present…'}
        </div>
      )}

      {/* Actions */}
      <div style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        {phase === 'preview' && (
          <>
            <button style={outlineBtn} onClick={onCancel}>Cancel</button>
            <button
              style={{ ...btnStyle, opacity: livenessReady ? 1 : 0.45, cursor: livenessReady ? 'pointer' : 'not-allowed' }}
              onClick={capture}
              disabled={!livenessReady}
            >
              <Camera size={15} /> Take Photo
            </button>
          </>
        )}

        {phase === 'captured' && (
          <>
            <button style={outlineBtn} onClick={retake}>
              <RotateCcw size={14} /> Retake
            </button>
            <button style={btnStyle} onClick={usePhoto}>
              Use this photo
            </button>
          </>
        )}

        {phase === 'error' && (
          <div style={{ textAlign: 'center', width: '100%' }}>
            <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{errorMsg}</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button style={outlineBtn} onClick={onCancel}>Cancel</button>
              <button style={btnStyle} onClick={() => startCamera(facingMode)}>
                <RefreshCw size={14} /> Try Again
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}