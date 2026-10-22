import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';

// Didit Business Verification (KYB) for an organisation, completed by the company representative in the client portal.
// Auth is the portal access token; tenant and client are resolved server-side (createDiditKybSession / getDiditKybResult).
const DONE = ['Approved', 'In Review'];
const FAILED = ['Declined', 'Expired', 'Abandoned'];

export default function KybVerificationField({
  item, accessToken, outreachId, portalUrl, language = 'en',
  primaryColor = '#1A6BFF', buttonRadius = '8px', onComplete,
}) {
  const isMobile = typeof window !== 'undefined' && (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 900);
  const [phase, setPhase] = useState('consent');
  const [sessionUrl, setSessionUrl] = useState('');
  const [status, setStatus] = useState(item?.kyb_status || '');
  const [error, setError] = useState('');
  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  useEffect(() => {
    // Return from Didit (?didit_kyb_done=1&item_id=...) or an already-started session: resume polling.
    const params = new URLSearchParams(window.location.search);
    const returned = params.get('didit_kyb_done') === '1' && params.get('item_id') === item?.item_id;
    if (returned) window.history.replaceState({}, '', window.location.pathname);
    if (DONE.includes(item?.kyb_status)) { setPhase('result'); return; }
    if (item?.kyb_verification_id || returned) { setPhase('checking'); startPolling(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const btn = { background: primaryColor, color: '#fff', border: 'none', borderRadius: buttonRadius, padding: '12px 20px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', width: '100%' };
  const btnOutline = { ...btn, background: 'transparent', color: primaryColor, border: `1px solid ${primaryColor}` };

  async function check() {
    const res = await base44.functions.invoke('getDiditKybResult', { access_token: accessToken, item_id: item?.item_id });
    const data = res?.data || res;
    if (data?.error) throw new Error(data.error);
    return data?.status || '';
  }

  function startPolling() {
    let attempts = 0;
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      attempts += 1;
      if (attempts > 120) { clearInterval(pollRef.current); setPhase('waiting'); return; }
      try {
        const s = await check();
        if (!s) return;
        setStatus(s);
        if (DONE.includes(s)) { clearInterval(pollRef.current); setPhase('result'); onComplete?.({ kyb_status: s }); }
        else if (FAILED.includes(s)) { clearInterval(pollRef.current); setPhase('result'); }
        else if (s === 'Awaiting User') setPhase('waiting');
      } catch { /* transient, keep polling */ }
    }, 5000);
  }

  async function start() {
    setPhase('creating'); setError('');
    try {
      const res = await base44.functions.invoke('createDiditKybSession', {
        access_token: accessToken, outreach_id: outreachId, item_id: item?.item_id, portal_url: portalUrl, language,
      });
      const data = res?.data || res;
      if (data?.error || !data?.session_url) { setError(data?.error || 'Business verification could not be started.'); setPhase('error'); return; }
      setSessionUrl(data.session_url);
      setStatus(data.status || '');
      setPhase('ready');
      startPolling();
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Business verification could not be started.');
      setPhase('error');
    }
  }

  const box = { padding: '20px', background: '#F8FAFF', borderRadius: '12px', border: '1px solid #DBEAFE' };

  if (phase === 'consent') return (
    <div style={box}>
      <div style={{ fontSize: '28px', textAlign: 'center', marginBottom: '10px' }}>🏢</div>
      <div style={{ fontWeight: 700, fontSize: '15px', color: '#1E3A5C', textAlign: 'center', marginBottom: '8px' }}>Business Verification</div>
      <div style={{ fontSize: '13px', color: '#374151', lineHeight: 1.6, marginBottom: '16px' }}>
        We will verify your company with the official business registry and collect your company documents:
        <ol style={{ margin: '8px 0 8px 20px' }}>
          <li>Find your company in the registry</li>
          <li>Upload the requested company documents</li>
          <li>Confirm the company details</li>
        </ol>
        This is handled by <strong>Didit</strong> (didit.me), our verification partner. Directors and beneficial owners may be asked
        to verify their identity separately. By continuing you accept our privacy notice and{' '}
        <a href="https://didit.me/terms/verification-privacy-notice" target="_blank" rel="noopener noreferrer" style={{ color: primaryColor }}>Didit's Verification Privacy Notice</a>.
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button style={btnOutline} onClick={() => setPhase('declined')}>Decline</button>
        <button style={{ ...btn, flex: 2 }} onClick={start}>Continue with Didit →</button>
      </div>
    </div>
  );

  if (phase === 'declined') return (
    <div style={{ padding: '16px', background: '#FEF3C7', borderRadius: '10px', border: '1px solid #FCD34D', fontSize: '13px', color: '#92400E' }}>
      ⚠ You have declined online business verification. Our compliance team will contact you to arrange an alternative.
    </div>
  );

  if (phase === 'creating' || phase === 'checking') return (
    <div style={{ textAlign: 'center', padding: '32px 20px' }}>
      <div style={{ fontSize: '28px', marginBottom: '10px' }}>{phase === 'creating' ? '🔐' : '🔄'}</div>
      <div style={{ fontWeight: 600, fontSize: '14px' }}>{phase === 'creating' ? 'Setting up business verification…' : 'Checking your business verification…'}</div>
    </div>
  );

  if (phase === 'ready') return (
    <div style={{ padding: '20px', textAlign: 'center' }}>
      <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '8px' }}>Ready to verify your company</div>
      <div style={{ fontSize: '13px', color: '#6B7280', marginBottom: '16px', lineHeight: 1.5 }}>
        {isMobile ? "You'll return here automatically when you're done." : 'The verification opens in a new tab. This page updates automatically when you are done.'}
      </div>
      {isMobile
        ? <button style={btn} onClick={() => { window.location.href = sessionUrl; }}>Start Business Verification →</button>
        : <a href={sessionUrl} target="_blank" rel="noopener noreferrer" style={{ ...btn, display: 'inline-block', textDecoration: 'none' }}>Open Business Verification →</a>}
      <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '10px' }}>Powered by Didit · Secure · EU data processing</div>
    </div>
  );

  if (phase === 'waiting') return (
    <div style={{ ...box, textAlign: 'center' }}>
      <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '6px' }}>Verification in progress</div>
      <div style={{ fontSize: '13px', color: '#6B7280', marginBottom: '12px' }}>
        {status === 'Awaiting User' ? 'Your company verification is waiting for other people (for example directors) to complete their part.' : 'We have not received a result yet.'}
      </div>
      <button style={btnOutline} onClick={async () => { try { const s = await check(); setStatus(s); if (DONE.includes(s)) { setPhase('result'); onComplete?.({ kyb_status: s }); } } catch { /* ignore */ } }}>Check status</button>
    </div>
  );

  if (phase === 'result') {
    const ok = DONE.includes(status || item?.kyb_status);
    return (
      <div style={{ padding: '18px', borderRadius: '12px', border: `2px solid ${ok ? '#10B981' : '#EF4444'}`, background: ok ? '#F0FDF4' : '#FEF2F2', textAlign: 'center' }}>
        <div style={{ fontSize: '32px', marginBottom: '6px' }}>{ok ? '✅' : '❌'}</div>
        <div style={{ fontWeight: 700, fontSize: '15px', color: ok ? '#059669' : '#DC2626' }}>
          {ok ? 'Business verification submitted' : 'Business verification unsuccessful'}
        </div>
        <div style={{ fontSize: '13px', color: '#374151', marginTop: '6px' }}>
          {ok ? 'Thank you. Our compliance team will review the result.' : 'Please try again or contact us.'}
        </div>
        {!ok && <button style={{ ...btn, marginTop: '12px' }} onClick={() => { setStatus(''); setPhase('consent'); }}>Try again</button>}
      </div>
    );
  }

  return (
    <div style={{ padding: '16px', background: '#FEE2E2', borderRadius: '10px', border: '1px solid #FCA5A5' }}>
      <div style={{ fontSize: '13px', color: '#DC2626', marginBottom: '12px' }}>⚠ {error || 'Something went wrong. Please try again.'}</div>
      <button style={btn} onClick={() => { setError(''); setPhase('consent'); }}>Start over</button>
    </div>
  );
}
