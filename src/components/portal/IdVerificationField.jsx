import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';

export default function IdVerificationField({
  item, outreachId, portalUrl,
  clientId = '', tenantId = '',
  clientEmail = '', firstName = '', lastName = '',
  language = 'en',
  primaryColor = '#1A6BFF',
  buttonRadius = '8px',
  onComplete,
}) {
  const isMobile = typeof window !== 'undefined' && (
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    window.innerWidth < 900
  );

  const [phase, setPhase]           = useState('consent');
  const [sessionUrl, setSessionUrl] = useState('');
  const [sessionId, setSessionId]   = useState('');
  const [result, setResult]         = useState(null);
  const [error, setError]           = useState('');
  const pollRef                     = useRef(null);

  // Stop polling on unmount
  useEffect(() => () => clearInterval(pollRef.current), []);

  const minScore = item?.idv_min_match_score ?? 75;

  const btn = {
    background: primaryColor, color: '#fff',
    border: 'none', borderRadius: buttonRadius,
    padding: '12px 20px', fontSize: '14px',
    fontWeight: 600, cursor: 'pointer', width: '100%',
  };
  const btnOutline = {
    ...btn, background: 'transparent',
    color: primaryColor, border: `1px solid ${primaryColor}`,
  };

  // ── PHASE: consent ────────────────────────────────────────────────────────
  if (phase === 'consent') return (
    <div style={{ padding:'20px', background:'#F8FAFF', borderRadius:'12px',
                  border:'1px solid #DBEAFE' }}>
      <div style={{ fontSize:'28px', textAlign:'center', marginBottom:'10px' }}>🪪</div>
      <div style={{ fontWeight:700, fontSize:'15px', color:'#1E3A5C',
                    textAlign:'center', marginBottom:'8px' }}>
        Identity Verification
      </div>
      <div style={{ fontSize:'13px', color:'#374151', lineHeight:1.6, marginBottom:'16px' }}>
        To verify your identity we will guide you through a short process:
        <ol style={{ margin:'8px 0 8px 20px' }}>
          <li>Photograph your identity document (passport, ID card or driving licence)</li>
          <li>Take a short selfie</li>
        </ol>
        This is handled by <strong>Didit</strong> (didit.me), our secure
        verification partner. Your biometric data is processed in the EU and
        deleted after verification. By continuing you accept our privacy notice
        and{' '}
        <a href="https://didit.me/terms/verification-privacy-notice"
           target="_blank" rel="noopener noreferrer"
           style={{ color: primaryColor }}>
          Didit's Verification Privacy Notice
        </a>.
      </div>
      <div style={{ display:'flex', gap:'8px' }}>
        <button style={btnOutline} onClick={() => setPhase('declined')}>
          Decline
        </button>
        <button style={{ ...btn, flex:2 }} onClick={startVerification}>
          Continue with Didit →
        </button>
      </div>
    </div>
  );

  // ── PHASE: declined ───────────────────────────────────────────────────────
  if (phase === 'declined') return (
    <div style={{ padding:'16px', background:'#FEF3C7', borderRadius:'10px',
                  border:'1px solid #FCD34D', fontSize:'13px', color:'#92400E' }}>
      ⚠ You have declined biometric verification. Our compliance team will contact
      you to arrange an alternative identity check. No further action is needed here.
    </div>
  );

  // ── START VERIFICATION ────────────────────────────────────────────────────
  async function startVerification() {
    setPhase('creating');
    setError('');
    try {
      const res = await base44.functions.invoke('createDiditSession', {
        outreach_id:  outreachId,
        item_id:      item?.item_id,
        client_id:    clientId,
        tenant_id:    tenantId,
        portal_url:   portalUrl,
        language,
        client_email: clientEmail,
        first_name:   firstName,
        last_name:    lastName,
      });

      const data = res?.data || res;
      if (data?.error) {
        setError(data.error);
        setPhase('error');
        return;
      }
      if (!data?.session_url) {
        setError('Could not start verification. Please try again.');
        setPhase('error');
        return;
      }

      setSessionUrl(data.session_url);
      setSessionId(data.session_id || '');
      setPhase('ready');
      startPolling();
    } catch (err) {
      setError(err.message || 'Verification could not be started.');
      setPhase('error');
    }
  }

  // ── POLLING ───────────────────────────────────────────────────────────────
  function startPolling() {
    let attempts = 0;
    const MAX_PASSIVE = 4;
    const MAX_ATTEMPTS = 100;

    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      attempts++;

      if (attempts > MAX_ATTEMPTS) {
        clearInterval(pollRef.current);
        setPhase('error');
        setError(
          'Verification is taking longer than expected. ' +
          'If you have completed it on your phone, click "Check Status" below.'
        );
        return;
      }

      const terminal = ['Pass', 'Fail', 'Inconclusive', 'Expired'];

      try {
        // ── Passive: read from DB ─────────────────────────────────────────
        const reqs = await base44.entities.OutreachRequest.filter({ id: outreachId });
        const req  = reqs?.[0];
        const idvItem = (req?.items || []).find(i => i.item_id === item?.item_id);

        if (idvItem?.idv_status && terminal.includes(idvItem.idv_status)) {
          clearInterval(pollRef.current);
          setResult(idvItem);
          setPhase('result');
          onComplete?.(idvItem);
          return;
        }

        // ── Active: call getDiditSessionResult after passive window ────────
        const sid = sessionId || idvItem?.didit_session_id;
        if (attempts > MAX_PASSIVE && sid && tenantId) {
          const res  = await base44.functions.invoke('getDiditSessionResult', {
            session_id:  sid,
            outreach_id: outreachId,
            item_id:     item?.item_id,
            tenant_id:   tenantId,
          });
          const data = res?.data || res;

          if (data?.idv_status && terminal.includes(data.idv_status)) {
            clearInterval(pollRef.current);
            setResult(data);
            setPhase('result');
            onComplete?.(data);
          }
        }
      } catch { /* polling errors are non-fatal, keep trying */ }
    }, 3000);
  }

  // ── PHASE: creating ───────────────────────────────────────────────────────
  if (phase === 'creating') return (
    <div style={{ textAlign:'center', padding:'40px 20px' }}>
      <div style={{ fontSize:'32px', marginBottom:'12px' }}>🔐</div>
      <div style={{ fontWeight:600, fontSize:'14px', marginBottom:'6px' }}>
        Setting up secure verification…
      </div>
      <div style={{ fontSize:'13px', color:'#6B7280' }}>This takes a moment</div>
    </div>
  );

  // ── PHASE: ready ──────────────────────────────────────────────────────────
  if (phase === 'ready') {
    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(sessionUrl)}&color=0F1F3D&margin=10`;

    return (
      <div style={{ padding:'20px' }}>
        {isMobile ? (
          <>
            <div style={{ fontWeight:600, fontSize:'14px', marginBottom:'8px',
                          textAlign:'center' }}>
              Ready to verify your identity
            </div>
            <div style={{ fontSize:'13px', color:'#6B7280', textAlign:'center',
                          marginBottom:'18px', lineHeight:1.5 }}>
              You'll be guided to photograph your document and take a selfie.
              You'll be returned here automatically when finished.
            </div>
            <button style={btn} onClick={() => { window.location.href = sessionUrl; }}>
              Start Identity Verification →
            </button>
            <div style={{ fontSize:'12px', color:'#94A3B8', textAlign:'center',
                          marginTop:'10px' }}>
              Powered by Didit · Secure · EU data processing
            </div>
          </>
        ) : (
          <>
            <div style={{ fontWeight:600, fontSize:'14px', marginBottom:'6px',
                          textAlign:'center' }}>
              Complete on your phone
            </div>
            <div style={{ fontSize:'13px', color:'#6B7280', textAlign:'center',
                          marginBottom:'18px', lineHeight:1.5 }}>
              Identity verification requires your camera. Scan the QR code below
              with your phone — this page updates automatically when you're done.
            </div>
            <div style={{ textAlign:'center', marginBottom:'16px' }}>
              <img src={qrSrc} alt="Scan to verify" width={220} height={220}
                   style={{ borderRadius:'12px', border:'3px solid #E2E8F2',
                            display:'inline-block' }} />
            </div>
            <div style={{ display:'flex', alignItems:'center',
                          justifyContent:'center', gap:'8px',
                          fontSize:'13px', color:'#6B7280', marginBottom:'14px' }}>
              <span style={{ width:'8px', height:'8px', borderRadius:'50%',
                             background: primaryColor, display:'inline-block' }} />
              Waiting for you to complete on your phone…
            </div>
            <div style={{ textAlign:'center' }}>
              <a href={sessionUrl} target="_blank" rel="noopener noreferrer"
                 style={{ fontSize:'12px', color: primaryColor }}>
                Or open on this device instead →
              </a>
            </div>
            <div style={{ marginTop:'14px', textAlign:'center' }}>
              <button
                onClick={async () => {
                  const sid = sessionId || item?.didit_session_id;
                  if (!sid || !tenantId) return;
                  setPhase('creating');
                  try {
                    const res  = await base44.functions.invoke('getDiditSessionResult', {
                      session_id:  sid,
                      outreach_id: outreachId,
                      item_id:     item?.item_id,
                      tenant_id:   tenantId,
                    });
                    const data = res?.data || res;
                    const terminal = ['Pass', 'Fail', 'Inconclusive', 'Expired'];
                    if (data?.idv_status && terminal.includes(data.idv_status)) {
                      clearInterval(pollRef.current);
                      setResult(data);
                      setPhase('result');
                      onComplete?.(data);
                    } else {
                      setPhase('ready');
                    }
                  } catch {
                    setPhase('ready');
                  }
                }}
                style={{
                  background: 'none', border: 'none',
                  color: primaryColor, fontSize: '12px',
                  cursor: 'pointer', textDecoration: 'underline',
                  marginTop: '6px',
                }}
              >
                Already completed? Check result now →
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── PHASE: result ─────────────────────────────────────────────────────────
  if (phase === 'result' && result) {
    const passed = result.idv_status === 'Pass';
    const score  = result.idv_similarity_score;
    return (
      <div style={{ padding:'20px', borderRadius:'12px',
        border:`2px solid ${passed ? '#10B981' : '#EF4444'}`,
        background: passed ? '#F0FDF4' : '#FEF2F2',
        textAlign:'center' }}>
        <div style={{ fontSize:'40px', marginBottom:'10px' }}>
          {passed ? '✅' : '❌'}
        </div>
        <div style={{ fontWeight:700, fontSize:'17px', marginBottom:'6px',
                      color: passed ? '#059669' : '#DC2626' }}>
          {passed ? 'Identity Verified' : 'Verification Unsuccessful'}
        </div>
        <div style={{ fontSize:'13px', color:'#374151', marginBottom:'14px' }}>
          {passed
            ? `Your identity has been successfully verified${score != null ? ` (${score}% face match)` : ''}.`
            : result.idv_failure_reason || 'The verification was not successful. Please try again or contact support.'
          }
        </div>
        {score != null && (
          <>
            <div style={{ background:'#E5E7EB', borderRadius:'4px',
                          height:'8px', overflow:'hidden', marginBottom:'6px' }}>
              <div style={{ height:'100%', width:`${score}%`,
                            background: passed ? '#10B981' : '#EF4444',
                            borderRadius:'4px' }} />
            </div>
            <div style={{ fontSize:'12px', color:'#6B7280', marginBottom:'14px' }}>
              Face match: {score}% · Threshold: {minScore}%
              {result.idv_document_type && ` · ${result.idv_document_type}`}
            </div>
          </>
        )}
        {!passed && (
          <button style={btn}
            onClick={() => { setResult(null); setSessionUrl(''); setPhase('consent'); }}>
            Try Again
          </button>
        )}
        <div style={{ fontSize:'11px', color:'#9CA3AF', marginTop:'10px' }}>
          Verified by Didit · EU data processing
        </div>
      </div>
    );
  }

  // ── PHASE: error ──────────────────────────────────────────────────────────
  if (phase === 'error') return (
    <div style={{ padding:'16px', background:'#FEE2E2', borderRadius:'10px',
                  border:'1px solid #FCA5A5' }}>
      <div style={{ fontSize:'13px', color:'#DC2626', marginBottom:'12px' }}>
        ⚠ {error || 'Something went wrong. Please try again.'}
      </div>
      <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
        <button style={{ ...btn, flex:1 }}
          onClick={() => { setError(''); setSessionId(''); setPhase('consent'); }}>
          Start Over
        </button>
        {sessionId && (
          <button
            style={{ ...btn, flex:1, background: '#6B7280' }}
            onClick={async () => {
              setError('');
              setPhase('creating');
              try {
                const res = await base44.functions.invoke('getDiditSessionResult', {
                  session_id: sessionId, outreach_id: outreachId,
                  item_id: item?.item_id, tenant_id: tenantId,
                });
                const data = res?.data || res;
                const terminal = ['Pass','Fail','Inconclusive','Expired'];
                if (data?.idv_status && terminal.includes(data.idv_status)) {
                  setResult(data); setPhase('result'); onComplete?.(data);
                } else {
                  setError('Verification not yet complete. Please try again in a moment.');
                  setPhase('error');
                }
              } catch (err) {
                setError(err.message || 'Could not check status.');
                setPhase('error');
              }
            }}>
            Check Status
          </button>
        )}
      </div>
    </div>
  );

  return null;
}