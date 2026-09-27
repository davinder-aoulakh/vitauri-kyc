/**
 * DiditCallbackScreen — static "checking / result" card shown briefly while the
 * mobile Didit callback poll resolves, and as the fallback if that poll times out.
 * Extracted from ClientPortal.jsx to keep that file within the size guideline.
 */
export default function DiditCallbackScreen({ status, result }) {
  const passed = status === 'pass';
  const checking = status === 'checking';
  const failed = status === 'fail';
  const isInconclusive = result?.idv_status === 'Inconclusive';

  return (
    <div style={{ minHeight: '100vh', background: '#F4F6FA', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ background: '#FFFFFF', borderRadius: '20px', padding: '40px 32px', textAlign: 'center', maxWidth: '360px', width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        {checking ? (
          <>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔄</div>
            <div style={{ fontWeight: 700, fontSize: '18px', color: '#1A2332', marginBottom: '8px' }}>Confirming verification…</div>
            <div style={{ fontSize: '14px', color: '#64748B', lineHeight: 1.5 }}>Just a moment while we confirm your result.</div>
          </>
        ) : passed ? (
          <>
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>✅</div>
            <div style={{ fontWeight: 700, fontSize: '20px', color: '#059669', marginBottom: '10px' }}>Identity Verified!</div>
            <div style={{ fontSize: '14px', color: '#374151', lineHeight: 1.6, marginBottom: '24px' }}>Your identity has been successfully verified.</div>
            <div style={{ background: '#F0FDF4', border: '1px solid #10B981', borderRadius: '12px', padding: '16px', display: 'flex', alignItems: 'flex-start', gap: '12px', textAlign: 'left' }}>
              <span style={{ fontSize: '24px', flexShrink: 0 }}>💻</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px', color: '#065F46', marginBottom: '4px' }}>Continue on your laptop</div>
                <div style={{ fontSize: '13px', color: '#047857', lineHeight: 1.5 }}>Return to your laptop or desktop — it has already updated with your verification result. You can close this tab.</div>
              </div>
            </div>
          </>
        ) : failed ? (
          <>
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>{isInconclusive ? '🪪' : '❌'}</div>
            <div style={{ fontWeight: 700, fontSize: '18px', color: isInconclusive ? '#92400E' : '#DC2626', marginBottom: '10px' }}>
              {isInconclusive ? 'Verification Under Review' : 'Verification Unsuccessful'}
            </div>
            <div style={{ fontSize: '14px', color: '#374151', lineHeight: 1.6, marginBottom: '24px' }}>
              {result?.idv_failure_reason || (result?.idv_similarity_score != null ? `${result.idv_similarity_score}% face match.` : 'The verification could not be confirmed.')}
            </div>
            <div style={{ background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: '12px', padding: '16px', display: 'flex', alignItems: 'flex-start', gap: '12px', textAlign: 'left' }}>
              <span style={{ fontSize: '24px', flexShrink: 0 }}>💻</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px', color: '#92400E', marginBottom: '4px' }}>Return to your laptop</div>
                <div style={{ fontSize: '13px', color: '#78350F', lineHeight: 1.5 }}>Please return to your laptop or desktop to see your result and continue your application. You can close this tab.</div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>🪪</div>
            <div style={{ fontWeight: 700, fontSize: '18px', color: '#92400E', marginBottom: '10px' }}>Verification Complete</div>
            <div style={{ fontSize: '14px', color: '#374151', lineHeight: 1.6, marginBottom: '24px' }}>Thank you for completing the verification step.</div>
            <div style={{ background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: '12px', padding: '16px', display: 'flex', alignItems: 'flex-start', gap: '12px', textAlign: 'left' }}>
              <span style={{ fontSize: '24px', flexShrink: 0 }}>💻</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px', color: '#92400E', marginBottom: '4px' }}>Return to your laptop</div>
                <div style={{ fontSize: '13px', color: '#78350F', lineHeight: 1.5 }}>Please return to your laptop or desktop to see your result and continue your application. You can close this tab.</div>
              </div>
            </div>
          </>
        )}
        <div style={{ marginTop: '24px', fontSize: '11px', color: '#9CA3AF' }}>Powered by Didit · Secure identity verification</div>
      </div>
    </div>
  );
}